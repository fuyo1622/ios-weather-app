// Mocked Scriptable environment and API fixtures for running TaiwanWeather.js under Node.
// Fixtures are generated from a synthetic "true" weather (`world`), so tests can check
// that the script learns and blends toward it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const stateDir = path.join(here, ".state");
export const HOUR = 3600e3;

// ---------------- Clock (the script sees FakeDate as Date) ----------------
const RealDate = Date;
export const clock = { now: null, ms() { return this.now ?? RealDate.now(); } };
class FakeDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(clock.ms()); }
  static now() { return clock.ms(); }
}
/** Taiwan-time hour key "YYYY-MM-DDTHH" of a timestamp. */
export const hk = (ms) => new RealDate(ms + 8 * HOUR).toISOString().slice(0, 13);
export const iso = (ms) => hk(ms) + ":00:00+08:00";
/** Timestamp of a Taiwan-time "YYYY-MM-DDTHH:mm". */
export const tw = (s) => RealDate.parse(s + ":00+08:00");
const floorHours = (ms, n) => Math.floor((ms + 8 * HOUR) / (n * HOUR)) * n * HOUR - 8 * HOUR;
const round1 = (x) => Math.round(x * 10) / 10;

// Deterministic noise in [-1, 1] from any key parts.
export function noise(...parts) {
  let h = 2166136261;
  for (const ch of parts.join("|")) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) / 2 ** 32) * 2 - 1;
}

// ---------------- Synthetic truth at the test location ----------------
export const world = {
  /** Air temperature: daily cycle 24–31 °C, warmest at 15:00. */
  temp(ms) {
    const h = ((ms / HOUR + 8) % 24 + 24) % 24;
    return 27.5 + 3.5 * Math.sin(((h - 9) / 24) * 2 * Math.PI);
  },
  /** Rain (mm) in the hour ending at ms: 2 mm/h from 14:00 to 17:00 on even days of the month. */
  rain(ms) {
    const d = new RealDate(ms + 8 * HOUR - 1);
    const h = d.getUTCHours();
    return d.getUTCDate() % 2 === 0 && h >= 14 && h < 17 ? 2 : 0;
  },
  /** CWA "Now.Precipitation" at an hourly observation: today's total, or -98 when dry for 6 h. */
  rainCode(ms) {
    let dry = true;
    for (let i = 0; i < 6; i++) if (world.rain(ms - i * HOUR) > 0) dry = false;
    if (dry) return -98;
    let acc = 0;
    for (let t = floorHours(ms, 24) + HOUR; t <= ms; t += HOUR) acc += world.rain(t);
    return acc;
  },
  extremes(ms) { // observed so far today
    const ts = [];
    for (let t = floorHours(ms, 24); t <= ms; t += HOUR) ts.push(world.temp(t));
    return { hi: Math.max(...ts), lo: Math.min(...ts) };
  },
};

// ---------------- API fixtures (shapes of the real responses) ----------------
export const HOME = { latitude: 25.033, longitude: 121.5654 }; // Taipei 101

export function stationsFixture(ms, ids) {
  const t = Math.floor(ms / HOUR) * HOUR; // observations are hourly
  const station = (name, id, lat, lon, county, town, we) => ({
    StationName: name, StationId: id, ObsTime: { DateTime: iso(t) },
    GeoInfo: {
      Coordinates: [{ CoordinateName: "TWD67", StationLatitude: lat - 0.002, StationLongitude: lon - 0.008 },
                    { CoordinateName: "WGS84", StationLatitude: lat, StationLongitude: lon }],
      CountyName: county, TownName: town,
    },
    WeatherElement: we,
  });
  const ex = world.extremes(t);
  const all = [
    station("信義", "C0AC70", 25.0377, 121.5645, "臺北市", "信義區", {
      Weather: world.rain(t) > 0 ? "陰有雨" : "多雲", Now: { Precipitation: world.rainCode(t) },
      AirTemperature: round1(world.temp(t)), RelativeHumidity: 70, WindSpeed: 2.0, WindDirection: 225,
      GustInfo: { PeakGustSpeed: 5.5, Occurred_at: { WindDirection: 220, DateTime: iso(t) } },
      DailyExtreme: { DailyHigh: { TemperatureInfo: { AirTemperature: round1(ex.hi) } },
                      DailyLow: { TemperatureInfo: { AirTemperature: round1(ex.lo) } } } }),
    // nearest to HOME, but its sensors report "missing"
    station("壞站", "X1", 25.033, 121.5654, "臺北市", "信義區", {
      Weather: "-99", Now: { Precipitation: -99 }, AirTemperature: -99 }),
    station("澎湖", "467350", 23.5655, 119.5554, "澎湖縣", "馬公市", {
      Weather: "晴", Now: { Precipitation: 0 }, AirTemperature: 27.1 }),
    station("臺南", "467410", 22.9932, 120.2047, "臺南市", "中西區", {
      Weather: "晴", Now: { Precipitation: 0 }, AirTemperature: 29.3 }),
  ];
  return { success: "true", records: { Station: ids ? all.filter((s) => ids.includes(s.StationId)) : all } };
}

