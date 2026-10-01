// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: cloud-sun-rain;

// ============================================================================
// Taiwan Weather — a self-calibrating forecast widget for Scriptable (iOS)
//
//  * CWA (中央氣象署) township forecast + 7 numerical models via Open-Meteo
//  * Live correction from the nearest CWA automatic weather station
//  * Learns on-device: logs every forecast, verifies against station
//    observations, and re-weights / de-biases each source over time.
//
// Setup: see README.md. First run inside the Scriptable app asks for your
// CWA API key (free from https://opendata.cwa.gov.tw).
// ============================================================================

const CONFIG = {
  // Used when location is unavailable (e.g. widget without location permission).
  fallbackLocation: { latitude: 25.0330, longitude: 121.5654 }, // Taipei 101
  // Open-Meteo models that cover Taiwan, with prior expected temp MAE (°C).
  models: {
    jma_msm: 1.3,              // JMA 5 km regional
    ecmwf_ifs: 1.3,            // ECMWF 9 km
    ecmwf_aifs025_single: 1.4, // ECMWF AI model
    icon_seamless: 1.6,        // DWD ICON
    gfs_seamless: 1.7,         // NOAA GFS
    ukmo_seamless: 1.6,        // UK Met Office
    cma_grapes_global: 1.8,    // China CMA
  },
  cwaPriorMae: 1.0,            // CWA's own township forecast prior
  priorStrength: 24,           // how many samples the prior is "worth"
  nowcastDecayHours: 4,        // e-folding time for station-based correction
  historyDays: 21,             // how long verification data is kept
  hoursShown: 8,
};

// CWA county → 3-day township forecast dataset ID (F-D0047-xxx)
const COUNTY_DATASET = {
  "宜蘭縣": "001", "桃園市": "005", "新竹縣": "009", "苗栗縣": "013",
  "彰化縣": "017", "南投縣": "021", "雲林縣": "025", "嘉義縣": "029",
  "屏東縣": "033", "臺東縣": "037", "花蓮縣": "041", "澎湖縣": "045",
  "基隆市": "049", "新竹市": "053", "嘉義市": "057", "臺北市": "061",
  "高雄市": "065", "新北市": "069", "臺中市": "073", "臺南市": "077",
  "連江縣": "081", "金門縣": "085",
};

const CWA_BASE = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/";
const KEYCHAIN_KEY = "CWA_API_KEY";
const LEAD_BUCKETS = [[0, 6], [6, 24], [24, 48]];

// ---------------------------------------------------------------------------
// Time helpers — all hour keys are Taiwan local time "YYYY-MM-DDTHH"
// ---------------------------------------------------------------------------
const HOUR = 3600e3;
function hourKey(date) {
  return new Date(date.getTime() + 8 * HOUR).toISOString().slice(0, 13);
}
function keyToDate(key) {
  return new Date(Date.parse(key + ":00:00+08:00"));
}
function addHours(key, h) {
  return hourKey(new Date(keyToDate(key).getTime() + h * HOUR));
}
function leadBucket(lead) {
  return LEAD_BUCKETS.findIndex(([a, b]) => lead >= a && lead < b);
}
function num(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) && n > -90 ? n : null; // CWA uses -99 / -999 for missing
}
function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
function storage() {
  let fm;
  try { fm = FileManager.iCloud(); fm.documentsDirectory(); } catch (e) { fm = FileManager.local(); }
  const dir = fm.joinPath(fm.documentsDirectory(), "taiwan-weather");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  const file = fm.joinPath(dir, "state.json");
  return {
    async load() {
      try {
        if (!fm.fileExists(file)) return null;
        if (fm.isFileStoredIniCloud && fm.isFileStoredIniCloud(file)) await fm.downloadFileFromiCloud(file);
        return JSON.parse(fm.readString(file));
      } catch (e) { return null; }
    },
    save(state) { fm.writeString(file, JSON.stringify(state)); },
  };
}