// net.unknownTowns: township names this fixture's CWA "doesn't know" (a LocationName filter returns none).
export function forecastFixture(ms, townName, names = null) {
  const start = floorHours(ms, 3); // CWA issues 3-hour steps
  const steps = Array.from({ length: 25 }, (_, i) => start + i * 3 * HOUR);
  const wet = (t) => [1, 2, 3].some((h) => world.rain(t + h * HOUR) > 0); // block [t, t+3h)
  const town = (name, lat, lon) => ({ LocationName: name, Geocode: "63000020", Latitude: String(lat), Longitude: String(lon),
    WeatherElement: [
      { ElementName: "溫度", Time: steps.map((t) =>
        ({ DataTime: iso(t), ElementValue: [{ Temperature: String(Math.round(world.temp(t) + 0.3)) }] })) },
      { ElementName: "3小時降雨機率", Time: steps.slice(0, 24).map((t) =>
        ({ StartTime: iso(t), EndTime: iso(t + 3 * HOUR), ElementValue: [{ ProbabilityOfPrecipitation: wet(t) ? "70" : "10" }] })) },
      { ElementName: "天氣現象", Time: steps.slice(0, 24).map((t) =>
        ({ StartTime: iso(t), EndTime: iso(t + 3 * HOUR), ElementValue: [{ Weather: wet(t) ? "陰短暫雨" : "多雲", WeatherCode: wet(t) ? "11" : "04" }] })) },
      // the detail sheets' elements: instants every 3 hours
      ...[["體感溫度", (t) => ({ ApparentTemperature: String(Math.round(world.temp(t) + 2)) })],
        ["相對濕度", (t) => ({ RelativeHumidity: wet(t) ? "92" : "72" })],
        ["露點溫度", (t) => ({ DewPoint: String(Math.round(world.temp(t) - 5)) })],
        ["風速", () => ({ WindSpeed: "3", BeaufortScale: "2" })], ["風向", () => ({ WindDirection: "偏東風" })]]
        .map(([name, value]) => ({ ElementName: name, Time: steps.map((t) => ({ DataTime: iso(t), ElementValue: [value(t)] })) })),
    ].filter((el) => !names || names.split(",").includes(el.ElementName)) });
  const county = [town("大安區", 25.0282, 121.5264), town("信義區", 25.0351, 121.5587), town("大同區", 25.0680, 121.5072)];
  const known = county.filter((t) => !net.unknownTowns.includes(t.LocationName));
  const towns = townName == null ? known : net.unknownTowns.includes(townName) ? [] : [town(townName, 25.03, 121.56)];
  return { success: "true", records: { Locations: [{ LocationsName: "臺北市", Location: towns }] } };
}

// CWA 1-week township forecast: 12-hour periods (06–18 day, 18–06 night) for 7 days, from the truth.
export function weekFixture(ms, townName) {
  let first = floorHours(ms, 12) + 6 * HOUR; // the 06:00 or 18:00 that started the current period
  if (first > ms) first -= 12 * HOUR;
  const periods = Array.from({ length: 14 }, (_, i) => first + i * 12 * HOUR);
  const span = (t) => Array.from({ length: 12 }, (_, h) => world.temp(t + h * HOUR));
  const wet = (t) => Array.from({ length: 12 }, (_, h) => world.rain(t + (h + 1) * HOUR)).some((x) => x > 0);
  const el = (name, value) => ({ ElementName: name, Time: periods.map((t) =>
    ({ StartTime: iso(t), EndTime: iso(t + 12 * HOUR), ElementValue: [value(t)] })) });
  return { success: "true", records: { Locations: [{ LocationsName: "臺北市", Location: [{
    LocationName: townName, Latitude: "25.03", Longitude: "121.56", WeatherElement: [
      el("最高溫度", (t) => ({ MaxTemperature: String(Math.round(Math.max(...span(t)))) })),
      el("最低溫度", (t) => ({ MinTemperature: String(Math.round(Math.min(...span(t)))) })),
      el("12小時降雨機率", (t) => ({ ProbabilityOfPrecipitation: wet(t) ? "60" : "10" })),
      el("天氣現象", (t) => ({ Weather: wet(t) ? "多雲時陰短暫陣雨" : "多雲", WeatherCode: wet(t) ? "09" : "04" })),
      el("紫外線指數", (t) => ({ UVIndex: "6", UVExposureLevel: "高量級" })),
    ] }] }] } };
}

// net.warnings: active CWA warnings, as { phenomena, significance, end: "YYYY-MM-DD HH:MM:SS" }.
export function warningsFixture(county) {
  return { success: "true", records: { location: [{ locationName: county, geocode: 63, hazardConditions: {
    hazards: net.warnings.map((w) => ({ info: { language: "zh-TW", phenomena: w.phenomena, significance: w.significance },
      validTime: { startTime: "2026-10-01 00:00:00", endTime: w.end } })) } }] } };
}

// The full texts of the warnings in net.warnings (W-C0033-002), all of Taiwan.
export const warningTextsFixture = () => ({ success: "true", records: { record: net.warnings.map((w) => ({
  datasetInfo: { datasetDescription: w.phenomena + w.significance, validTime: { startTime: "2026-10-01 00:00:00", endTime: w.end },
    issueTime: "2026-10-02 04:29:00" },
  contents: { content: { contentLanguage: "zh-TW", contentText: "\n      一、概述：" + w.phenomena + "，請注意。\n\n      二、注意事項\n      " } },
  hazardConditions: { hazards: { hazard: [{ info: { phenomena: w.phenomena, significance: w.significance,
    affectedAreas: { location: [{ locationName: "臺北市" }, { locationName: "新北市" }] } } }] } } })) } });

export const radarFixture = () => ({ cwaopendata: { dataid: "O-A0058-006", dataset: {
  datasetInfo: { parameterSet: { LongitudeRange: "118.0-124.0", LatitudeRange: "20.5-26.5", ImageDimension: "3600x3600" } },
  resource: { mimeType: "image/png", ProductURL: "https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-006.png" },
  DateTime: iso(clock.ms()) } } });