function emptyState() {
  // forecasts[validHour][source][bucket] = { t, pop }
  // obs[hour] = { t, acc, station }
  return { version: 1, forecasts: {}, obs: {}, lastLocation: null, lastResult: null };
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------
async function getJSON(url) {
  const req = new Request(url);
  req.timeoutInterval = 20;
  return await req.loadJSON();
}

async function getLocation(state) {
  try {
    Location.setAccuracyToThreeKilometers();
    const loc = await Location.current();
    return { latitude: loc.latitude, longitude: loc.longitude };
  } catch (e) {
    return state.lastLocation || CONFIG.fallbackLocation;
  }
}

async function fetchStations(key) {
  const url = CWA_BASE + "O-A0001-001?Authorization=" + encodeURIComponent(key) +
    "&WeatherElement=AirTemperature,Weather,Now&GeoInfo=Coordinates,CountyName,TownName";
  const data = await getJSON(url);
  if (!data.records) throw new Error("CWA stations: " + (data.message || "bad response"));
  return data.records.Station.map((s) => {
    const coords = s.GeoInfo.Coordinates.find((c) => c.CoordinateName === "WGS84") || s.GeoInfo.Coordinates[0];
    const we = s.WeatherElement || {};
    return {
      id: s.StationId,
      name: s.StationName,
      county: s.GeoInfo.CountyName,
      town: s.GeoInfo.TownName,
      latitude: num(coords.StationLatitude),
      longitude: num(coords.StationLongitude),
      time: s.ObsTime && s.ObsTime.DateTime,
      t: num(we.AirTemperature),
      acc: num(we.Now && we.Now.Precipitation), // rainfall accumulated today (mm)
      weather: we.Weather && we.Weather !== "-99" ? we.Weather : null,
    };
  });
}

function nearestStation(stations, loc) {
  let best = null;
  for (const s of stations) {
    if (s.t == null || s.latitude == null) continue;
    const d = distanceKm(loc, s);
    if (!best || d < best.distance) best = { ...s, distance: d };
  }
  return best;
}

function countyOfNearest(stations, loc) {
  // county from nearest station regardless of temperature availability
  let best = null, bd = Infinity;
  for (const s of stations) {
    if (s.latitude == null) continue;
    const d = distanceKm(loc, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// Expand a CWA WeatherElement into hourly values.
function cwaElementHourly(el) {
  const out = {};
  const points = [];
  for (const t of el.Time || []) {
    const ev = (t.ElementValue || [])[0] || {};
    const val = ev.Temperature ?? ev.ProbabilityOfPrecipitation ?? ev.Weather ?? Object.values(ev)[0];
    if (t.DataTime) {
      points.push({ key: hourKey(new Date(t.DataTime)), val });
    } else if (t.StartTime && t.EndTime) {
      let k = hourKey(new Date(t.StartTime));
      const end = hourKey(new Date(t.EndTime));
      while (k < end) { out[k] = val; k = addHours(k, 1); }
    }
  }
  // instantaneous points: linear interpolation for numbers
  points.sort((a, b) => (a.key < b.key ? -1 : 1));
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[i + 1];
    out[p.key] = p.val;
    if (!q) continue;
    const a = num(p.val), b = num(q.val);
    const span = (keyToDate(q.key) - keyToDate(p.key)) / HOUR;
    for (let h = 1; h < span; h++) {
      out[addHours(p.key, h)] = a != null && b != null ? a + ((b - a) * h) / span : p.val;
    }
  }
  return out;
}

async function fetchCWAForecast(key, county, town, loc) {
  const id = COUNTY_DATASET[county];
  if (!id) throw new Error("Unknown county " + county);
  const url = CWA_BASE + "F-D0047-" + id + "?Authorization=" + encodeURIComponent(key) +
    "&ElementName=" + encodeURIComponent("溫度,3小時降雨機率,天氣現象");
  const data = await getJSON(url);
  const locs = data.records && data.records.Locations && data.records.Locations[0].Location;
  if (!locs) throw new Error("CWA forecast: " + (data.message || "bad response"));
  let place = locs.find((l) => l.LocationName === town);
  if (!place) {
    place = locs.reduce((best, l) => {
      const d = distanceKm(loc, { latitude: num(l.Latitude), longitude: num(l.Longitude) });
      return !best || d < best.d ? { l, d } : best;
    }, null).l;
  }
  const series = {};
  for (const el of place.WeatherElement) {
    const hourly = cwaElementHourly(el);
    for (const [k, v] of Object.entries(hourly)) {
      series[k] = series[k] || {};
      if (el.ElementName === "溫度") series[k].t = num(v);
      else if (el.ElementName === "3小時降雨機率") series[k].pop = num(v);
      else if (el.ElementName === "天氣現象") series[k].wx = v;
    }
  }
  return { town: place.LocationName, series };
}

async function fetchModels(loc) {
  const names = Object.keys(CONFIG.models);
  const url = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.latitude.toFixed(4) +
    "&longitude=" + loc.longitude.toFixed(4) +
    "&hourly=temperature_2m,precipitation_probability,precipitation" +
    "&models=" + names.join(",") + "&forecast_days=3&past_days=1&timezone=Asia%2FTaipei";
  const data = await getJSON(url);
  if (!data.hourly) throw new Error("Open-Meteo: " + (data.reason || "bad response"));
  const h = data.hourly;
  const out = {};
  for (const m of names) {
    const series = {};
    const T = h["temperature_2m_" + m] || [];
    const P = h["precipitation_probability_" + m] || [];
    const R = h["precipitation_" + m] || [];
    h.time.forEach((time, i) => {
      if (T[i] == null) return;
      series[time.slice(0, 13)] = { t: T[i], pop: P[i] ?? null, rain: R[i] ?? null };
    });
    if (Object.keys(series).length) out[m] = series;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Learning: record forecasts, verify, derive per-source bias & weight
// ---------------------------------------------------------------------------
function recordForecasts(state, sources, nowKey) {
  for (const [src, series] of Object.entries(sources)) {
    for (const [k, v] of Object.entries(series)) {
      const lead = (keyToDate(k) - keyToDate(nowKey)) / HOUR;
      const b = leadBucket(lead);
      if (b < 0 || v.t == null) continue;
      state.forecasts[k] = state.forecasts[k] || {};
      state.forecasts[k][src] = state.forecasts[k][src] || {};
      // keep the latest forecast issued within each lead bucket
      state.forecasts[k][src][b] = { t: Math.round(v.t * 10) / 10, pop: v.pop ?? null };
    }
  }
}

function recordObservation(state, station) {
  if (!station || !station.time) return;
  const k = hourKey(new Date(station.time));
  state.obs[k] = { t: station.t, acc: station.acc, station: station.id };
}

function hourlyRain(state, k) {
  const o = state.obs[k];
  if (!o || o.acc == null) return null;
  const p = state.obs[addHours(k, -1)];
  if (k.endsWith("T00") || !p || p.acc == null || p.station !== o.station) {
    return k.endsWith("T00") ? o.acc : null; // daily accumulation resets at midnight
  }
  return Math.max(0, o.acc - p.acc);
}

function computeSkill(state) {
  // skill[src][bucket] = { n, bias, mae, brierN, brier }
  const skill = {};
  for (const [k, bySrc] of Object.entries(state.forecasts)) {
    const o = state.obs[k];
    if (!o || o.t == null) continue;
    const rain = hourlyRain(state, k);
    for (const [src, byBucket] of Object.entries(bySrc)) {
      for (const [b, f] of Object.entries(byBucket)) {
        const s = ((skill[src] = skill[src] || {})[b] = skill[src][b] ||
          { n: 0, errSum: 0, absSum: 0, brierN: 0, brierSum: 0 });
        const err = f.t - o.t;
        s.n++; s.errSum += err; s.absSum += Math.abs(err);
        if (f.pop != null && rain != null) {
          s.brierN++; s.brierSum += (f.pop / 100 - (rain >= 0.5 ? 1 : 0)) ** 2;
        }
      }
    }
  }
  for (const src of Object.keys(skill)) {
    for (const s of Object.values(skill[src])) {
      s.bias = s.errSum / s.n;
      s.mae = s.absSum / s.n;
      s.brier = s.brierN ? s.brierSum / s.brierN : null;
    }
  }
  return skill;
}

function sourceParams(skill, src, bucket) {
  const prior = src === "cwa" ? CONFIG.cwaPriorMae : CONFIG.models[src] || 2;
  const k = CONFIG.priorStrength;
  const s = skill[src] && skill[src][bucket];
  const n = s ? s.n : 0;
  // shrink learned stats toward priors when samples are few
  const mae = (n * (s ? s.mae : 0) + k * prior) / (n + k);
  const bias = n ? (n * s.bias) / (n + k) : 0;
  const brier = s && s.brier != null
    ? (s.brierN * s.brier + k * 0.15) / (s.brierN + k)
    : 0.15;
  return { weight: 1 / (mae * mae), bias, mae, n,
    popWeight: (src === "cwa" ? 2 : 1) / brier };
}

function pruneState(state, nowKey) {
  const cutoff = addHours(nowKey, -24 * CONFIG.historyDays);
  for (const k of Object.keys(state.forecasts)) if (k < cutoff) delete state.forecasts[k];
  for (const k of Object.keys(state.obs)) if (k < cutoff) delete state.obs[k];
}

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------
function blend(sources, skill, nowKey, station) {
  const hours = [];
  for (let h = 0; h < 48; h++) hours.push(addHours(nowKey, h));
  const rows = hours.map((k, lead) => {
    const b = leadBucket(lead);
    let tw = 0, tSum = 0, pw = 0, pSum = 0, rainSum = 0, rainN = 0;
    const members = [];
    for (const [src, series] of Object.entries(sources)) {
      const v = series[k];
      if (!v) continue;
      const p = sourceParams(skill, src, b);
      if (v.t != null) {
        const corrected = v.t - p.bias;
        tw += p.weight; tSum += p.weight * corrected;
        members.push(corrected);
      }
      if (v.pop != null) { pw += p.popWeight; pSum += p.popWeight * v.pop; }
      if (v.rain != null) { rainSum += v.rain; rainN++; }
    }
    const t = tw ? tSum / tw : null;
    const spread = members.length > 1
      ? Math.sqrt(members.reduce((a, x) => a + (x - t) ** 2, 0) / members.length) : null;
    return { key: k, lead, t, pop: pw ? pSum / pw : null, rain: rainN ? rainSum / rainN : null,
      spread, wx: sources.cwa && sources.cwa[k] && sources.cwa[k].wx };
  });

  // Nowcast: nudge the first hours toward the live station reading.
  if (station && station.t != null) {
    const obsKey = hourKey(new Date(station.time));
    const ref = rows.find((r) => r.key === obsKey) || rows[0];
    if (ref.t != null) {
      const delta = station.t - ref.t;
      for (const r of rows) {
        if (r.t != null) r.t += delta * Math.exp(-r.lead / CONFIG.nowcastDecayHours);
      }
    }
    // Currently raining at the station → next hours are very likely wet.
    const rainingNow = (station.weather && station.weather.includes("雨"));
    if (rainingNow) {
      for (const r of rows.slice(0, 2)) if (r.pop != null) r.pop = Math.max(r.pop, 80);
    }
  }
  return rows;
}

function summarize(rows) {
  const today = rows[0].key.slice(0, 10);
  const todayRows = rows.filter((r) => r.key.startsWith(today) && r.t != null);
  const temps = todayRows.map((r) => r.t);
  const nextRain = rows.slice(0, 24).find((r) => r.pop != null && r.pop >= 50);
  return {
    hi: temps.length ? Math.max(...temps) : null,
    lo: temps.length ? Math.min(...temps) : null,
    nextRain: nextRain ? nextRain.key : null,
    nextRainPop: nextRain ? nextRain.pop : null,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------
async function run(apiKey) {
  const store = storage();
  const state = (await store.load()) || emptyState();
  const loc = await getLocation(state);
  state.lastLocation = loc;
  const nowKey = hourKey(new Date());
  const errors = [];

  const [stationsRes, modelsRes] = await Promise.allSettled([
    apiKey ? fetchStations(apiKey) : Promise.reject(new Error("No CWA key")),
    fetchModels(loc),
  ]);

  const sources = {};
  let station = null, town = null;
  if (modelsRes.status === "fulfilled") Object.assign(sources, modelsRes.value);
  else errors.push(modelsRes.reason.message);

  if (stationsRes.status === "fulfilled") {
    const stations = stationsRes.value;
    station = nearestStation(stations, loc);
    const admin = countyOfNearest(stations, loc);
    try {
      const cwa = await fetchCWAForecast(apiKey, admin.county, admin.town, loc);
      sources.cwa = cwa.series;
      town = admin.county + cwa.town;
    } catch (e) { errors.push(e.message); }
  } else errors.push(stationsRes.reason.message);

  if (!Object.keys(sources).length) {
    if (state.lastResult) return { ...state.lastResult, stale: true, errors };
    throw new Error(errors.join("; "));
  }

  recordObservation(state, station);
  recordForecasts(state, sources, nowKey);
  pruneState(state, nowKey);
  const skill = computeSkill(state);
  const rows = blend(sources, skill, nowKey, station);

  const result = {
    updated: new Date().toISOString(),
    place: town || `${loc.latitude.toFixed(2)}, ${loc.longitude.toFixed(2)}`,
    station: station && { name: station.name, t: station.t, weather: station.weather,
      distance: station.distance, time: station.time },
    rows: rows.slice(0, 48),
    summary: summarize(rows),
    skill: Object.fromEntries(Object.keys(sources).map((src) => [src,
      LEAD_BUCKETS.map((_, b) => sourceParams(skill, src, b))])),
    sources: Object.keys(sources),
    errors,
  };
  state.lastResult = result;
  store.save(state);
  return result;
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
const C = {
  bgTop: new Color("#1d3b6e"), bgBottom: new Color("#0f1f3d"),
  text: Color.white(), dim: new Color("#ffffff", 0.65), rain: new Color("#7cc4ff"),
};
const fmtT = (t) => (t == null ? "–" : Math.round(t) + "°");
const fmtHour = (k) => k.slice(11, 13);

function wxSymbol(wx, pop) {
  const s = wx || "";
  if (s.includes("雷")) return "cloud.bolt.rain.fill";
  if (s.includes("雨") || (pop != null && pop >= 60)) return "cloud.rain.fill";
  if (s.includes("陰")) return "cloud.fill";
  if (s.includes("雲")) return "cloud.sun.fill";
  if (s.includes("晴")) return "sun.max.fill";
  return pop != null && pop >= 30 ? "cloud.drizzle.fill" : "cloud.sun.fill";
}

function addSymbol(stack, name, size, color) {
  const img = stack.addImage(SFSymbol.named(name).image);
  img.imageSize = new Size(size, size);
  img.tintColor = color || C.text;
  return img;
}

function addText(stack, str, size, opts = {}) {
  const t = stack.addText(str);
  t.font = opts.bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = opts.color || C.text;
  t.lineLimit = 1;
  if (opts.minScale) t.minimumScaleFactor = opts.minScale;
  return t;
}

function nowText(r) {
  const s = r.summary;
  if (s.nextRain) {
    const hrs = Math.round((keyToDate(s.nextRain) - Date.now()) / HOUR);
    return hrs <= 0 ? `Rain now ${Math.round(s.nextRainPop)}%` : `Rain ~${fmtHour(s.nextRain)}:00 (${Math.round(s.nextRainPop)}%)`;
  }
  return "No rain next 24h";
}

function buildWidget(r, family) {
  const w = new ListWidget();
  const cur = r.station && r.station.t != null ? r.station.t : r.rows[0].t;
  const wx = (r.station && r.station.weather) || r.rows[0].wx;
  w.refreshAfterDate = new Date(Date.now() + 30 * 60e3);

  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
    addSymbol(s, wxSymbol(wx, r.rows[0].pop), 14);
    addText(s, fmtT(cur), 16, { bold: true });
    return w;
  }
  if (family === "accessoryInline") {
    addText(w, `${fmtT(cur)} ${nowText(r)}`, 12);
    return w;
  }
  if (family === "accessoryRectangular") {
    addText(w, `${fmtT(cur)}  H${fmtT(r.summary.hi)} L${fmtT(r.summary.lo)}`, 15, { bold: true });
    addText(w, nowText(r), 12);
    addText(w, r.place, 11, { minScale: 0.7 });
    return w;
  }

  const g = new LinearGradient();
  g.colors = [C.bgTop, C.bgBottom]; g.locations = [0, 1];
  w.backgroundGradient = g;
  w.setPadding(12, 14, 12, 14);

  const top = w.addStack(); top.centerAlignContent();
  const left = top.addStack(); left.layoutVertically();
  addText(left, r.place, 12, { color: C.dim, minScale: 0.6 });
  addText(left, fmtT(cur), family === "small" ? 36 : 40, { bold: true });
  top.addSpacer();
  addSymbol(top, wxSymbol(wx, r.rows[0].pop), family === "small" ? 26 : 32);

  addText(w, `${wx || ""}  H${fmtT(r.summary.hi)} L${fmtT(r.summary.lo)}`, 12, { color: C.dim, minScale: 0.7 });
  addText(w, nowText(r), 12, { color: C.rain, minScale: 0.7 });

  if (family !== "small") {
    w.addSpacer(6);
    const row = w.addStack();
    const step = family === "large" ? 1 : 2;
    const n = family === "large" ? 12 : CONFIG.hoursShown;
    for (let i = 1; i <= n * step; i += step) {
      const h = r.rows[i];
      if (!h) break;
      const col = row.addStack(); col.layoutVertically(); col.centerAlignContent();
      addText(col, fmtHour(h.key), 10, { color: C.dim });
      addSymbol(col, wxSymbol(h.wx, h.pop), 14);
      addText(col, fmtT(h.t), 12, { bold: true });
      addText(col, h.pop == null ? "" : Math.round(h.pop) + "%", 9, { color: C.rain });
      row.addSpacer();
    }
  }
  w.addSpacer();
  const time = new Date(r.updated);
  addText(w, `${r.stale ? "⚠︎ stale · " : ""}${time.toTimeString().slice(0, 5)}` +
    (r.station ? ` · ${r.station.name} ${r.station.distance.toFixed(1)}km` : ""), 9, { color: C.dim });
  return w;
}

function detailHTML(r) {
  const srcNames = { cwa: "CWA 鄉鎮預報" };
  const skillRows = Object.entries(r.skill).map(([src, buckets]) =>
    `<tr><td>${srcNames[src] || src}</td>${buckets.map((p) =>
      `<td>${p.mae.toFixed(2)}° <small>(${p.n}${p.n ? `, bias ${p.bias >= 0 ? "+" : ""}${p.bias.toFixed(1)}` : ""})</small></td>`).join("")}</tr>`).join("");
  const hourRows = r.rows.slice(0, 36).map((h) =>
    `<tr><td>${h.key.slice(5, 10)} ${fmtHour(h.key)}:00</td><td><b>${fmtT(h.t)}</b>${h.spread != null ? ` <small>±${h.spread.toFixed(1)}</small>` : ""}</td>` +
    `<td>${h.pop == null ? "–" : Math.round(h.pop) + "%"}</td><td>${h.rain == null ? "–" : h.rain.toFixed(1)}</td><td>${h.wx || ""}</td></tr>`).join("");
  return `<html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:light dark}
body{font:15px -apple-system;margin:16px;background:Canvas;color:CanvasText}
table{border-collapse:collapse;width:100%;margin-bottom:20px}
td,th{padding:5px 4px;border-bottom:1px solid #8884;text-align:left}
small{opacity:.6}h2{margin:18px 0 6px;font-size:17px}.err{color:#d33}
</style></head><body>
<h1 style="font-size:22px;margin:0">${r.place}</h1>
<p>${r.station ? `Now ${fmtT(r.station.t)} ${r.station.weather || ""} · station ${r.station.name} (${r.station.distance.toFixed(1)} km)` : ""}<br>
Today H ${fmtT(r.summary.hi)} / L ${fmtT(r.summary.lo)} · ${nowText(r)}</p>
${r.errors.length ? `<p class="err">${r.errors.join("<br>")}</p>` : ""}
<h2>Hourly (blended)</h2>
<table><tr><th>Time</th><th>Temp</th><th>Rain%</th><th>mm</th><th>CWA</th></tr>${hourRows}</table>
<h2>Source skill — temp MAE (samples, bias)</h2>
<table><tr><th>Source</th><th>0–6h</th><th>6–24h</th><th>24–48h</th></tr>${skillRows}</table>
<p><small>Lower MAE ⇒ higher weight. Values start from priors and become your
location's real verified scores as observations accumulate (run often for faster learning).</small></p>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function ensureKey() {
  if (Keychain.contains(KEYCHAIN_KEY)) return Keychain.get(KEYCHAIN_KEY);
  if (config.runsInWidget) return null;
  const a = new Alert();
  a.title = "CWA API key";
  a.message = "Paste your 授權碼 from opendata.cwa.gov.tw (會員 → 取得授權碼).";
  a.addTextField("CWA-XXXXXXXX-...");
  a.addAction("Save");
  a.addCancelAction("Skip");
  if ((await a.present()) === -1) return null;
  const key = a.textFieldValue(0).trim();
  if (key) Keychain.set(KEYCHAIN_KEY, key);
  return key || null;
}

async function main() {
  const family = config.widgetFamily || "medium";
  let result;
  try {
    const key = await ensureKey();
    result = await run(key);
  } catch (e) {
    const w = new ListWidget();
    w.addText("Weather error: " + e.message);
    if (config.runsInWidget) { Script.setWidget(w); return; }
    throw e;
  }
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    Script.setWidget(buildWidget(result, family));
  } else if (config.runsInApp) {
    const wv = new WebView();
    await wv.loadHTML(detailHTML(result));
    await wv.present(true);
  } else {
    await buildWidget(result, family).presentMedium();
  }
}

// __TEST__ is only defined by test/harness.mjs
if (typeof __TEST__ === "undefined") {
  await main();
  Script.complete();
}