// Open-Meteo best-match extras: now, 10 days of hourly pressure and gusts, and daily summaries.
export function extrasFixture(ms) {
  const start = floorHours(ms, 24);
  const hours = Array.from({ length: 240 }, (_, i) => start + i * HOUR);
  const days = Array.from({ length: 10 }, (_, i) => start + i * 24 * HOUR);
  const dayTemps = (t) => Array.from({ length: 24 }, (_, h) => world.temp(t + h * HOUR) + 0.4);
  return {
    current: { time: hk(ms) + ":00", apparent_temperature: round1(world.temp(ms) + 2), relative_humidity_2m: 75,
      wind_speed_10m: 3.2, wind_direction_10m: 70, wind_gusts_10m: 7.5, pressure_msl: 1013.2, visibility: 24140, uv_index: 4.5 },
    hourly: { time: hours.map((t) => hk(t) + ":00"), pressure_msl: hours.map((t, i) => 1012 + i * 0.1),
      wind_gusts_10m: hours.map((t, i) => (i === 30 ? 12.4 : 6)),
      temperature_2m: hours.map((t) => round1(world.temp(t) + 0.4)), apparent_temperature: hours.map((t) => round1(world.temp(t) + 2.5)),
      relative_humidity_2m: hours.map((t) => (world.rain(t + HOUR) > 0 ? 95 : 70)), dew_point_2m: hours.map((t) => round1(world.temp(t) - 6)),
      precipitation_probability: hours.map((t) => (world.rain(t + HOUR) > 0 ? 70 : 10)), precipitation: hours.map((t) => world.rain(t + HOUR)),
      weather_code: hours.map((t) => (world.rain(t + HOUR) > 0 ? 61 : 2)), visibility: hours.map((t) => (world.rain(t + HOUR) > 0 ? 8000 : 24000)),
      wind_speed_10m: hours.map(() => 4), wind_direction_10m: hours.map(() => 45),
      uv_index: hours.map((t) => { const h = (t / HOUR + 8) % 24; return h >= 6 && h <= 18 ? round1(8 * Math.sin(((h - 6) / 12) * Math.PI)) : 0; }) },
    daily: { time: days.map((t) => hk(t).slice(0, 10)), weather_code: days.map((t, i) => [3, 61, 2, 0, 80, 95, 3, 1, 45, 71][i]),
      temperature_2m_max: days.map((t) => round1(Math.max(...dayTemps(t)))), temperature_2m_min: days.map((t) => round1(Math.min(...dayTemps(t)))),
      precipitation_probability_max: days.map((t, i) => [10, 80, 20, 0, 60, 70, 10, 5, 30, 40][i]), uv_index_max: days.map(() => 7.1) },
  };
}
// RainViewer: 13 radar frames, 10 minutes apart, ending at the last full 10 minutes.
export function rainviewerFixture() {
  const last = Math.floor(clock.ms() / 600e3) * 600;
  return { version: "2.0", host: "https://tilecache.rainviewer.com", radar: { nowcast: [],
    past: Array.from({ length: 13 }, (_, i) => ({ time: last - (12 - i) * 600, path: "/v2/radar/" + (last - (12 - i) * 600) })) } };
}
export function airFixture() {
  const start = floorHours(clock.ms(), 24), hours = Array.from({ length: 120 }, (_, i) => start + i * HOUR);
  const aqi = (i) => 40 + (i % 24 === 15 ? 45 : (i % 24) * 1.5); // worst at 15:00
  return { current: { time: hk(clock.ms()) + ":00", us_aqi: 55, pm2_5: 13, pm10: 18.6 },
    hourly: { time: hours.map((t) => hk(t) + ":00"), us_aqi: hours.map((t, i) => aqi(i)), pm2_5: hours.map((t, i) => aqi(i) / 4),
      pm10: hours.map(() => 20), ozone: hours.map(() => 90), nitrogen_dioxide: hours.map(() => 12), sulphur_dioxide: hours.map(() => 3),
      carbon_monoxide: hours.map(() => 210), us_aqi_pm2_5: hours.map((t, i) => aqi(i)), us_aqi_pm10: hours.map(() => 18),
      us_aqi_ozone: hours.map(() => 30), us_aqi_nitrogen_dioxide: hours.map(() => 10) } };
}
// The list of 降雨雷達 images CWA's website animates (Observe_radar_rain.js): for each radar (Area0 樹林 RCSL,
// Area1 南屯 RCNT, Area2 林園 RCLY), 3600 px (size0) and 1000 px (size1) images, newest first, every 2 minutes or
// so for the last 2 hours. net.rainRadarGap: a stretch of minutes ago with no images ([from, to]).
export function rainRadarListFixture(ms) {
  const stamp = (t) => new RealDate(t + 8 * HOUR).toISOString().replace(/\D/g, "").slice(0, 14);
  const text = (t) => stamp(t).replace(/^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)$/, "$1/$2/$3 $4:$5:$6");
  const areas = ["RCSL", "RCNT", "RCLY"].map((code, a) => {
    const times = [];
    for (let i = 0; i < 60; i++) {
      const t = ms - 60e3 - a * 25e3 - i * 120e3 - (i % 3) * 7e3, ago = (ms - t) / 60e3; // irregular seconds, like the real list
      if (!net.rainRadarGap || ago < net.rainRadarGap[0] || ago > net.rainRadarGap[1]) times.push(t);
    }
    const size = (n, s) => `\t'size${s}':{\n` + times.map((t, i) => `\t${i}:{"img":'CV1_${code}_${n}/CV1_${code}_${n}_${stamp(t)}_` +
      `${noise(code, n, t).toString(16).slice(3).padEnd(64, "0")}.png', 'text':'${text(t)}'},`).join("\n") + "\n\t},";
    return `'Area${a}':{\n${size(3600, 0)}\n${size(1000, 1)}\n},`;
  });
  return "var RadarRainImg = {\n" + areas.join("\n") + "\n};\n";
}

// [bias, noise] of each model's temperature vs truth; only some models give rain chance.
export const MODEL_ERRORS = {
  jma_msm: [0.2, 0.4], ecmwf_ifs: [-0.3, 0.4], ecmwf_aifs025_single: [0.5, 0.6], icon_seamless: [1.0, 0.8],
  gfs_seamless: [2.0, 1.0], ukmo_seamless: [-0.8, 0.6], cma_grapes_global: [1.5, 1.2],
};
const POP_MODELS = ["ecmwf_ifs", "icon_seamless", "gfs_seamless", "ukmo_seamless"];

export function openMeteoFixture(url, ms) {
  const q = new URL(url).searchParams;
  const models = q.get("models").split(",");
  const start = floorHours(ms, 24) - 24 * HOUR; // past_days=1, forecast_days=3
  const issued = hk(ms);
  const hourly = { time: [] };
  for (let i = 0; i < 96; i++) {
    const t = start + i * HOUR;
    hourly.time.push(hk(t) + ":00");
    for (const m of models) {
      const [bias, amp] = MODEL_ERRORS[m];
      (hourly["temperature_2m_" + m] ||= []).push(round1(world.temp(t) + bias + amp * noise(m, hk(t), issued)));
      // gfs always says 60 %; the others know when it rains
      (hourly["precipitation_probability_" + m] ||= []).push(!POP_MODELS.includes(m) ? null
        : m === "gfs_seamless" ? 60 : world.rain(t) > 0 ? 80 : 10);
      (hourly["precipitation_" + m] ||= []).push(world.rain(t));
    }
  }
  return { latitude: Number(q.get("latitude")), longitude: Number(q.get("longitude")),
    utc_offset_seconds: 28800, timezone: "Asia/Taipei", hourly };
}

// ---------------- Scriptable API mocks ----------------
// net.cwa: "fixture" | "live" | "unauthorized" | "down";  net.om: "fixture" | "live" | "down"
// net.cwaKey: when set, the CWA fixture only accepts that key. net.raw: last response per URL.
// net.rainviewer: "fixture" | "live" | "down".
// net.cwaSite: "fixture" | "live" | "down" (CWA's website: the list of 降雨雷達 images).
// net.delay: { "host part": ms } makes matching requests answer that much later, or time out after the request's
// timeoutInterval (seconds) if that is shorter, as a stalled connection does. net.times: when each request began
// and ended (real ms).
export const net = { cwa: "fixture", om: "fixture", rainviewer: "fixture", cwaSite: "fixture", rainRadarGap: null,
  cwaKey: null, unknownTowns: [], warnings: [], log: [], raw: {}, delay: {}, times: [] };
async function lag(req) {
  const entry = { url: req.url, start: RealDate.now(), end: null };
  net.times.push(entry);
  const ms = Object.entries(net.delay).find(([part]) => req.url.includes(part))?.[1] || 0;
  const limit = req.timeoutInterval * 1000;
  if (ms) await new Promise((r) => setTimeout(r, Math.min(ms, limit)));
  entry.end = RealDate.now();
  if (ms > limit) throw new Error("The request timed out.");
}
class Request {
  constructor(url) { this.url = url; this.timeoutInterval = 60; }
  async loadJSON() {
    net.log.push(this.url);
    await lag(this);
    return (net.raw[this.url] = await this.respond());
  }
  async loadString() {
    net.log.push(this.url);
    await lag(this);
    if (this.url.includes("www.cwa.gov.tw/")) {
      if (net.cwaSite === "down") throw new Error("The request timed out.");
      if (net.cwaSite === "fixture") return rainRadarListFixture(clock.ms());
    }
    return (await fetch(this.url)).text();
  }
  async respond() {
    if (this.url.includes("opendata.cwa.gov.tw")) {
      if (net.cwa === "down") throw new Error("The request timed out.");
      const keyOk = !net.cwaKey || this.url.includes("Authorization=" + encodeURIComponent(net.cwaKey) + "&");
      if (net.cwa === "unauthorized" || !keyOk) return { message: "Unauthorized" };
      if (net.cwa === "fixture") {
        const q = new URL(this.url).searchParams, dataset = Number((this.url.match(/F-D0047-(\d+)/) || [])[1]);
        if (this.url.includes("O-A0001-001")) return stationsFixture(clock.ms(), q.get("StationId") && q.get("StationId").split(","));
        if (this.url.includes("W-C0033-001")) return warningsFixture(q.get("locationName"));
        if (this.url.includes("W-C0033-002")) return warningTextsFixture();
        if (this.url.includes("O-A0058-006")) return radarFixture();
        if (this.url.includes("O-A0084-")) return { cwaopendata: { dataset: { DateTime: iso(clock.ms()).replace(":00:00+", ":08:00+") } } };
        if (dataset % 4 === 3) return weekFixture(clock.ms(), q.get("LocationName")); // 1-week sets: 003, 007, … 063
        return forecastFixture(clock.ms(), q.get("LocationName"), q.get("ElementName"));
      }
    } else if (this.url.includes("rainviewer.com")) {
      if (net.rainviewer === "down") throw new Error("The request timed out.");
      if (net.rainviewer === "fixture") return rainviewerFixture();
    } else if (this.url.includes("open-meteo.com")) {
      if (net.om === "down") throw new Error("The Internet connection appears to be offline.");
      if (net.om === "fixture") {
        if (this.url.includes("air-quality")) return airFixture();
        return this.url.includes("models=") ? openMeteoFixture(this.url, clock.ms()) : extrasFixture(clock.ms());
      }
    }
    const res = await fetch(this.url);
    return res.json();
  }
}

const fileManager = {
  local() { return fileManager; }, iCloud() { env.usedICloud = true; return fileManager; },
  documentsDirectory: () => stateDir, joinPath: (a, b) => path.join(a, b),
  fileExists: (p) => fs.existsSync(p), createDirectory: (p) => fs.mkdirSync(p, { recursive: true }),
  readString: (p) => fs.readFileSync(p, "utf8"), writeString: (p, s) => fs.writeFileSync(p, s),
};
export const stateFile = path.join(stateDir, "taiwan-weather", "state.json");
export function resetState() { fs.rmSync(path.dirname(stateFile), { recursive: true, force: true }); }
export const placeFile = (name) => path.join(stateDir, "taiwan-weather", `place-${name}.json`);
export const settingsFile = path.join(stateDir, "taiwan-weather", "settings.json");
export const readState = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));

// Widget tree: every element records what the script set on it.
class WidgetStack {
  constructor() { this.type = "stack"; this.layout = "h"; this.align = "top"; this.spacing = 0; this.children = []; }
  add(o) { this.children.push(o); return o; }
  addStack() { return this.add(new WidgetStack()); }
  addText(text) { return this.add({ type: "text", text }); }
  addImage(image) { return this.add({ type: "image", symbol: image.symbol }); }
  addSpacer(length) { return this.add({ type: "spacer", length: length ?? null }); }
  layoutVertically() { this.layout = "v"; } layoutHorizontally() { this.layout = "h"; }
  topAlignContent() { this.align = "top"; } centerAlignContent() { this.align = "center"; }
  bottomAlignContent() { this.align = "bottom"; }
  setPadding(top, leading, bottom, trailing) { this.padding = [top, leading, bottom, trailing]; }
}
class ListWidget extends WidgetStack {
  constructor() { super(); this.type = "widget"; this.layout = "v"; }
  async presentSmall() { env.presented = "small"; } async presentMedium() { env.presented = "medium"; }
  async presentLarge() { env.presented = "large"; }
}
/** All text in a widget tree, depth first. */
export const texts = (node) => node.type === "text" ? [node.text] : (node.children || []).flatMap(texts);

// SF Symbols the script may use (SFSymbol.named returns null for unknown names, like Scriptable).
export const KNOWN_SYMBOLS = new Set(["sun.max.fill", "moon.stars.fill", "cloud.sun.fill", "cloud.moon.fill",
  "cloud.fill", "cloud.rain.fill", "cloud.drizzle.fill", "cloud.bolt.rain.fill", "cloud.fog.fill", "cloud.snow.fill"]);

export const keychain = new Map();
export const alerts = { answers: [], shown: [] }; // queue answers as { button, text }
class Alert {
  constructor() { this.fields = []; this.actions = []; }
  addTextField(placeholder) { this.fields.push(placeholder); }
  addAction(title) { this.actions.push(title); }
  addCancelAction(title) { this.cancel = title; }
  async present() { alerts.shown.push(this); this.answer = alerts.answers.shift() || { button: -1 }; return this.answer.button; }
  textFieldValue() { return this.answer.text ?? ""; }
}

// env.geocode(lat, lon): what Apple's reverse geocoder answers (placemarks); it may throw.
// env.pages: every page the full view drew, in order; env.pageState: what the page's pageState() answers.
export const env = { location: HOME, geocode: () => [], geocodeCalls: 0, usedICloud: false,
  widget: null, html: null, presented: null, loads: 0, webview: null, notifications: [], pages: [], pageState: { y: 0, busy: false } };
// args.widgetParameter / args.queryParameters, as Scriptable passes them.
export const scriptArgs = { widgetParameter: null, queryParameters: {} };
/** Taps a link in the open full view and waits for the page to be redrawn. */
export async function tap(url) {
  const before = env.loads;
  const allowed = env.webview.shouldAllowRequest({ url });
  for (let i = 0; i < 500 && env.loads === before; i++) await new Promise((r) => setTimeout(r, 2));
  return allowed;
}
export const config = {};
export function setConfig(c) { for (const k of Object.keys(config)) delete config[k]; Object.assign(config, c); }

const globals = {
  __TEST__: true,
  Date: FakeDate,
  Request,
  FileManager: fileManager,
  Location: {
    setAccuracyToThreeKilometers() {},
    async current() {
      if (env.location === "hang") return new Promise(() => {}); // no GPS fix, ever
      if (!env.location) throw new Error("Location access denied");
      return env.location;
    },
    async reverseGeocode(latitude, longitude) { env.geocodeCalls++; return env.geocode(latitude, longitude); },
  },
  Keychain: {
    contains: (k) => keychain.has(k), get: (k) => keychain.get(k),
    set: (k, v) => keychain.set(k, v), remove: (k) => keychain.delete(k),
  },
  config,
  Script: { setWidget(w) { env.widget = w; }, complete() {}, name: () => "TaiwanWeather" },
  args: scriptArgs,
  Notification: class { async schedule() { env.notifications.push({ ...this }); } },
  ListWidget,
  Color: Object.assign(function Color(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; },
    { white() { return { hex: "#ffffff", alpha: 1 }; } }),
  Font: { systemFont: (size) => ({ size, bold: false }), boldSystemFont: (size) => ({ size, bold: true }) },
  Size: function Size(width, height) { this.width = width; this.height = height; },
  LinearGradient: function LinearGradient() { this.colors = []; this.locations = []; },
  SFSymbol: { named: (name) => (KNOWN_SYMBOLS.has(name) ? { image: { symbol: name } } : null) },
  Alert,
  WebView: class {
    constructor() { env.webview = this; }
    async loadHTML(html, baseURL) { // env.hangLoads: the page never finishes loading (a stalled map or font)
      env.html = html; env.pages.push(html); env.loads++; env.baseURL = baseURL;
      if (env.hangLoads) return new Promise(() => {});
    }
    async present() { env.presented = "webview"; if (env.keepOpen) await new Promise((r) => { env.close = r; }); }
    async evaluateJavaScript(js) {
      env.evaluated = js;
      return JSON.stringify(env.html && env.html.includes("window.pageState") ? env.pageState : { y: 0, busy: false });
    }
  },
  Timer: {
    schedule(ms, repeats, fn) {
      const id = repeats ? setInterval(fn, ms) : setTimeout(fn, ms);
      return { invalidate() { clearTimeout(id); clearInterval(id); } };
    },
  },
};

/** Evaluates TaiwanWeather.js with the mocks above and returns its functions. */
export async function loadScript() {
  const src = fs.readFileSync(path.join(here, "..", "TaiwanWeather.js"), "utf8");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const exportsLine = "\nreturn { hourKey, addHours, keyToDate, cwaElementHourly, blend, computeSkill, sourceParams," +
    " recordForecasts, recordObservation, hourlyRain, rainAcc, wxText, isNight, wxSymbol, nowText, summarize," +
    " nearestStation, nearestTown, TOWN_POINTS, COUNTY_DATASET, run, buildWidget, detailHTML, main, CONFIG, DRY_6H," +
    " sunTimes, moonPhase, feelsLike, dewPoint, beaufort, compass, wmoText, dailyForecast, outlook, findPlace, setLang, WORDS," +
    " nowcastFrom, rainRadarPixel, RAIN_RADARS, radarDBZ, RAINVIEWER_COLORS, sharedDownloads, savedForecast," +
    " placeholderHTML, fetchRainRadarFrames, pickFrames, rainRadarGrid, CWA_RADAR_COLORS, CWA_SITE, notifyChanges, radarOutlook, rainSummary, rainSentence, detailHours, detailPage, moonTimes, moonAltitude," +
    " sunElevation, windDegrees, fetchWarningTexts, fetchAir, fetchExtras };";
  const factory = new AsyncFunction(...Object.keys(globals), src + exportsLine);
  return factory(...Object.values(globals));
}
