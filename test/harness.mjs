// Tests for TaiwanWeather.js, run under Node with mocked Scriptable APIs (see env.mjs).
//   node test/harness.mjs            -> all tests on fixtures, then one live run: real Open-Meteo,
//                                       and real CWA too when CWA_KEY is set in .env or the environment
//   OFFLINE=1 node test/harness.mjs  -> skip the live run
// Writes test/.state/detail.html (the in-app view) and test/.state/widgets.html (every widget size).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as E from "./env.mjs";
import { DEVICES, FAMILIES, estimateHeight, estimateWidth, widgetHTML, previewPage } from "./preview.mjs";
import { decodePNG } from "./png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dotenv = path.join(here, "..", ".env"); // never committed
if (fs.existsSync(dotenv)) {
  for (const line of fs.readFileSync(dotenv, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
const realKey = process.env.CWA_KEY || "";
fs.rmSync(E.stateDir, { recursive: true, force: true });
fs.mkdirSync(E.stateDir, { recursive: true });
const W = await E.loadScript();
const src = fs.readFileSync(path.join(here, "..", "TaiwanWeather.js"), "utf8");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("✓", name); }
  catch (e) {
    failed++;
    const at = String(e.stack).split("\n").find((l) => l.includes("harness.mjs")) || "";
    console.log("✗", name, "\n   ", String(e.message).split("\n").slice(0, 14).join("\n    "), "\n   ", at.trim());
  }
};
const CONFIG0 = { ...W.CONFIG };
function reset({ at = null, cwa = "fixture", om = "fixture" } = {}) {
  Object.assign(E.clock, { now: at });
  Object.assign(E.net, { cwa, om, rainviewer: "fixture", cwaSite: "fixture", rainRadarGap: null, cwaKey: null,
    unknownTowns: [], warnings: [], raw: {}, delay: {}, times: [] });
  Object.assign(E.scriptArgs, { widgetParameter: null, queryParameters: {} });
  Object.assign(W.CONFIG, CONFIG0);
  W.sharedDownloads.clear();
  W.setLang("en");
  E.net.log.length = 0;
  Object.assign(E.env, { location: E.HOME, geocode: () => [], geocodeCalls: 0, usedICloud: false,
    widget: null, html: null, presented: null, loads: 0, webview: null, notifications: [], pages: [], pageState: { y: 0, busy: false },
    hangLoads: false, keepOpen: false, close: null, baseURL: undefined });
  E.alerts.answers.length = 0; E.alerts.shown.length = 0;
  E.keychain.clear();
  E.setConfig({ runsInWidget: true, widgetFamily: "medium" });
  E.resetState();
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const waitFor = async (ok, ms = 3000) => {
  for (let t = 0; t < ms && !ok(); t += 5) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok(), "still waiting after " + ms + " ms");
};
// The side a page slides in from (data-enter on <body>; the CSS mentions both sides, so look at the tag itself).
const entered = (html) => (html.match(/<body [^>]*data-enter="([^"]*)"/) || [])[1];
const savePlaces = (places) => {
  fs.mkdirSync(path.dirname(E.settingsFile), { recursive: true });
  fs.writeFileSync(E.settingsFile, JSON.stringify({ places: places.map((p) => ({ county: p.slice(0, 3), name: p.slice(3) })) }));
};
const truthAt = (key) => E.world.temp(E.tw(key + ":00"));
const rawResponse = (part) => E.net.raw[E.net.log.find((u) => u.includes(part))];

// The CWA fields TaiwanWeather.js reads, checked on a raw response; returns what was seen.
function stationFormat(json) {
  const seen = { stations: json.records.Station.length, wgs84: 0, dailyHighLow: 0, precipitation: {}, weather: {} };
  for (const s of json.records.Station) {
    assert.ok(s.StationId && s.StationName && s.GeoInfo.CountyName && s.GeoInfo.TownName, JSON.stringify(s).slice(0, 300));
    assert.ok(Date.parse(s.ObsTime.DateTime) > 0, s.ObsTime.DateTime);
    if (s.GeoInfo.Coordinates.some((c) => c.CoordinateName === "WGS84" && parseFloat(c.StationLatitude) > 20)) seen.wgs84++;
    const daily = s.WeatherElement.DailyExtreme;
    if (daily?.DailyHigh?.TemperatureInfo && daily?.DailyLow?.TemperatureInfo) seen.dailyHighLow++;
    const p = s.WeatherElement.Now?.Precipitation;
    const kind = typeof p === "number" && p >= 0 ? "mm" : JSON.stringify(p);
    seen.precipitation[kind] = (seen.precipitation[kind] || 0) + 1;
    const wx = W.wxText(s.WeatherElement.Weather) ?? "none";
    seen.weather[wx] = (seen.weather[wx] || 0) + 1;
  }
  return seen;
}
function forecastFormat(json) {
  const towns = json.records.Locations[0].Location;
  for (const l of towns) {
    assert.ok(l.LocationName && parseFloat(l.Latitude) > 20 && parseFloat(l.Longitude) > 115, l.LocationName);
    assert.deepEqual(l.WeatherElement.map((e) => e.ElementName).sort(), ["3小時降雨機率", "天氣現象", "溫度"].sort());
    for (const e of l.WeatherElement) for (const t of e.Time) {
      assert.ok(t.DataTime || (t.StartTime && t.EndTime), JSON.stringify(t));
      assert.ok(t.ElementValue.length && Object.keys(t.ElementValue[0]).length, JSON.stringify(t));
    }
  }
  const el = (name) => towns[0].WeatherElement.find((e) => e.ElementName === name).Time;
  const hours = (a, b) => (Date.parse(b) - Date.parse(a)) / E.HOUR;
  const [t0, t1] = el("溫度"), pop = el("3小時降雨機率")[0], wx = el("天氣現象")[0];
  return { towns: towns.length, tempStepHours: hours(t0.DataTime || t0.StartTime, t1.DataTime || t1.StartTime),
    popHours: hours(pop.StartTime, pop.EndTime), samples: [t0.ElementValue[0], pop.ElementValue[0], wx.ElementValue[0]] };
}

// ---------------- Units ----------------
await test("hour keys are Taiwan time", () => {
  assert.equal(W.hourKey(new Date("2026-10-01T00:30:00Z")), "2026-10-01T08");
  assert.equal(W.addHours("2026-10-01T23", 2), "2026-10-02T01");
});

await test("CWA elements expand to hourly (interpolate temps, fill PoP intervals)", () => {
  const el = { Time: [
    { DataTime: "2026-10-01T12:00:00+08:00", ElementValue: [{ Temperature: "30" }] },
    { DataTime: "2026-10-01T15:00:00+08:00", ElementValue: [{ Temperature: "27" }] } ] };
  const h = W.cwaElementHourly(el);
  assert.equal(h["2026-10-01T13"], 29);
  assert.equal(h["2026-10-01T14"], 28);
  const pop = W.cwaElementHourly({ Time: [{ StartTime: "2026-10-01T12:00:00+08:00",
    EndTime: "2026-10-01T15:00:00+08:00", ElementValue: [{ ProbabilityOfPrecipitation: "40" }] }] });
  assert.deepEqual(Object.keys(pop), ["2026-10-01T12", "2026-10-01T13", "2026-10-01T14"]);
});

await test("nearest station skips missing (-99) values", () => {
  const s = W.nearestStation([{ t: null, latitude: 25.033, longitude: 121.5654 },
    { t: 29, latitude: 25.04, longitude: 121.56, name: "ok" }], { latitude: 25.033, longitude: 121.5654 });
  assert.equal(s.name, "ok");
});

await test("CWA codes: trace / dry-for-6h / missing rain, and missing weather text", () => {
  assert.equal(W.rainAcc("T"), 0);
  assert.equal(W.rainAcc(-98), W.DRY_6H);
  assert.equal(W.rainAcc("-98.0"), W.DRY_6H);
  assert.equal(W.rainAcc("X"), null);
  assert.equal(W.rainAcc(-99), null);
  assert.equal(W.rainAcc("12.5"), 12.5);
  for (const v of ["-99", "-", "X", "", null, -99]) assert.equal(W.wxText(v), null, String(v));
  assert.equal(W.wxText(" 多雲有雨 "), "多雲有雨");
});

await test("hourly rain from the daily total: increments, dry code, CWA's midnight rule", () => {
  const o = (acc, station = "S") => ({ t: 25, acc, station });
  const rain = (obs, k) => W.hourlyRain({ obs }, k);
  assert.equal(rain({ "2026-10-01T10": o(1.0), "2026-10-01T11": o(3.5) }, "2026-10-01T11"), 2.5);
  assert.equal(rain({ "2026-10-01T11": o(3.5) }, "2026-10-01T11"), null); // no reading an hour before
  assert.equal(rain({ "2026-10-01T10": o(1.0, "A"), "2026-10-01T11": o(3.5, "B") }, "2026-10-01T11"), null);
  assert.equal(rain({ "2026-10-01T10": o(3.5), "2026-10-01T11": o(1.0) }, "2026-10-01T11"), null); // a correction
  assert.equal(rain({ "2026-10-01T11": o(W.DRY_6H) }, "2026-10-01T11"), 0);
  assert.equal(rain({ "2026-10-01T10": o(W.DRY_6H), "2026-10-01T11": o(0.5) }, "2026-10-01T11"), 0.5);
  // Real CWA readings from 2026-10-06 23:00 to 10-07 01:00: the 00:00 reading still holds the old day.
  const panshi = { "2026-10-06T23": o(12.5), "2026-10-07T00": o(13.5), "2026-10-07T01": o(0.5) }; // 磐石
  assert.equal(rain(panshi, "2026-10-07T00"), 1);
  assert.equal(rain(panshi, "2026-10-07T01"), 0.5);
  const niutou = { "2026-10-06T23": o(0.5), "2026-10-07T00": o(0.5), "2026-10-07T01": o(0.5) }; // 牛頭山
  assert.equal(rain(niutou, "2026-10-07T00"), 0);
  assert.equal(rain(niutou, "2026-10-07T01"), 0.5);
});

await test("learning: a biased, noisy source loses weight and gets de-biased", () => {
  const state = { forecasts: {}, obs: {} };
  const base = "2026-09-01T00";
  for (let h = 0; h < 300; h++) {
    const k = W.addHours(base, h);
    const truth = 28 + 3 * Math.sin(h / 4);
    state.obs[k] = { t: truth, acc: 0, station: "S" };
    state.forecasts[k] = {
      cwa: { 0: { t: truth + 0.3, pop: 10 } },
      gfs_seamless: { 0: { t: truth + 2 + (h % 2 ? 1 : -1), pop: 60 } },
    };
  }
  const skill = W.computeSkill(state);
  const cwa = W.sourceParams(skill, "cwa", 0), gfs = W.sourceParams(skill, "gfs_seamless", 0);
  assert.ok(Math.abs(skill.gfs_seamless[0].bias - 2) < 0.01);
  assert.ok(gfs.bias > 1.8 && cwa.weight > 5 * gfs.weight, JSON.stringify({ cwa, gfs }));
  assert.ok(cwa.popWeight > gfs.popWeight); // gfs always says 60% with no rain
});

await test("nowcast pulls hour-0 temp to the station reading", () => {
  const now = W.hourKey(new Date());
  const series = {}; for (let h = 0; h < 48; h++) series[W.addHours(now, h)] = { t: 25, pop: 10 };
  const rows = W.blend({ cwa: series }, {}, now, { t: 28, time: now + ":00:00+08:00", weather: "陰" });
  assert.ok(Math.abs(rows[0].t - 28) < 1e-9);
  assert.ok(rows[4].t > 25 && rows[4].t < 27.5);
  assert.ok(Math.abs(rows[30].t - 25) < 0.01);
});

await test("night: sun position for Taipei at both solstices", () => {
  const night = (k) => W.isNight(k, { latitude: 25.03, longitude: 121.57 });
  // Jun 21: sunrise 05:05, sunset 18:47. Dec 21: sunrise 06:34, sunset 17:10. (Hours are checked at :30.)
  assert.deepEqual(["T03", "T04", "T05", "T12", "T17", "T18", "T19", "T23"].map((h) => night("2026-06-21" + h)),
    [true, true, false, false, false, false, true, true]);
  assert.deepEqual(["T05", "T07", "T12", "T16", "T17", "T18"].map((h) => night("2026-12-21" + h)),
    [true, false, false, false, true, true]);
});

await test("sunrise and sunset times, moon phases at known eclipses, feels-like, dew point, wind words", () => {
  // Open-Meteo's published times for Taipei 101 on 2026-10-08: sunrise 05:48, sunset 17:33.
  const sun = W.sunTimes("2026-10-08", { latitude: 25.03, longitude: 121.57 });
  assert.ok(Math.abs(sun.rise - (5 * 60 + 48)) <= 2 && Math.abs(sun.set - (17 * 60 + 33)) <= 2, JSON.stringify(sun));
  // Lunar eclipses happen at full moon, solar eclipses at new moon.
  for (const [utc, phase] of [["2025-03-14T07:00Z", "Full Moon"], ["2025-09-07T18:00Z", "Full Moon"], ["2026-03-03T11:00Z", "Full Moon"],
    ["2025-03-29T11:00Z", "New Moon"], ["2025-09-21T20:00Z", "New Moon"], ["2026-02-17T12:00Z", "New Moon"], ["2026-08-12T17:00Z", "New Moon"]]) {
    assert.equal(W.moonPhase(new Date(utc)).name, phase, utc);
  }
  const m = W.moonPhase(new Date("2026-02-17T12:00Z")); // new moon: next full about 14.8 days later, unlit
  assert.ok(m.lit < 0.02 && Math.abs((m.nextFull - Date.parse("2026-03-03T11:38Z")) / 864e5) < 1.2, JSON.stringify(m));
  assert.ok(Math.abs(W.feelsLike(30, 70, 2) - 34.4) < 0.1); // humid and still: feels warmer
  assert.ok(W.feelsLike(15, 40, 8) < 9);                     // dry and windy: feels colder
  assert.ok(Math.abs(W.dewPoint(30, 70) - 23.9) < 0.1);
  assert.deepEqual([0.2, 3.0, 10.8, 20.0, 33].map(W.beaufort), [0, 2, 6, 8, 12]);
  assert.deepEqual([0, 70, 225, 350].map(W.compass), ["N", "ENE", "SW", "N"]);
  assert.deepEqual([0, 1, 3, 45, 61, 80, 95, 71].map(W.wmoText), ["晴", "晴時多雲", "陰", "有霧", "有雨", "有雨", "雷雨", "有雪"]);
});

await test("next-hour nowcast: rain moving toward you arrives on time; rain moving away stops", () => {
  const size = 96, frame = (cx, cy, r, dbz) => {
    const g = new Uint8Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y * size + x] = dbz;
    return g;
  };
  // a 35 dBZ band (radius 8 px) moving 4 px east per 10 minutes, its centre 24 px west of you now
  const coming = W.nowcastFrom([frame(16, 48, 8, 35), frame(20, 48, 8, 35), frame(24, 48, 8, 35)], size, 0);
  assert.deepEqual(coming.motion, { dx: 0.4, dy: 0 }); // cells per minute
  const first = coming.steps.find((s) => s.mmh > 0); // its edge reaches you after (24 - 8 - 1) / 4 × 10 ≈ 37.5 min
  assert.ok(first && first.min >= 30 && first.min <= 40, JSON.stringify(first));
  assert.ok(coming.steps[0].mmh === 0 && Math.abs(first.mmh - 5.6) < 0.2, "35 dBZ is about 5.6 mm/h");
  // a shower over you moving 3 px north per 10 minutes: it has left after (8 + 1) / 3 × 10 = 30 min
  const going = W.nowcastFrom([frame(48, 54, 8, 30), frame(48, 51, 8, 30), frame(48, 48, 8, 30)], size, 0);
  assert.deepEqual(going.motion, { dx: 0, dy: -0.3 });
  const stop = going.steps.find((s) => s.mmh === 0);
  assert.ok(going.steps[0].mmh > 0 && stop.min >= 25 && stop.min <= 35, JSON.stringify(stop));
  // CWA's frames come every 2 minutes, so the ones picked can be 8 and 12 minutes apart, or only two: the same band
  // at the same speed (0.4 px a minute) arrives at the same time, and an image 4 minutes old counts too
  const uneven = W.nowcastFrom([frame(16, 48, 8, 35), frame(19.2, 48, 8, 35), frame(24, 48, 8, 35)], size, 0, [8, 12]);
  assert.ok(Math.abs(uneven.motion.dx - 0.4) < 0.05 && uneven.motion.dy === 0, JSON.stringify(uneven.motion));
  const two = W.nowcastFrom([frame(20, 48, 8, 35), frame(24, 48, 8, 35)], size, 4, [10]);
  assert.deepEqual(two.motion, { dx: 0.4, dy: 0 });
  assert.equal(two.steps.find((s) => s.mmh > 0).min, first.min - 5, "4 minutes older: rain 4 minutes sooner (5-minute steps)");
  // nothing on the radar: no rain, and no motion guessed
  const none = W.nowcastFrom([frame(0, 0, 0, 0), frame(0, 0, 0, 0), frame(0, 0, 0, 0)], size, 0);
  assert.ok(none.steps.every((s) => s.mmh === 0) && !none.moving);
  // one stray 45 dBZ pixel right over you (a ship, birds, clutter) isn't rain; four pixels of a shower are
  const cells = (list) => { const g = new Uint8Array(size * size); for (const [x, y, v] of list) g[y * size + x] = v; return g; };
  const speck = cells([[48, 48, 45]]), shower = cells([[47, 48, 30], [48, 48, 30], [48, 47, 30], [49, 49, 30]]);
  assert.ok(W.nowcastFrom([speck, speck, speck], size, 0).steps.every((s) => s.mmh === 0));
  assert.ok(W.nowcastFrom([shower, shower, shower], size, 0).steps.every((s) => s.mmh > 2));
});

await test("radar colours: RainViewer's colours read back as dBZ; its see-through tan (clutter, drizzle) is dry", () => {
  const colors = W.RAINVIEWER_COLORS.split(" "), rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  assert.equal(colors.length, 51, "15 to 65 dBZ");
  // each colour once; then 13 dBZ tan (alpha 180), a clear pixel, a green RainViewer doesn't use, and 15 dBZ off by one
  const px = [...colors.map((h) => [...rgb(h), 255]), [218, 204, 147, 180], [0, 0, 0, 0], [12, 200, 40, 255], [137, 220, 238, 255]];
  const { dbz, seen, odd } = W.radarDBZ(new Uint8ClampedArray(px.flat()), W.RAINVIEWER_COLORS);
  assert.deepEqual([...dbz.slice(0, 51)], colors.map((_, i) => 15 + i));
  assert.deepEqual([...dbz.slice(51)], [0, 0, 0, 15]);
  assert.deepEqual([seen, odd], [53, 1]);
  // what the old reading (grey = dBZ + 32) made of RainViewer's colours: the tan clutter was 186 dBZ, a downpour,
  // and 30 dBZ rain (#005588, red 0) was dry
  assert.deepEqual([218 - 32, Math.max(0, 0x00 - 32)], [186, 0]);
});

// The page's crop of a 降雨雷達 image (RGBA, width × width): size × block pixels a side, with your pixel in the
// centre cell, as its canvas draws it (off the image: transparent).
const radarCrop = (rgba, width, px, size, block) => {
  const side = size * block, out = new Uint8ClampedArray(side * side * 4);
  const [dx, dy] = px.map((v) => Math.round((size / 2 + 0.5) * block - 0.5 - v));
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sx = x - dx, sy = y - dy;
    if (sx < 0 || sy < 0 || sx >= width || sy >= width) continue;
    out.set(rgba.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * side + x) * 4);
  }
  return out;
};

await test("CWA 降雨雷達 colours: its colour bar reads back as 0–65 dBZ; shaded sectors are blind; map and text aren't rain", () => {
  const colors = W.CWA_RADAR_COLORS.split(" "), rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  assert.equal(colors.length, 66, "0 to 65 dBZ");
  assert.equal(new Set(colors).size, 66);
  // one cell per pixel (block 1): every colour, then white sea, grey land, shaded sea and land, a county border,
  // grey text, a colour CWA doesn't use, 30 dBZ yellow off by two, and a pixel off the image
  const px = [...colors.map((h) => [...rgb(h), 255]), [255, 255, 255, 255], [229, 229, 229, 255], [231, 236, 241, 255],
    [210, 215, 220, 255], [0, 0, 0, 255], [140, 143, 146, 255], [255, 0, 128, 255], [255, 253, 2, 255], [0, 0, 0, 0]];
  while (px.length < 81) px.push([255, 255, 255, 255]);
  const g = W.rainRadarGrid(new Uint8ClampedArray(px.flat()), W.CWA_RADAR_COLORS, 9, 1);
  assert.deepEqual([...g.dbz.slice(0, 66)], colors.map((_, i) => i));
  assert.deepEqual([...g.dbz.slice(66, 75)], [0, 0, 0, 0, 0, 0, 0, 30, 0]);
  assert.deepEqual([...g.blind.slice(66, 75)], [0, 0, 1, 1, 0, 0, 0, 0, 1]);
  assert.deepEqual([g.seen, g.odd], [67, 1]);
  // blocks of 2 × 2: the strongest echo of the four; blind when half or more is shaded
  const block = [[0, 255, 0, 255], [255, 255, 255, 255], [255, 255, 0, 255], [231, 236, 241, 255]]; // 15 dBZ, sea, 30 dBZ, shaded
  const quad = W.rainRadarGrid(new Uint8ClampedArray([block[0], block[1], block[2], block[3]].flat()), W.CWA_RADAR_COLORS, 1, 2);
  assert.deepEqual([quad.dbz[0], quad.blind[0]], [30, 0]);
  const shaded = W.rainRadarGrid(new Uint8ClampedArray([block[3], block[3], block[1], block[0]].flat()), W.CWA_RADAR_COLORS, 1, 2);
  assert.deepEqual([shaded.dbz[0], shaded.blind[0]], [15, 1]);
});

await test("降雨雷達 frames: the website's list of the last 40 minutes; three frames about 10 minutes apart are picked", async () => {
  reset({ at: E.tw("2026-10-27T19:23") });
  const frames = await W.fetchRainRadarFrames();
  assert.deepEqual(Object.keys(frames).sort(), ["RCLY", "RCNT", "RCSL"]);
  for (const list of Object.values(frames)) {
    assert.ok(list.length >= 19 && list.length <= 21, "40 minutes at 2-minute steps: " + list.length);
    assert.ok(list.every((f, i) => !i || f.time < list[i - 1].time), "newest first");
    assert.ok(list.every((f) => /^CV1_RC[A-Z]{2}_1000\/CV1_RC[A-Z]{2}_1000_\d{14}_[0-9a-f]+\.png$/.test(f.path)), list[0].path);
  }
  // times are Taiwan time in the file names: the newest 樹林 image was taken a minute ago
  assert.equal(frames.RCSL[0].time, E.tw("2026-10-27T19:22"));
  assert.ok(frames.RCSL[0].path.includes("_20261027192200_"), frames.RCSL[0].path);
  const picked = W.pickFrames(frames.RCSL), gaps = picked.slice(1).map((f, i) => (f.time - picked[i].time) / 60e3);
  assert.equal(picked.length, 3);
  assert.equal(picked[2], frames.RCSL[0]);
  assert.ok(gaps.every((m) => m >= 7 && m <= 13), JSON.stringify(gaps));
  // the radar skipped 15–25 minutes ago: only the newest and the one about 10 minutes before it
  reset({ at: E.tw("2026-10-27T19:23") });
  E.net.rainRadarGap = [15, 25];
  const gappy = W.pickFrames((await W.fetchRainRadarFrames()).RCSL);
  assert.equal(gappy.length, 2);
  assert.deepEqual(W.pickFrames([]), []);
  // 南屯 on 2026-10-28: nothing between 22:28:33 and 22:36:56; 22:28:33 is still near enough to 10 minutes back
  const nantun = ["22:42:09", "22:40:25", "22:38:35", "22:36:56", "22:28:33", "22:25:38", "22:22:21", "22:20:41", "22:18:22"]
    .map((t) => ({ time: Date.parse(`2026-10-28T${t}+08:00`), path: t }));
  assert.deepEqual(W.pickFrames(nantun).map((f) => f.path), ["22:22:21", "22:28:33", "22:42:09"]);
  // the list can't be had
  reset({ at: E.tw("2026-10-27T19:23") });
  E.net.cwaSite = "down";
  await assert.rejects(W.fetchRainRadarFrames(), /^Error: CWA rain radar: The request timed out\.$/);
});

await test("weather symbols: day/night, rain, thunder, fog, snow; only known SF Symbol names", () => {
  const cases = [
    [["晴", 0, false], "sun.max.fill"], [["晴", 0, true], "moon.stars.fill"],
    [["多雲時晴", 10, false], "cloud.sun.fill"], [["多雲", 10, true], "cloud.moon.fill"],
    [["陰時多雲", 10, false], "cloud.fill"], [["陰短暫雨", 70, true], "cloud.rain.fill"],
    [["多雲午後短暫雷陣雨", 40, false], "cloud.bolt.rain.fill"], [["晴有霧", 0, false], "cloud.fog.fill"],
    [["有雨或雪", 80, false], "cloud.snow.fill"], [[null, 65, false], "cloud.rain.fill"],
    [[null, 35, true], "cloud.drizzle.fill"], [[null, 5, true], "cloud.moon.fill"],
  ];
  for (const [args, want] of cases) assert.equal(W.wxSymbol(...args), want, args.join(","));
  for (const name of src.match(/"[a-z]+(?:\.[a-z]+)*\.fill"/g)) assert.ok(E.KNOWN_SYMBOLS.has(name.slice(1, -1)), name);
});

await test("today's high/low covers the whole day, also late in the evening", () => {
  const rows = (now) => Array.from({ length: 48 }, (_, i) => ({ key: W.addHours(now, i), t: 25, pop: i === 15 ? 70 : 10 }));
  const station = { time: "2026-10-01T23:00:00+08:00", hi: 31.2, lo: 24.1 };
  let s = W.summarize(rows("2026-10-01T23"), {}, station);
  assert.deepEqual([s.hi, s.lo], [31.2, 24.1]);
  // tomorrow (all of 10-02) from the forecast rows
  assert.deepEqual(s.tomorrow, { hi: 25, lo: 25, pop: 70 });
  // no station: each earlier hour counts with the sources' mean
  const model = {};
  for (let h = 0; h < 23; h++) model[`2026-10-01T${String(h).padStart(2, "0")}`] = { t: 22 + h / 2 };
  s = W.summarize(rows("2026-10-01T23"), { gfs_seamless: model, jma_msm: model }, null);
  assert.deepEqual([s.hi, s.lo], [33, 22]);
  // just after midnight the station's daily values can still describe yesterday: ignored
  s = W.summarize(rows("2026-10-02T00"), {}, { ...station, time: "2026-10-02T00:10:00+08:00" });
  assert.deepEqual([s.hi, s.lo], [25, 25]);
});

await test("rain line: 'Rain now' only once the rainy hour has begun and the station sees rain; 'tmrw' for tomorrow", () => {
  const r = { summary: { nextRain: "2026-10-01T21", nextRainPop: 60 } };
  const wet = { ...r, station: { name: "信義", weather: "陰有雨", distance: 1 } };
  E.clock.now = E.tw("2026-10-01T20:40");
  assert.equal(W.nowText(r), "Rain ~21:00 (60%)");
  E.clock.now = E.tw("2026-10-01T21:10");
  assert.equal(W.nowText(r), "Rain likely 60%", "a forecast alone doesn't say it's raining");
  assert.equal(W.nowText(wet), "Rain now 60%");
  assert.equal(W.outlook(r), "Rain likely this hour (60%).");
  assert.equal(W.outlook(wet), "Rain now (60%).");
  W.setLang("zh");
  assert.deepEqual([W.nowText(r), W.nowText(wet), W.outlook(r)], ["可能下雨 60%", "正在下雨 60%", "這一小時可能下雨（60%）。"]);
  W.setLang("en");
  E.clock.now = E.tw("2026-10-01T23:20");
  assert.equal(W.nowText({ summary: { nextRain: "2026-10-02T15", nextRainPop: 73.4 } }), "Rain tmrw ~15:00 (73%)");
  assert.equal(W.nowText({ summary: { nextRain: null } }), "No rain next 24h");
  E.clock.now = null;
});

await test("rain line: a chance under 50 % isn't 'no rain'; likely rain soon after a chance is the one named", () => {
  const rows = (pops) => [...pops, ...Array(30 - pops.length).fill(10)].map((pop, i) => ({ key: W.addHours("2026-10-01T08", i), t: 25, pop }));
  const say = (pops) => { const summary = W.summarize(rows(pops), {}, null); return [W.nowText({ summary }), W.outlook({ summary })]; };
  E.clock.now = E.tw("2026-10-01T08:20");
  // under 50 % all day: the first hour from 20 % on, with its chance (this said "No rain next 24h" before)
  const s = W.summarize(rows([10, 10, 10, 10, 10, 10, 10, 30, 40, 30]), {}, null);
  assert.deepEqual([s.nextRain, s.nextRainPop, s.likelyRain], ["2026-10-01T15", 30, null]);
  assert.deepEqual(say([10, 10, 10, 10, 10, 10, 10, 30, 40, 30]), ["Rain ~15:00 (30%)", "Chance of rain around 15:00 (30%)."]);
  // a chance in this hour: not "Rain now"
  assert.deepEqual(say([30]), ["Rain chance 30%", "Chance of rain now (30%)."]);
  // 30 % at 09:00, 80 % at 11:00: the line names the likely rain, the card says both
  assert.deepEqual(say([10, 30, 40, 80]), ["Rain ~11:00 (80%)", "Chance of rain around 09:00 (30%). Rain likely around 11:00 (80%)."]);
  // likely only 6 hours after the first chance: the line names the chance
  assert.deepEqual(say([10, 30, 20, 10, 10, 10, 10, 70]), ["Rain ~09:00 (30%)", "Chance of rain around 09:00 (30%). Rain likely around 15:00 (70%)."]);
  assert.deepEqual(say([10, 15, 19]), ["No rain next 24h", "No rain expected in the next 24 hours."]);
  W.setLang("zh");
  assert.deepEqual(say([10, 30, 20, 10, 10, 10, 10, 70]), ["09:00 可能下雨 30%", "09:00 左右有機會下雨（30%）。15:00 左右可能下雨（70%）。"]);
  assert.deepEqual(say([30]), ["降雨機率 30%", "現在有機會下雨（30%）。"]);
  W.setLang("en");
  E.clock.now = null;
});

await test("rain notification: only when rain is likely (50 %+) within the hour, not for a chance", async () => {
  reset({ at: E.tw("2026-10-01T14:20") });
  const settings = { notify: { rain: true, warnings: true } };
  const r = (summary) => ({ place: "臺北市信義區", station: null, warnings: [], summary });
  assert.deepEqual(await W.notifyChanges({}, r({ nextRain: "2026-10-01T15", nextRainPop: 40, likelyRain: null }), settings), []);
  const out = await W.notifyChanges({}, r({ nextRain: "2026-10-01T14", nextRainPop: 30, likelyRain: "2026-10-01T15", likelyRainPop: 60 }), settings);
  assert.deepEqual(out.map((n) => [n.title, n.body]), [["🌧️ Rain soon · 臺北市信義區", "Rain likely around 15:00 (60%)."]]);
});

// ---------------- Pipeline (fixtures) ----------------
await test("pipeline on fixtures: CWA + 7 models, two runs, state persisted", async () => {
  reset({ at: E.tw("2026-10-01T23:20") });
  const r1 = await W.run("KEY"), r2 = await W.run("KEY");
  for (const r of [r1, r2]) {
    assert.deepEqual(r.errors, []);
    assert.deepEqual([...r.sources].sort(), [...Object.keys(E.MODEL_ERRORS), "cwa"].sort());
    assert.equal(r.place, "臺北市信義區");
    assert.equal(r.station.name, "信義");
    assert.equal(r.rows.length, 48);
    assert.equal(r.rows[0].key, "2026-10-01T23");
  }
  // late evening: today's high/low still include the afternoon (31°) and early morning (24°)
  assert.ok(r2.summary.hi >= 30.9 && r2.summary.lo <= 24.1, JSON.stringify(r2.summary));
  assert.equal(r2.rows[0].night, true);
  assert.equal(r2.rows[15].night, false); // 14:00 tomorrow
  assert.ok(Math.abs(r2.rows[0].t - E.world.temp(E.tw("2026-10-01T23:00"))) < 0.11, "hour 0 = station reading");
  const state = E.readState();
  assert.ok(state.obs["2026-10-01T23"] && Object.keys(state.forecasts).length >= 48);
  fs.writeFileSync(path.join(E.stateDir, "detail.html"), W.detailHTML(r2));
});

await test("CWA format checks accept the fixtures (they run on the real API when CWA_KEY is set)", async () => {
  reset({ at: E.tw("2026-10-02T15:10") });
  await W.run("KEY");
  const st = stationFormat(rawResponse("O-A0001-001")), fc = forecastFormat(rawResponse("F-D0047-061"));
  assert.deepEqual([st.stations, st.wgs84, st.dailyHighLow], [4, 4, 1]);
  assert.deepEqual(st.precipitation, { mm: 3, "-99": 1 });
  assert.deepEqual([fc.towns, fc.tempStepHours, fc.popHours], [1, 3, 3]); // LocationName asks for one township
});

await test("township: the nearest township centre, or Apple's answer when its names match CWA's", async () => {
  // every township centre maps to itself
  for (const t of W.TOWN_POINTS) assert.equal(W.nearestTown(t).name, t.name, t.county + t.name);
  assert.equal(W.TOWN_POINTS.length, 368);
  const border = { latitude: 25.0675, longitude: 121.512 }; // in 中山區, but nearer 大同區's centre
  reset({ at: E.tw("2026-10-02T15:10") });
  E.env.location = border;
  let r = await W.run("KEY");
  assert.deepEqual([r.place, r.placeVia], ["臺北市大同區", "nearest"]);
  reset({ at: E.tw("2026-10-02T15:10") });
  E.env.location = border;
  E.env.geocode = () => [{ name: "南京西路", administrativeArea: "台北市", locality: "台北市", subLocality: "中山區",
    location: { latitude: 25.0675, longitude: 121.512 } }];
  r = await W.run("KEY");
  assert.deepEqual([r.place, r.placeVia], ["臺北市中山區", "apple"]);
  assert.ok(E.net.log.some((u) => u.includes("F-D0047-061") && u.includes("LocationName=" + encodeURIComponent("中山區"))));
  // names Apple gives in English, or no answer at all: the nearest centre
  for (const geocode of [() => [{ administrativeArea: "Taipei City", subLocality: "Zhongshan District" }],
    () => { throw new Error("offline"); }]) {
    reset({ at: E.tw("2026-10-02T15:10") });
    Object.assign(E.env, { location: border, geocode });
    assert.equal((await W.run("KEY")).place, "臺北市大同區");
  }
});

await test("township lookup is reused while within 1 km, and redone after moving", async () => {
  reset({ at: E.tw("2026-10-02T15:10") });
  await W.run("KEY");
  E.env.location = { latitude: E.HOME.latitude + 0.003, longitude: E.HOME.longitude }; // ~330 m away
  await W.run("KEY");
  assert.equal(E.env.geocodeCalls, 1);
  E.env.location = { latitude: 25.0663, longitude: 121.5253 }; // 中山區, ~4.5 km away
  const r = await W.run("KEY");
  assert.equal(E.env.geocodeCalls, 2);
  assert.equal(r.place, "臺北市中山區");
});

await test("township forecast: one township by name, the whole county only if CWA doesn't know it", async () => {
  reset({ at: E.tw("2026-10-02T15:10") });
  E.net.unknownTowns = ["信義區"];
  const r = await W.run("KEY");
  const asked = E.net.log.filter((u) => u.includes("F-D0047-061"));
  assert.equal(asked.length, 2);
  assert.ok(asked[0].includes("LocationName=") && !asked[1].includes("LocationName="));
  assert.ok(r.sources.includes("cwa") && r.place === "臺北市大安區", r.place); // nearest point in the county list
});

await test("station list: fetched in full once a week; other runs ask only for the 3 nearest", async () => {
  const start = E.tw("2026-10-02T15:10");
  reset({ at: start });
  const stationUrls = () => E.net.log.filter((u) => u.includes("O-A0001-001"));
  await W.run("KEY");
  await W.run("KEY");
  const [full, near] = stationUrls();
  assert.ok(!full.includes("StationId=") && near.includes("StationId="), near);
  assert.deepEqual(new URL(near).searchParams.get("StationId").split(",").sort(), ["467350", "C0AC70", "X1"]);
  assert.equal(E.readState().stations.list.length, 4);
  E.clock.now = start + 8 * 24 * E.HOUR; // a week later: the full list again
  await W.run("KEY");
  assert.ok(!stationUrls()[2].includes("StationId="));
  assert.equal(E.env.usedICloud, false, "state stays on the device (iCloud may be full)");
});

await test("outside Taiwan: no CWA forecast and no far-away station, models only", async () => {
  reset({ at: E.tw("2026-10-01T12:00") });
  E.env.location = { latitude: 35.68, longitude: 139.76 }; // Tokyo
  const r = await W.run("KEY");
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.sources].sort(), Object.keys(E.MODEL_ERRORS).sort());
  assert.equal(r.station, null);
  assert.equal(r.place, "35.68, 139.76");
  assert.ok(!E.net.log.some((u) => u.includes("F-D0047")));
});

await test("CWA rejects the key: models still work, the error is shown", async () => {
  reset({ at: E.tw("2026-10-01T12:00"), cwa: "unauthorized" });
  const r = await W.run("BAD");
  assert.deepEqual(r.errors, ["CWA stations: Unauthorized"]);
  assert.equal(r.sources.length, 7);
});

await test("Open-Meteo down: CWA alone still gives a forecast", async () => {
  reset({ at: E.tw("2026-10-01T12:00"), om: "down" });
  const r = await W.run("KEY");
  assert.deepEqual(r.sources, ["cwa"]);
  assert.match(r.errors.join(), /offline/);
  assert.ok(r.rows[0].t > 20 && r.rows[0].t < 35);
});

await test("everything down: the last forecast is shown from the current hour on, marked stale", async () => {
  reset({ at: E.tw("2026-10-01T09:10") });
  await W.run("KEY");
  Object.assign(E.net, { cwa: "down", om: "down" });
  E.clock.now = E.tw("2026-10-01T12:05");
  const r = await W.run("KEY");
  assert.equal(r.stale, true);
  assert.equal(r.rows[0].key, "2026-10-01T12");
  assert.equal(r.station, null);
  assert.equal(r.errors.length, 2);
  E.clock.now = E.tw("2026-10-03T12:05"); // nothing left that covers this hour
  await assert.rejects(W.run("KEY"), /timed out/);
});

await test("old verification data is pruned after 21 days", async () => {
  reset({ at: E.tw("2026-10-01T12:00") });
  await W.run("KEY");
  const s = E.readState();
  s.obs["2026-09-01T00"] = { t: 20, acc: 0, station: "C0AC70" };
  s.forecasts["2026-09-01T00"] = { cwa: { 0: { t: 20, pop: 10 } } };
  fs.writeFileSync(E.stateFile, JSON.stringify(s));
  await W.run("KEY");
  const s2 = E.readState();
  assert.ok(!s2.obs["2026-09-01T00"] && !s2.forecasts["2026-09-01T00"]);
});

await test("learning over 10 simulated days: biased models are corrected and down-weighted", async () => {
  const start = E.tw("2026-09-01T00:05");
  reset({ at: start });
  for (let i = 0; i < 240; i++) { E.clock.now = start + i * E.HOUR; await W.run("KEY"); }
  E.clock.now = start + 240 * E.HOUR;
  const r = await W.run("KEY");
  const [gfs, jma, cwa] = ["gfs_seamless", "jma_msm", "cwa"].map((s) => r.skill[s][1]); // 6–24 h
  assert.ok(gfs.bias > 1.6 && gfs.bias < 2.05, "gfs bias " + gfs.bias);
  assert.ok(cwa.weight > gfs.weight * 4 && jma.weight > gfs.weight * 4, JSON.stringify({ gfs, jma, cwa }));
  assert.ok(r.skill.ecmwf_ifs[0].popWeight > 1.5 * r.skill.gfs_seamless[0].popWeight, "rain chance skill");
  // the blended 6–24 h forecast beats the plain average of the 7 models
  const om = E.openMeteoFixture("https://x/?latitude=25&longitude=121&models=" + Object.keys(E.MODEL_ERRORS).join(","), E.clock.ms());
  const rows = r.rows.slice(6, 24);
  const blendErr = mean(rows.map((h) => Math.abs(h.t - truthAt(h.key))));
  const rawErr = mean(rows.map((h) => {
    const i = om.hourly.time.indexOf(h.key + ":00");
    return Math.abs(mean(Object.keys(E.MODEL_ERRORS).map((m) => om.hourly["temperature_2m_" + m][i])) - truthAt(h.key));
  }));
  console.log(`   6–24 h error: blend ${blendErr.toFixed(2)}° vs model average ${rawErr.toFixed(2)}° · gfs bias learned ${gfs.bias.toFixed(2)}° · state ${(fs.statSync(E.stateFile).size / 1024).toFixed(0)} KB`);
  assert.ok(blendErr < 0.6 * rawErr);
  assert.ok(fs.statSync(E.stateFile).size < 1024 * 1024, "state file stays small");
});

// ---------------- Entry point & UI ----------------
await test("first run in the app asks for the key, saves it trimmed, then shows the detail view", async () => {
  reset({ at: E.tw("2026-10-01T15:30") });
  E.setConfig({ runsInApp: true });
  E.alerts.answers.push({ button: 0, text: "  CWA-TEST-KEY \n" });
  await W.main();
  assert.equal(E.keychain.get("CWA_API_KEY"), "CWA-TEST-KEY");
  assert.equal(E.alerts.shown.length, 1);
  assert.equal(E.env.presented, "webview");
  assert.match(E.env.html, /臺北市信義區/);
  assert.ok(E.net.log.some((u) => u.includes("Authorization=CWA-TEST-KEY")));
});

await test("a widget without a saved key never prompts and shows the models' forecast", async () => {
  reset({ at: E.tw("2026-10-01T15:30") });
  await W.main();
  assert.equal(E.alerts.shown.length, 0);
  assert.ok(!E.net.log.some((u) => u.includes("opendata.cwa.gov.tw")));
  assert.match(E.texts(E.env.widget).join(" "), /\d°/);
});

await test("a rejected key can be replaced from the app (and kept on Skip)", async () => {
  reset({ at: E.tw("2026-10-01T15:30") });
  E.net.cwaKey = "CWA-GOOD";
  E.keychain.set("CWA_API_KEY", "CWA-TYPO");
  E.setConfig({ runsInApp: true });
  E.alerts.answers.push({ button: -1 }); // Skip
  await W.main();
  assert.equal(E.keychain.get("CWA_API_KEY"), "CWA-TYPO");
  assert.match(E.alerts.shown[0].message, /Unauthorized/);
  assert.match(E.env.html, /class="err"/);
  E.alerts.answers.push({ button: 0, text: "CWA-GOOD" });
  await W.main();
  assert.equal(E.keychain.get("CWA_API_KEY"), "CWA-GOOD");
  assert.doesNotMatch(E.env.html, /class="err"/);
  assert.match(E.env.html, /臺北市信義區/);
});

await test("a widget with everything down and nothing saved shows an error instead of crashing", async () => {
  reset({ at: E.tw("2026-10-01T15:30"), cwa: "down", om: "down" });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInWidget: true, widgetFamily: "small" });
  await W.main();
  assert.match(E.texts(E.env.widget).join(" "), /^Weather error: /);
});

await test("the in-app view escapes text that comes from the network", async () => {
  reset({ at: E.tw("2026-10-01T15:30") });
  const r = await W.run("KEY");
  const html = W.detailHTML({ ...r, place: "<b>x</b>", errors: ['<img src=x onerror="alert(1)">'] });
  assert.ok(!html.includes("<img") && !html.includes("<b>x") && html.includes("&lt;img"));
});

await test("app view: ten days, details, air quality and radar are fetched only when the app is open", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInWidget: true, widgetFamily: "medium" });
  await W.main();
  const appOnly = ["air-quality", "O-A0058-006", "F-D0047-063", "daily=", "rainviewer"];
  assert.deepEqual(appOnly.filter((part) => E.net.log.some((u) => u.includes(part))), [], "widget runs stay light");
  E.net.log.length = 0;
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.deepEqual(appOnly.filter((part) => !E.net.log.some((u) => u.includes(part))), []);
  const r = E.readState().lastResult;
  assert.equal(r.days.length, 10);
  assert.equal(r.days[0].day, "2026-10-02");
  assert.deepEqual([r.days[0].hi, r.days[0].lo], [r.summary.hi, r.summary.lo]); // today = the blend incl. earlier hours
  assert.deepEqual([r.days[1].hi, r.days[1].lo], [r.summary.tomorrow.hi, r.summary.tomorrow.lo]);
  assert.ok(r.days[2].wx && r.days[9].wx, "every day has weather to draw");
  assert.ok(r.details.feels > 25 && r.details.rh === 70 && r.details.wind === 2 && r.details.gust === 5.5, JSON.stringify(r.details));
  assert.equal(r.air.aqi, 55);
  assert.deepEqual(r.radar.bounds, [[20.5, 118], [26.5, 124]]);
  assert.equal(r.gustMax, 12.4);
  assert.match(E.env.html, /Wind gusts up to 12 m\/s/);
  for (const tile of ["Air quality", "UV index", "Wind", "Rainfall", "Feels like", "Humidity", "Visibility", "Pressure", "Moon"]) {
    assert.ok(E.env.html.includes(tile + "</h3>"), tile);
  }
  assert.ok(/Sunset<\/h3>|Sunrise<\/h3>/.test(E.env.html));
  // each of the ten days opens its detail sheet
  assert.equal((E.env.html.match(/<li data-detail="conditions"(?: data-day="\d")?><span>(Today|Sun|Mon|Tue|Wed|Thu|Fri|Sat)<\/span>/g) || []).length, 10);
  assert.ok((E.env.html.match(/<li( class="sun")?><span>/g) || []).length >= 25, "25 hours plus sunrise/sunset");
  fs.writeFileSync(path.join(E.stateDir, "app.html"), E.env.html);
});

// What the page's detail sheets are given (const DETAIL = …), and every inline script of a page compiled.
const detailOf = (html) => JSON.parse(html.split("\n").find((l) => l.startsWith("const DETAIL = ")).slice(15, -1));
const scriptsCompile = (html) => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
  try { new Function(m[1]); } catch (e) { throw new Error(`page script ${i + 1}: ${e.message}`); }
});

await test("detail sheets: every card and tile opens one; ten days of hours, agreeing with the ten-day list", async () => {
  reset({ at: E.tw("2026-10-02T10:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  for (const t of ["10:20", "11:20", "12:20"]) { E.clock.now = E.tw("2026-10-02T" + t); await W.run("KEY"); } // what the station measured
  E.clock.now = E.tw("2026-10-02T13:20");
  E.net.warnings = [{ phenomena: "陸上強風", significance: "特報", end: "2026-10-02 23:00:00" }];
  E.setConfig({ runsInApp: true });
  await W.main();
  const html = E.env.html, r = E.readState().lastResult, D = detailOf(html);
  scriptsCompile(html);
  for (const kind of ["conditions", "nexthour", "warnings", "air", "uv", "sun", "wind", "rain", "feels", "humidity", "visibility", "pressure", "moon"]) {
    assert.ok(html.includes(`data-detail="${kind}"`), kind);
  }
  assert.ok(html.includes('<div class="sheet" id="detail" hidden>') && html.includes('id="map-full"'));
  // the radar's full screen has its own ✕ back, placed where the page's top starts (below the status bar)
  assert.ok(html.includes('id="map-back"') && html.includes(".radar.full .unfull { display: block; position: fixed; top: max(10px, env(safe-area-inset-top));"));
  // the hours: today 00:00 to the tenth day's 23:00, every series as long
  assert.equal(r.hours.start, "2026-10-02T00");
  assert.deepEqual([D.days.length, D.now, D.h.t.length], [10, 13, 240]);
  for (const [f, vals] of Object.entries(D.h)) assert.equal(vals.length, 240, f);
  // earlier today: what the station measured; today and tomorrow: the blend
  assert.deepEqual([10, 11, 12].map((i) => D.h.t[i]), [10, 11, 12].map((h) => Math.round(E.world.temp(E.tw(`2026-10-02T${h}:00`)) * 10) / 10));
  r.rows.slice(0, 35).forEach((row, i) => assert.equal(D.h.t[13 + i], Math.round(row.t * 10) / 10, row.key));
  // later days: their high, low, rain chance and UV peak are the ten-day list's
  r.days.forEach((d, day) => {
    const s = (f) => D.h[f].slice(day * 24, day * 24 + 24).filter((v) => v != null);
    if (day >= 2) {
      assert.ok(Math.abs(Math.max(...s("t")) - d.hi) < 0.06 && Math.abs(Math.min(...s("t")) - d.lo) < 0.06, `${d.day}: ${Math.min(...s("t"))}–${Math.max(...s("t"))} vs ${d.lo}–${d.hi}`);
      assert.ok(Math.abs(Math.max(...s("pop")) - d.pop) < 0.6, `${d.day} chance ${Math.max(...s("pop"))} vs ${d.pop}`);
    }
    assert.ok(Math.abs(Math.max(...s("uv")) - d.uv) < 0.06, `${d.day} UV ${Math.max(...s("uv"))} vs ${d.uv}`);
  });
  // CWA's township forecast for about 3 days (wind 偏東風 = 90°, 3 m/s), then Open-Meteo (45°, 4 m/s)
  assert.deepEqual([D.h.dir[13 + 24], D.h.wind[13 + 24], D.h.dir[200], D.h.wind[200]], [90, 3, 45, 4]);
  assert.ok(D.h.gust.every((g, i) => g == null || D.h.wind[i] == null || g >= D.h.wind[i]), "a gust is never weaker than the wind");
  // the coming hours lean toward the station: humidity now is the station's (70 %)
  assert.equal(D.h.rh[13], 70);
  // a sentence and a headline for every sheet, every day; air quality for 5 days
  for (const d of D.days) for (const k of ["conditions", "rain", "wind", "feels", "humidity", "visibility", "pressure", "uv", "sun", "moon"]) {
    assert.ok(d.text[k] && d.head[k], `${d.label} ${k}`);
  }
  assert.equal(D.air.days, 5);
  assert.equal(D.days[0].text.air, "Up to 85 (moderate) around 15:00, mostly PM2.5.");
  assert.match(D.days[0].text.conditions, /^High \d+° around 1[45]:00, low \d+° around 0\d:00\. Chance of rain up to \d+% around 1[4-6]:00\.$/);
  // UV: the peak is CWA's (6, not Open-Meteo's 7.1); sun protection while it's 3 or more
  assert.equal(D.days[0].text.uv, "Peaks at 6 (high) around 12:00. Use sun protection 08:00–17:00.");
  assert.equal(D.days[0].text.sun, "Sunrise 05:45, sunset 17:41: 11 h 56 min of daylight, 1 min less than the day before. " +
    "First light 05:22, last light 18:04."); // Taipei on 10-02
  assert.deepEqual(D.warnings, [{ title: "陸上強風特報", text: "一、概述：陸上強風，請注意。\n\n二、注意事項",
    meta: "until 10/02 23:00 · Issued 10/02 04:29", areas: "Areas：臺北市、新北市" }]);
  fs.writeFileSync(path.join(E.stateDir, "app-detail.html"), html);
  // 中文
  fs.writeFileSync(E.settingsFile, JSON.stringify({ lang: "zh" }));
  await W.main();
  const zh = detailOf(E.env.html);
  scriptsCompile(E.env.html);
  assert.equal(zh.days[0].label, "今天");
  assert.equal(zh.days[0].text.air, "最高 85（普通，15:00 左右），主要來自PM2.5（細懸浮微粒）。");
  assert.match(zh.days[0].text.wind, /^風速最大每秒 \d\.\d 公尺（\d 級，\d\d:00 左右），陣風每秒 \d+\.\d 公尺；多為(東|東北|東北東)風。$/);
  fs.writeFileSync(path.join(E.stateDir, "app-detail-zh.html"), E.env.html);
});

await test("detail sheets: a forecast saved yesterday starts at today's hours; none without them", () => {
  const r = { ...JSON.parse(fs.readFileSync(E.stateFile, "utf8")).lastResult };
  W.setLang("en");
  E.clock.now = E.tw("2026-10-03T09:10");
  const D = W.detailPage({ ...r, days: r.days.filter((d) => d.day >= "2026-10-03") });
  assert.deepEqual([D.days[0].label, D.now, D.h.t[0]], ["Today", 9, r.hours.t[24]]);
  assert.equal(W.detailPage({ ...r, hours: null }), null);
  E.clock.now = null;
});

await test("sun and moon: first light before sunrise; moonrise and moonset where the moon crosses the horizon", () => {
  const taipei = { latitude: 25.033, longitude: 121.5654 };
  const sun = W.sunTimes("2026-10-30", taipei), light = W.sunTimes("2026-10-30", taipei, -6);
  assert.ok(sun.rise - light.rise > 20 && sun.rise - light.rise < 26 && light.set - sun.set > 20, JSON.stringify([sun, light]));
  // the sun's height: about 52° at noon on 10-30 in Taipei, below the horizon at night
  assert.ok(Math.abs(W.sunElevation(E.tw("2026-10-30T11:50"), 25.033, 121.5654) - 52) < 1.5);
  assert.ok(W.sunElevation(E.tw("2026-10-30T23:00"), 25.033, 121.5654) < -30);
  // moonrise and moonset in Taipei as timeanddate.com gives them (November 2026), within 2 minutes; none when the
  // moon doesn't rise (11-02) or set (11-18) that day
  const mins = (s) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3)) : null);
  const almanac = [["2026-11-01", "23:07", "12:06"], ["2026-11-02", null, "12:49"], ["2026-11-09", "05:53", "16:51"],
    ["2026-11-18", "12:44", null], ["2026-11-24", "16:31", "05:38"], ["2026-11-27", "19:46", "09:03"]];
  for (const [day, rise, set] of almanac) {
    const m = W.moonTimes(day, { latitude: 25.0478, longitude: 121.5319 });
    for (const [ours, theirs] of [[m.rise, mins(rise)], [m.set, mins(set)]]) {
      assert.ok(theirs == null ? ours == null : Math.abs(ours - theirs) <= 2, `${day}: ${JSON.stringify(m)} vs ${rise}/${set}`);
    }
  }
  // the phase from where the moon is (timeanddate: 80.3 % lit, new moon 11-09 15:02, full moon 11-24 22:53)
  const phase = W.moonPhase(new Date(Date.parse("2026-10-30T08:56:31+08:00")));
  assert.ok(phase.name === "Waning Gibbous" && Math.abs(phase.lit - 0.803) < 0.01, JSON.stringify(phase));
  assert.ok(Math.abs(phase.nextNew - Date.parse("2026-11-09T15:02+08:00")) < 30 * 60e3, String(phase.nextNew));
  assert.ok(Math.abs(phase.nextFull - Date.parse("2026-11-24T22:53+08:00")) < 30 * 60e3, String(phase.nextFull));
  assert.deepEqual([W.windDegrees("偏東風"), W.windDegrees("東北風"), W.windDegrees("西南西風"), W.windDegrees("靜風")], [90, 45, 247.5, null]);
});

await test("ten days: later days average CWA's week and Open-Meteo, with CWA counting double", () => {
  const r = { rows: [{ key: "2026-10-02T13", wx: "多雲", pop: 10 }], summary: { hi: 31, lo: 24, tomorrow: { hi: 30, lo: 23, pop: 40 } } };
  const week = { "2026-10-04": { hi: 30, lo: 24, pop: 60, wx: "多雲時陰短暫陣雨", uv: 6 } };
  const extras = { days: { "2026-10-04": { hi: 33, lo: 21, pop: 30, code: 2, uv: 8 }, "2026-10-10": { hi: 27, lo: 20, pop: 10, code: 0, uv: 7 } } };
  const days = W.dailyForecast(r, week, extras);
  assert.deepEqual(days.map((d) => d.day), ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-10"]);
  assert.deepEqual([days[1].hi, days[1].lo, days[1].pop], [30, 23, 40]); // tomorrow from the blend alone
  assert.deepEqual([days[2].hi, days[2].lo, days[2].pop, days[2].wx, days[2].uv], [31, 23, 50, "多雲時陰短暫陣雨", 6]);
  assert.deepEqual([days[3].hi, days[3].wx], [27, "晴"]); // Open-Meteo only, its code drawn as CWA wording
});

await test("CWA warnings: shown in the widgets and the app; expired ones are dropped", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.net.warnings = [{ phenomena: "陸上強風", significance: "特報", end: "2026-10-02 23:00:00" },
    { phenomena: "濃霧", significance: "特報", end: "2026-10-02 09:00:00" }]; // the fog warning has ended
  const r = await W.run("KEY");
  assert.deepEqual(r.warnings.map((w) => w.title), ["陸上強風特報"]);
  assert.match(E.texts(W.buildWidget(r, "medium")).at(-1), /^⚠︎ 陸上強風特報 · \d\d:\d\d$/);
  assert.equal(E.texts(W.buildWidget(r, "accessoryRectangular")).at(-1), "⚠︎ 陸上強風特報");
  assert.match(W.detailHTML(r), /⚠️ 陸上強風特報<\/b> <span>until 10\/02 23:00/);
  E.clock.now = E.tw("2026-10-02T23:30"); // past its end, with no connection: the stale forecast drops it
  Object.assign(E.net, { cwa: "down", om: "down" });
  const stale = await W.run("KEY");
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.warnings, []);
});

await test("places from what people type: 台/臺, spaces, unique short names; ambiguous ones are refused", () => {
  assert.equal(W.findPlace("臺南市東區").county, "臺南市");
  assert.equal(W.findPlace(" 台南市 東區 ").name, "東區");
  assert.equal(W.findPlace("那瑪夏區").county, "高雄市");
  assert.equal(W.findPlace("那瑪夏").name, "那瑪夏區");
  for (const q of ["東區", "信義", "", "Tokyo"]) assert.equal(W.findPlace(q), null, q);
});

await test("saved places: own forecast and learning file; a widget's Parameter pins it, and a tap opens it", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.scriptArgs.widgetParameter = "台南市東區";
  E.setConfig({ runsInWidget: true, widgetFamily: "medium" });
  await W.main();
  assert.equal(E.texts(E.env.widget)[0], "臺南市東區");
  assert.equal(E.env.widget.url, "scriptable:///run/TaiwanWeather?place=" + encodeURIComponent("臺南市東區"));
  assert.ok(fs.existsSync(E.placeFile("臺南市東區")) && !fs.existsSync(E.stateFile), "learning kept apart from My Location");
  assert.ok(E.net.log.some((u) => u.includes("F-D0047-077") && u.includes("LocationName=" + encodeURIComponent("東區"))));
  assert.equal(E.env.geocodeCalls, 0, "a saved place needs no geocoding");
  // tapping that widget runs the script in the app with ?place=…: the full view opens on it and saves it
  Object.assign(E.scriptArgs, { widgetParameter: null, queryParameters: { place: "臺南市東區" } });
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.match(E.env.html, /<a class="chip on" href="tw-weather:\/\/show\?place=0">臺南市東區<\/a>/);
  E.scriptArgs.queryParameters = {};
  E.scriptArgs.widgetParameter = "東區"; // in three cities
  E.setConfig({ runsInWidget: true, widgetFamily: "small" });
  await W.main();
  assert.match(E.texts(E.env.widget).join(" "), /Unknown place "東區"/);
});

await test("full view: add, switch and remove places; switch to 中文; turn a notification off", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  const settings = () => JSON.parse(fs.readFileSync(E.settingsFile, "utf8"));
  assert.match(E.env.html, /📍 My Location/);
  assert.equal(E.env.webview.shouldAllowRequest({ url: "https://tile.openstreetmap.org/8/1/2.png" }), true);
  assert.equal(await E.tap("tw-weather://add?place=" + encodeURIComponent("花蓮縣花蓮市")), false);
  assert.match(E.env.html, /<p class="place">花蓮縣花蓮市<\/p>/);
  assert.deepEqual(settings().places, [{ county: "花蓮縣", name: "花蓮市" }]);
  await E.tap("tw-weather://show?place=here");
  assert.match(E.env.html, /<p class="place">臺北市信義區<\/p>/);
  await E.tap("tw-weather://lang?to=zh");
  for (const zh of ["📍 目前位置", "10 天預報", "空氣品質", "預報怎麼來的", '<html lang="zh-Hant-TW">']) assert.ok(E.env.html.includes(zh), zh);
  fs.writeFileSync(path.join(E.stateDir, "app-zh.html"), E.env.html);
  await E.tap("tw-weather://notify?rain=0");
  assert.deepEqual([settings().lang, settings().notify.rain, settings().notify.warnings], ["zh", false, true]);
  await E.tap("tw-weather://show?place=0");
  await E.tap("tw-weather://remove?place=0");
  assert.deepEqual(settings().places, []);
  assert.match(E.env.html, /<p class="place">臺北市信義區<\/p>/);
  // the widgets follow the language
  E.setConfig({ runsInWidget: true, widgetFamily: "small" });
  await W.main();
  assert.ok(E.texts(E.env.widget).some((t) => /^高\d+° 低\d+°$/.test(t)), E.texts(E.env.widget).join(" / "));
});

await test("notifications for My Location: rain within the hour once, each new warning once, only when on", async () => {
  reset({ at: E.tw("2026-10-02T14:20") }); // rain is due at 15:00
  E.keychain.set("CWA_API_KEY", "KEY");
  E.net.warnings = [{ phenomena: "大雨", significance: "特報", end: "2026-10-02 23:00:00" }];
  E.setConfig({ runsInWidget: true, widgetFamily: "small" });
  await W.main();
  assert.deepEqual(E.env.notifications.map((n) => n.title), ["🌧️ Rain soon · 臺北市信義區", "⚠️ 大雨特報 · 臺北市信義區"]);
  assert.match(E.env.notifications[0].body, /^Rain likely around 15:00 \(\d+%\)\.$/);
  assert.equal(E.env.notifications[1].body, "Until 10/02 23:00 · CWA");
  assert.equal(E.env.notifications[0].openURL, "scriptable:///run/TaiwanWeather");
  E.clock.now = E.tw("2026-10-02T14:40");
  await W.main();
  assert.equal(E.env.notifications.length, 2, "no repeats");
  E.net.warnings.push({ phenomena: "陸上強風", significance: "特報", end: "2026-10-02 23:00:00" });
  await W.main();
  assert.deepEqual(E.env.notifications.slice(2).map((n) => n.title), ["⚠️ 陸上強風特報 · 臺北市信義區"]);
  // a saved place never notifies; with both switches off, nothing does
  E.net.warnings.push({ phenomena: "濃霧", significance: "特報", end: "2026-10-02 23:00:00" });
  E.scriptArgs.widgetParameter = "臺南市東區";
  await W.main();
  E.scriptArgs.widgetParameter = null;
  fs.writeFileSync(E.settingsFile, JSON.stringify({ notify: { rain: false, warnings: false } }));
  await W.main();
  assert.equal(E.env.notifications.length, 3);
});

await test("hourly card vs radar: once the radar is read, the coming hour is the radar's; the forecast follows", () => {
  const steps = (wetFrom = null, wetTo = 60) => Array.from({ length: 13 }, (_, i) => ({ min: i * 5,
    mmh: wetFrom != null && i * 5 >= wetFrom && i * 5 <= wetTo ? 1.2 : 0 }));
  const plan = (o) => ({ minute: 32, decided: 2, sep: " ", none24: "No rain expected in the next 24 hours.", gust: "", keepNow: false,
    later: "Chance of rain tomorrow around 00:00 (23%).", ...o });
  // 宜蘭市 at 22:32 on 2026-10-28: the forecast said "Chance of rain now (35%)", the radar "No rain in the next hour"
  let o = W.radarOutlook(plan(), "No rain in the next hour.", steps());
  assert.equal(o.text, "No rain in the next hour. Chance of rain tomorrow around 00:00 (23%).");
  assert.deepEqual(o.hours, [false, false], "22:00 and 23:00 lose their rain chance and rain icons");
  // dry, and nothing later either: one sentence
  assert.equal(W.radarOutlook(plan({ later: "" }), "No rain in the next hour.", steps()).text, "No rain expected in the next 24 hours.");
  // rain from minute 40 (23:12): this hour stays dry, the next is the rainy one; the forecast after it still follows
  o = W.radarOutlook(plan(), "Light rain starting in about 40 min.", steps(40));
  assert.deepEqual([o.text, o.hours], ["Light rain starting in about 40 min. Chance of rain tomorrow around 00:00 (23%).", [false, true]]);
  // at 22:10 only this hour is the radar's; with gusts; in 中文 without spaces
  o = W.radarOutlook(plan({ minute: 10, decided: 1, later: "", gust: " Wind gusts up to 13 m/s." }), "Light rain for the next hour.", steps(0));
  assert.deepEqual([o.text, o.hours], ["Light rain for the next hour. Wind gusts up to 13 m/s.", [true]]);
  o = W.radarOutlook(plan({ sep: "", later: "明天 00:00 左右有機會下雨（23%）。" }), "未來一小時不會下雨。", steps());
  assert.equal(o.text, "未來一小時不會下雨。明天 00:00 左右有機會下雨（23%）。");
});

await test("hourly card vs radar: the page is given the forecast for after the coming hour, named so it can't overlap", async () => {
  const plan = (html) => new Function(html.split("\n").find((l) => l.includes("const plan = ")) + " return plan;")();
  reset({ at: E.tw("2026-10-02T13:20") }); // rain due 14:00–17:00
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  // 13:20: the radar decides 13:00; 14:00 (a chance) starts before the coming hour is over (14:20), so it is named 14:20
  let p = plan(E.env.html);
  assert.deepEqual([p.minute, p.decided, p.sep, p.keepNow], [20, 1, " ", false]);
  assert.match(p.later, /^Chance of rain around 14:20 \(\d+%\)\. Rain likely around 15:00 \(\d+%\)\.$/);
  assert.ok(E.env.html.includes('<p class="summary" id="outlook">') && E.env.html.includes("function radarOutlook("));
  assert.ok(!E.net.log.some((u) => u.includes("F-B0046-001")), "CWA's separate 2.7 MB radar forecast isn't fetched any more");
  // 13:40: the radar decides 13:00 and 14:00; the forecast picks up at 15:00, by its own hour
  reset({ at: E.tw("2026-10-02T13:40") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  p = plan(E.env.html);
  assert.deepEqual([p.minute, p.decided], [40, 2]);
  assert.match(p.later, /^Rain likely around 15:00 \(\d+%\)\.$/);
});

await test("next-hour radar: the 降雨雷達's green (15 dBZ, drizzle) is rain; RainViewer still starts at 20", () => {
  const size = 96, drizzle = new Uint8Array(size * size);
  for (let y = 40; y < 56; y++) for (let x = 40; x < 56; x++) drizzle[y * size + x] = 17; // green over you
  assert.ok(W.nowcastFrom([drizzle, drizzle, drizzle], size, 0, [10, 10], 15).steps.every((s) => s.mmh > 0.3 && s.mmh < 0.5));
  assert.ok(W.nowcastFrom([drizzle, drizzle, drizzle], size, 0).steps.every((s) => s.mmh === 0));
  assert.ok(src.includes("SIZE, Math.max(0, (Date.now() - newest.time) / 60000), gaps, 15)"), "the page reads the 降雨雷達 from 15 dBZ");
});

// What the page's next-hour script is given: its words, the 降雨雷達 to try (nearest first) and RainViewer's frames.
const nhConfig = (html) => {
  const line = html.split("\n").find((l) => l.includes("const words = ") && l.includes("cwaRadars = "));
  return line ? new Function(line + " return { words, cwaRadars, rv };")() : null;
};

await test("next hour: from the nearest 降雨雷達 (RainViewer when none sees you); the page counts as CWA's site", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  // loaded as a page of www.cwa.gov.tw, so it may read the images' pixels; it sends no referrer to anyone
  assert.equal(E.env.baseURL, "https://www.cwa.gov.tw/");
  assert.ok(E.env.html.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(E.env.html.includes("function rainRadarGrid(") && E.env.html.includes("function nowcastFrom("));
  let nh = nhConfig(E.env.html);
  assert.deepEqual(nh.cwaRadars.map((s) => s.name), ["樹林", "南屯"], "within 145 km of Taipei 101, nearest first");
  const [shulin] = nh.cwaRadars, [x, y] = W.rainRadarPixel(W.RAIN_RADARS[0], E.HOME, 1000);
  assert.deepEqual(shulin.px, [x, y]);
  // the 1000 px image is the 3600 px one scaled down (checked on their pixels): the same spot, 16.7 km E and 3.7 km N
  const [bx, by] = W.rainRadarPixel(W.RAIN_RADARS[0], E.HOME);
  assert.ok(Math.abs((bx + 0.5) / 3.6 - 0.5 - x) < 1e-9 && Math.abs((by + 0.5) / 3.6 - 0.5 - y) < 1e-9, JSON.stringify([x, y, bx, by]));
  assert.ok(Math.abs(x - 554.4) < 0.5 && Math.abs(y - 487.4) < 0.5, JSON.stringify([x, y]));
  assert.equal(shulin.frames.length, 3);
  assert.ok(shulin.frames.every((f) => f.url.startsWith("https://www.cwa.gov.tw/Data/radar_rain/CV1_RCSL_1000/CV1_RCSL_1000_")));
  const gaps = shulin.frames.slice(1).map((f, i) => (f.time - shulin.frames[i].time) / 60e3);
  assert.ok(gaps.every((m) => m >= 7 && m <= 13), JSON.stringify(gaps));
  assert.equal(shulin.note, "From CWA's 樹林 rain radar (13:19): the last 20 minutes, carried forward.");
  assert.equal(nh.rv.note, "From RainViewer's radar (13:20): the last 20 minutes, carried forward.");
  fs.writeFileSync(path.join(E.stateDir, "app-nexthour.html"), E.env.html);
  // 金門: no 降雨雷達 within reach: RainViewer only, and its forecast doesn't download the list
  E.scriptArgs.queryParameters = { place: "金門縣金城鎮" };
  await W.main();
  nh = nhConfig(E.env.html);
  assert.ok(nh.cwaRadars.length === 0 && nh.rv);
  assert.equal(JSON.parse(fs.readFileSync(E.placeFile("金門縣金城鎮"), "utf8")).lastResult.rainFrames, null);
  // CWA's website down: RainViewer, and the error says which list was missing
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  E.net.cwaSite = "down";
  await W.main();
  nh = nhConfig(E.env.html);
  assert.ok(nh.cwaRadars.length === 0 && nh.rv);
  assert.deepEqual(E.readState().lastResult.errors, ["CWA rain radar: The request timed out."]);
  // in 中文
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  fs.mkdirSync(path.dirname(E.settingsFile), { recursive: true });
  fs.writeFileSync(E.settingsFile, JSON.stringify({ lang: "zh" }));
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.equal(nhConfig(E.env.html).cwaRadars[0].note, "依氣象署樹林降雨雷達（13:19）過去 20 分鐘的回波推估。");
});

await test("radar card: the map stays over Taiwan; CWA 降雨雷達 tab, nearest radar first, your position on its image", async () => {
  // where Taiwan's northern and eastern tips are on the 樹林 image (found in its pixels)
  const shulin = W.RAIN_RADARS[0];
  const [fx, fy] = W.rainRadarPixel(shulin, { latitude: 25.2974, longitude: 121.5361 }); // 富貴角, found at (1966, 1397)
  const [sx, sy] = W.rainRadarPixel(shulin, { latitude: 25.0063, longitude: 122.0007 }); // 三貂角, found at (2533, 1782)
  assert.ok(Math.hypot(fx - 1966, fy - 1397) < 20 && Math.hypot(sx - 2533, sy - 1782) < 20, JSON.stringify([fx, fy, sx, sy]));
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  const stations = (html) => [...html.matchAll(/<button type="button" data-i="\d"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  assert.deepEqual(stations(E.env.html), ["樹林", "南屯", "林園"]);
  assert.ok(E.env.html.includes("CWA rain radar at 樹林 13:08, every 2 minutes"), "the radar image's time");
  assert.ok(E.env.html.includes('data-tab="cwa"') && E.env.html.includes("O-A0084-001.png"));
  assert.ok(E.env.html.includes("minZoom: 7, maxBounds: TAIWAN") && E.env.html.includes("[[20.6, 117.6], [27.0, 123.4]]"));
  E.scriptArgs.queryParameters = { place: "高雄市鳳山區" };
  await W.main();
  assert.deepEqual(stations(E.env.html), ["林園", "南屯", "樹林"]);
});

await test("swiping: dots for each place, a slide-in from the side swiped, neighbours loaded ahead", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  fs.mkdirSync(path.dirname(E.settingsFile), { recursive: true });
  fs.writeFileSync(E.settingsFile, JSON.stringify({ places: [{ county: "臺南市", name: "東區" }, { county: "花蓮縣", name: "花蓮市" }] }));
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.equal((E.env.html.match(/<a class="dot/g) || []).length, 3);
  fs.writeFileSync(path.join(E.stateDir, "app-places.html"), E.env.html);
  assert.ok(E.env.html.includes('const order = ["here",0,1], at = 0;'));
  // the place to the right (臺南市東區) is fetched in the background right away
  for (let i = 0; i < 300 && !fs.existsSync(E.placeFile("臺南市東區")); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(fs.existsSync(E.placeFile("臺南市東區")), "neighbour prefetched");
  const before = E.net.log.length;
  await E.tap("tw-weather://show?place=0&dir=left");
  assert.equal(entered(E.env.html), "left");
  assert.match(E.env.html, /<p class="place">臺南市東區<\/p>/);
  assert.ok(!E.net.log.slice(before).some((u) => u.includes("F-D0047-077")), "shown from the prefetch, no new download");
  await E.tap("tw-weather://show?place=here&dir=right");
  assert.equal(entered(E.env.html), "right");
  assert.ok(E.env.html.includes('const names = ["My Location","臺南市東區","花蓮縣花蓮市"]'), "names for the swipe's Loading… page");
});

await test("tapping any widget opens the full view, whatever its When Interacting option says", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  for (const family of ["small", "medium", "large", "accessoryRectangular"]) {
    E.setConfig({ runsInWidget: true, widgetFamily: family });
    await W.main();
    assert.equal(E.env.widget.url, "scriptable:///run/TaiwanWeather", family);
  }
});

await test("a slow Open-Meteo doesn't hold up CWA's forecast, and a stalled one is given up after its timeout", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  W.CONFIG.abroadTimeout = 0.3; // seconds (10 on the phone)
  E.net.delay = { "api.open-meteo.com": 5000 };
  const t0 = Date.now(), r = await W.run("KEY"), took = Date.now() - t0;
  assert.ok(took < 1500, took + " ms");
  assert.deepEqual(r.sources, ["cwa"]);
  assert.match(r.errors.join(" "), /timed out/);
  const cwa = E.net.times.find((t) => t.url.includes("F-D0047-061")), om = E.net.times.find((t) => t.url.includes("api.open-meteo.com"));
  assert.ok(cwa.end < om.end, "CWA's forecast came in before Open-Meteo was given up");
});

await test("the full view opens at once on the last saved forecast (marked Updating), then shows the new one where you were", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main(); // saves a forecast
  E.clock.now = E.tw("2026-10-02T13:50");
  E.env.pages.length = 0;
  E.net.delay = { "api.open-meteo.com": 300 };
  E.env.pageState = { y: 640, busy: false }; // scrolled down meanwhile
  await W.main();
  assert.equal(E.env.pages.length, 2);
  assert.ok(E.env.pages[0].includes("↻ Updating… (shown: 13:20)"), "the saved forecast, at once");
  fs.writeFileSync(path.join(E.stateDir, "app-updating.html"), E.env.pages[0]);
  assert.ok(!E.env.pages[0].includes('id="nh-chart"'), "no next hour from old radar frames");
  assert.ok(E.env.pages[0].includes("Rain radar · the blue dot is you"), "CWA's image is always the latest: no old time on it");
  assert.ok(!E.env.pages[1].includes("Updating…") && E.env.pages[1].includes('id="nh-chart"'));
  assert.ok(E.env.pages[1].includes("window.scrollTo(0, 640);"), "kept where it was scrolled");
  fs.writeFileSync(path.join(E.stateDir, "app-scrolled.html"), E.env.pages[1]);
});

await test("swiping to a place still loading: its name or its saved forecast after a second, then the new one", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  savePlaces(["臺南市東區", "花蓮縣花蓮市"]);
  W.CONFIG.swipeWaitMs = 50; // 1000 on the phone
  E.net.delay = { "F-D0047-077": 400, "F-D0047-079": 400 }; // 臺南市's forecasts are slow today
  E.setConfig({ runsInApp: true });
  await W.main();
  E.env.pages.length = 0;
  await E.tap("tw-weather://show?place=0&dir=left"); // never loaded before
  assert.ok(E.env.pages[0].includes('<p class="place">臺南市東區</p><p>Loading…</p>'), E.env.pages[0].slice(-300));
  await waitFor(() => E.env.pages.length === 2);
  assert.match(E.env.pages[1], /<p class="place">臺南市東區<\/p>[\s\S]*class="hours"/);
  // next time the app opens, 臺南市東區 has a saved forecast to show while the new one loads
  E.clock.now = E.tw("2026-10-02T13:50");
  await W.main();
  E.env.pages.length = 0;
  await E.tap("tw-weather://show?place=0&dir=left");
  assert.ok(E.env.pages[0].includes("↻ Updating… (shown: 13:20)") && entered(E.env.pages[0]) === "left");
  await waitFor(() => E.env.pages.length === 2);
  assert.ok(!E.env.pages[1].includes("Updating…") && entered(E.env.pages[1]) === "", "no second slide-in");
});

await test("the new forecast waits while you're touching the page or searching, then appears", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  E.clock.now = E.tw("2026-10-02T13:50");
  E.env.pages.length = 0;
  W.CONFIG.redrawRetryMs = 40;
  E.net.delay = { "api.open-meteo.com": 100 };
  E.env.pageState = { y: 120, busy: true };
  await W.main();
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(E.env.pages.length, 1, "not redrawn while busy");
  E.env.pageState = { y: 120, busy: false };
  await waitFor(() => E.env.pages.length === 2);
  assert.ok(E.env.pages[1].includes("window.scrollTo(0, 120);") && !E.env.pages[1].includes("Updating…"));
});

await test("a page that never finishes loading, or GPS that never answers, doesn't hold up swipes", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  savePlaces(["臺南市東區"]);
  Object.assign(W.CONFIG, { pageWaitMs: 50, locationWaitMs: 50 });
  E.setConfig({ runsInApp: true });
  E.env.hangLoads = true;
  E.env.location = "hang";
  const t0 = Date.now();
  await W.main();
  assert.ok(Date.now() - t0 < 2000, "opened in " + (Date.now() - t0) + " ms");
  assert.ok(E.env.html.includes('<p class="place">臺北市信義區</p>'), "the last known place (Taipei 101 by default)");
  await E.tap("tw-weather://show?place=0&dir=left");
  assert.ok(E.env.html.includes('<p class="place">臺南市東區</p>'));
  await E.tap("tw-weather://show?place=here&dir=right");
  assert.ok(E.env.html.includes('<p class="place">臺北市信義區</p>'));
  assert.match(E.env.html, /Last switch: forecast \d\.\d s, page \d\.\d s/, "how long the last switch took");
});

await test("refresh: widgets ask for a new forecast after 10 minutes; the open page refreshes itself", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  await W.main();
  assert.equal(E.env.widget.refreshAfterDate.getTime() - E.tw("2026-10-02T13:20"), 10 * 60e3);
  W.CONFIG.refreshMinutes = 0.002; // the page's timer: every 0.06 s here (every 5 min on the phone)
  E.setConfig({ runsInApp: true });
  E.env.keepOpen = true; // the page stays open until env.close()
  const opened = W.main();
  await waitFor(() => E.env.close && E.env.pages.length >= 2);
  E.env.pages.length = 0;
  E.clock.now = E.tw("2026-10-02T13:40"); // the forecast is now 20 minutes old
  await waitFor(() => E.env.pages.length >= 1);
  assert.ok(E.env.pages[0].includes("Updated 13:40"), E.env.pages[0].match(/Updated [^<]*/)?.[0]);
  E.env.close();
  await opened;
});

await test("places in one session share the radar, warnings, station list and 降雨雷達 list downloads", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  savePlaces(["臺北市大安區", "臺北市中山區"]);
  E.setConfig({ runsInApp: true });
  await W.main();
  await waitFor(() => fs.existsSync(E.placeFile("臺北市大安區")));
  await E.tap("tw-weather://show?place=0&dir=left");
  await waitFor(() => fs.existsSync(E.placeFile("臺北市中山區")));
  await new Promise((r) => setTimeout(r, 50));
  const count = (part, not) => E.net.log.filter((u) => u.includes(part) && !(not && u.includes(not))).length;
  assert.equal(count("F-D0047-061?"), 3, "each place still gets its own township forecast");
  assert.deepEqual([count("weather-maps.json"), count("O-A0058-006"), count("O-A0084-001"), count("W-C0033-001"),
    count("O-A0001-001", "StationId="), count("Observe_radar_rain.js")], [1, 1, 1, 1, 1, 1]);
});

await test("a place that can't be loaded at all says so on its page, with Try again", async () => {
  reset({ at: E.tw("2026-10-02T13:20"), cwa: "down", om: "down" });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.match(E.env.html, /<p class="place">My Location<\/p><p>Couldn't load the forecast\. /);
  assert.ok(E.env.html.includes('<a href="tw-weather://show?place=here">Try again</a>'));
  fs.writeFileSync(path.join(E.stateDir, "app-failed.html"), E.env.html);
  E.net.cwa = "fixture"; E.net.om = "fixture";
  await E.tap("tw-weather://show?place=here");
  await waitFor(() => E.env.html.includes('class="hours"'));
});

await test("'Send a test' notifies now from the app, and once more from the next widget refresh", async () => {
  reset({ at: E.tw("2026-10-02T09:20") }); // no rain due, no warnings: only the tests notify
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.ok(E.env.html.includes('href="tw-weather://test">Send a test</a>'));
  await E.tap("tw-weather://test");
  assert.deepEqual(E.env.notifications.map((n) => n.body), ["Notifications work. A widget will send a second test at its next refresh."]);
  E.setConfig({ runsInWidget: true, widgetFamily: "small" });
  await W.main();
  await W.main(); // only once
  assert.deepEqual(E.env.notifications.map((n) => n.body).slice(1), ["Notifications from the widget work too."]);
});

await test("radar: the last two hours animate (RainViewer); CWA's image when RainViewer is down", async () => {
  reset({ at: E.tw("2026-10-02T13:20") });
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.equal((E.env.html.match(/tilecache\.rainviewer\.com\/v2\/radar\/\d+\/256\/\{z\}\/\{x\}\/\{y\}\/2\/0_0\.png/g) || []).length, 13);
  assert.ok(E.env.html.includes("L.GridLayer.extend") && E.env.html.includes("if (d.data[i] < 255) d.data[i] = 0;"),
    "radar tiles drop the see-through tan");
  assert.ok(E.env.html.includes('id="play"') && E.env.html.includes("radar © RainViewer"));
  assert.ok(E.env.html.includes("RainViewer 13:20 · the blue dot is you"), "the newest frame is shown first");
  fs.writeFileSync(path.join(E.stateDir, "app.html"), E.env.html);
  reset({ at: E.tw("2026-10-02T13:20") });
  E.net.rainviewer = "down";
  E.keychain.set("CWA_API_KEY", "KEY");
  E.setConfig({ runsInApp: true });
  await W.main();
  assert.ok(!E.env.html.includes('id="play"') && E.env.html.includes("O-A0058-006.png"));
});

// Results for the widget checks: a rainy afternoon, a clear night, and a worst case (long texts, stale).
reset({ at: E.tw("2026-10-02T13:20") });
const wet = await W.run("KEY");
reset({ at: E.tw("2026-10-01T23:20") });
const night = await W.run("KEY");
const worst = { ...wet, place: "高雄市那瑪夏區", stale: true, station: null,
  warnings: [{ title: "豪雨特報", until: "2026-10-03 23:00:00" }, { title: "陸上強風特報", until: "2026-10-03 23:00:00" }],
  rows: wet.rows.map((h, i) => (i === 0 ? { ...h, wx: "多雲時陰短暫陣雨或雷雨", t: -12.4 } : h)),
  summary: { ...wet.summary, hi: -1.5, lo: -12.4, nextRain: wet.rows[5].key, nextRainPop: 100 } };
E.clock.now = E.tw("2026-10-02T13:20");

await test("every widget family renders; medium shows 8 hours, large 24 hours and tomorrow", () => {
  for (const r of [wet, night, worst]) for (const family of FAMILIES) assert.ok(E.texts(W.buildWidget(r, family)).length);
  const hours = (family) => E.texts(W.buildWidget(wet, family)).filter((t) => /^\d\d$/.test(t));
  assert.deepEqual(hours("medium"), ["14", "16", "18", "20", "22", "00", "02", "04"]);
  assert.equal(hours("large").length, 24);
  assert.ok(E.texts(W.buildWidget(wet, "large")).some((t) => /^Tomorrow  H\d+° L\d+°/.test(t)));
  assert.match(E.texts(W.buildWidget(wet, "accessoryInline")).join(), /^\d+° Rain ~1[45]:00 \(\d+%\)$/);
  assert.match(E.texts(W.buildWidget(worst, "medium")).at(-1), /^stale · ⚠︎ 豪雨特報 · 陸上強風特報 · \d\d:\d\d$/);
  assert.match(E.texts(W.buildWidget({ ...worst, warnings: [] }, "medium")).at(-1), /^⚠︎ stale · \d\d:\d\d$/);
});

await test("widgets fit iPhone SE, 15/16 and Pro Max sizes in English and 中文 (estimated from SF Pro metrics)", () => {
  const problems = [];
  for (const lang of ["en", "zh"]) {
    W.setLang(lang);
    for (const [device, sizes] of Object.entries(DEVICES)) {
      for (const family of FAMILIES) {
        for (const [name, r] of Object.entries({ wet, night, worst })) {
          const w = W.buildWidget(r, family), [width, height] = sizes[family];
          const needH = estimateHeight(w), needW = estimateWidth(w, "v", true);
          if (needH > height || needW > width) {
            problems.push(`${lang} ${device} ${family} (${name}): needs ${needW.toFixed(0)}×${needH.toFixed(0)}, has ${width}×${height}`);
          }
        }
      }
    }
  }
  W.setLang("en");
  assert.deepEqual(problems, []);
});

const sections = [];
for (const lang of ["en", "zh"]) {
  W.setLang(lang);
  for (const [title, r] of [["Rainy afternoon (13:20)", wet], ["Clear night (23:20)", night],
    ["Worst case: long place and condition, stale, -12°", worst]]) {
    for (const [device, sizes] of Object.entries(DEVICES)) {
      sections.push({ title: `${lang === "zh" ? "中文 · " : ""}${title} · ${device}`,
        cards: FAMILIES.map((f) => widgetHTML(W.buildWidget(r, f), f, sizes[f], f)) });
    }
  }
}
W.setLang("en");
fs.writeFileSync(path.join(E.stateDir, "widgets.html"), previewPage("Taiwan Weather widget preview", sections));
console.log("   preview: test/.state/widgets.html · full view: test/.state/app.html, app-zh.html");

// ---------------- Live ----------------
if (process.env.OFFLINE) {
  console.log("- live run skipped (OFFLINE=1)");
} else {
  await test(`live: Open-Meteo + ${realKey ? "CWA" : "CWA fixture (no CWA_KEY in .env)"}, two runs`, async () => {
    reset({ cwa: realKey ? "live" : "fixture", om: "live" });
    const r1 = await W.run(realKey || "TEST"), r2 = await W.run(realKey || "TEST");
    for (const r of [r1, r2]) {
      assert.deepEqual(r.errors, []);
      assert.ok(r.sources.includes("cwa") && r.sources.length === 8, r.sources.join(","));
      assert.ok(r.rows[0].t > 0 && r.rows[0].t < 45);
      assert.ok(r.summary.hi >= r.summary.lo);
      if (realKey) assert.ok(r.station && r.station.distance < 5, "a station near Taipei 101");
    }
    console.log("   place:", r2.place, "| now:", r2.station.t, r2.station.weather || "", "| H/L:",
      r2.summary.hi.toFixed(1), r2.summary.lo.toFixed(1), "| sources:", r2.sources.join(","));
    console.log("   next 6h:", r2.rows.slice(0, 6).map((h) => `${h.key.slice(11)}h ${h.t.toFixed(1)}° ${h.pop == null ? "-" : Math.round(h.pop) + "%"}`).join(" | "));
    fs.writeFileSync(path.join(E.stateDir, "detail-live.html"), W.detailHTML(r2));
  });
  await test("live RainViewer: its tiles over Taiwan come in the colours the next-hour card reads", async () => {
    const get = async (url) => { // RainViewer's servers are in Germany: retry a stalled request
      for (let i = 0; ; i++) try { return await fetch(url); } catch (e) { if (i === 2) throw e; }
    };
    const meta = await (await get("https://api.rainviewer.com/public/weather-maps.json")).json();
    let seen = 0, odd = 0, rain = 0;
    for (const f of meta.radar.past.slice(-3)) {
      for (const [tx, ty] of [[106, 54], [107, 54], [106, 55], [107, 55]]) { // zoom 7 tiles over Taiwan
        const png = decodePNG(Buffer.from(await (await get(`${meta.host}${f.path}/256/7/${tx}/${ty}/2/0_0.png`)).arrayBuffer()));
        const d = W.radarDBZ(png.rgba, W.RAINVIEWER_COLORS);
        seen += d.seen; odd += d.odd; rain += d.dbz.filter((v) => v >= 20).length;
      }
    }
    console.log(`   last 3 frames over Taiwan: ${seen} pixels of 15+ dBZ, ${rain} of rain (20+ dBZ), ${odd} in other colours`);
    assert.ok(odd <= 0.02 * seen, `${odd} of ${seen} radar pixels are in colours the card doesn't know`);
  });
  if (realKey) {
    await test("live CWA: responses have every field the script reads", () => {
      const st = stationFormat(rawResponse("O-A0001-001")), fc = forecastFormat(rawResponse("F-D0047-"));
      assert.ok(st.stations > 300 && st.wgs84 > 0.95 * st.stations, JSON.stringify(st));
      console.log("   stations:", JSON.stringify(st));
      console.log("   township forecast:", JSON.stringify(fc));
    });
    await test("live: the app view's extra data (week, warnings, details, air quality, radar)", async () => {
      reset({ cwa: "live", om: "live" });
      Object.assign(E.net, { rainviewer: "live", cwaSite: "live" });
      E.keychain.set("CWA_API_KEY", realKey);
      E.setConfig({ runsInApp: true });
      await W.main();
      const r = E.readState().lastResult;
      assert.ok(r.frames && r.frames.frames.length >= 6, "RainViewer radar frames: " + JSON.stringify(r.frames).slice(0, 200));
      assert.deepEqual(Object.keys(r.rainFrames).sort(), ["RCLY", "RCNT", "RCSL"]);
      assert.equal(nhConfig(E.env.html).cwaRadars[0].name, "樹林");
      // the detail sheets: ten days of hours with every series filled from today on, and 5 days of air quality
      const D = detailOf(E.env.html), now = D.now;
      scriptsCompile(E.env.html);
      assert.equal(D.h.t.length, 240);
      for (const f of ["t", "pop", "rain", "feels", "rh", "dew", "wind", "dir", "gust", "pres", "vis", "uv"]) {
        const missing = D.h[f].slice(now).filter((v) => v == null).length;
        assert.ok(missing <= 2, `${f}: ${missing} hours from now on have no value`);
      }
      assert.ok(D.air && D.air.days >= 4 && D.air.main.some(Boolean), "air quality by the hour, with its main pollutant");
      const cwaFeels = rawResponse("F-D0047-061").records.Locations[0].Location[0].WeatherElement.map((e) => e.ElementName);
      assert.deepEqual(["體感溫度", "相對濕度", "露點溫度", "風速", "風向"].filter((n) => !cwaFeels.includes(n)), [], "CWA's extra elements");
      console.log(`   detail: today ${D.days[0].text.conditions} | ${D.days[0].text.wind} | ${D.days[0].text.air || "no air"}`);
      console.log(`   moon: ${D.days[0].text.moon}`);
      assert.deepEqual(r.errors, []);
      assert.ok(r.days.length === 10 && r.days.every((d) => d.hi >= d.lo && d.wx), JSON.stringify(r.days.slice(0, 3)));
      const week = rawResponse("F-D0047-063").records.Locations[0].Location[0];
      assert.equal(week.LocationName, "信義區");
      assert.ok(Array.isArray(rawResponse("W-C0033-001").records.location[0].hazardConditions.hazards));
      for (const k of ["feels", "rh", "dew", "wind", "pressure", "visibility", "uv"]) assert.equal(typeof r.details[k], "number", k);
      assert.ok(r.air.aqi >= 0 && r.air.aqi < 500 && /^https:\/\/.+\.png$/.test(r.radar.url), JSON.stringify([r.air, r.radar]));
      console.log(`   ${r.place}: ${r.days.map((d) => `${d.day.slice(5)} ${Math.round(d.lo)}–${Math.round(d.hi)}° ${Math.round(d.pop ?? 0)}%`).join(" | ")}`);
      console.log(`   now: feels ${r.details.feels.toFixed(1)}°, ${r.details.rh}% (dew ${r.details.dew.toFixed(1)}°), wind ${r.details.wind} m/s` +
        ` from ${r.details.windDir}°, ${Math.round(r.details.pressure)} hPa, ${Math.round(r.details.visibility / 1000)} km, UV ${r.details.uv},` +
        ` AQI ${r.air.aqi}, warnings: ${r.warnings.map((w) => w.title).join(", ") || "none"}, moon ${r.moon.name}`);
      fs.writeFileSync(path.join(E.stateDir, "app-live.html"), E.env.html);
    });
    await test("live: a saved place far from the phone (花蓮縣花蓮市) gets its own CWA forecast and station", async () => {
      reset({ cwa: "live", om: "live" });
      E.keychain.set("CWA_API_KEY", realKey);
      E.scriptArgs.widgetParameter = "花蓮市";
      E.setConfig({ runsInWidget: true, widgetFamily: "medium" });
      await W.main();
      const r = JSON.parse(fs.readFileSync(E.placeFile("花蓮縣花蓮市"), "utf8")).lastResult;
      assert.deepEqual(r.errors, []);
      assert.ok(r.place === "花蓮縣花蓮市" && r.sources.includes("cwa") && r.station && r.station.distance < 5, JSON.stringify(r.station));
      console.log(`   ${r.place}: now ${r.station.t}° at ${r.station.name} (${r.station.distance.toFixed(1)} km), H/L ${Math.round(r.summary.hi)}/${Math.round(r.summary.lo)}`);
    });
    await test("live CWA: the full texts of the warnings in force, with their areas", async () => {
      const texts = await W.fetchWarningTexts(realKey);
      assert.ok(Array.isArray(texts));
      for (const t of texts) assert.ok(t.title && t.title.endsWith("報") && t.text.length > 20 && t.areas.length, JSON.stringify(t).slice(0, 300));
      console.log(`   ${texts.length} warning(s): ${texts.map((t) => `${t.title} (${t.areas.join("、")})`).join("; ") || "none in force"}`);
    });
    await test("live CWA: the 降雨雷達 images are where the script expects", async () => {
      for (const radar of W.RAIN_RADARS) {
        const meta = await (await fetch(`https://opendata.cwa.gov.tw/fileapi/v1/opendataapi/${radar.id}?Authorization=${encodeURIComponent(realKey)}&format=JSON`)).json();
        const ds = meta.cwaopendata.dataset, p = ds.datasetInfo.parameterSet;
        assert.ok(ds.resource.ProductURL.endsWith(radar.id + ".png") && p.ImageDimension === "3600x3600", JSON.stringify(ds.resource));
        assert.ok(Math.abs(p.StationLatitude - radar.latitude) < 0.006 && Math.abs(p.StationLongitude - radar.longitude) < 0.006, radar.name);
      }
    });
    await test("live CWA: the built-in township list matches CWA's in all 22 counties (names, centres)", async () => {
      const diffs = [];
      for (const [county, id] of Object.entries(W.COUNTY_DATASET)) {
        const url = `https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-${id}?Authorization=${encodeURIComponent(realKey)}` +
          "&ElementName=" + encodeURIComponent("天氣現象");
        const live = (await (await fetch(url)).json()).records.Locations[0].Location
          .map((l) => `${l.LocationName} ${Number(l.Latitude).toFixed(4)} ${Number(l.Longitude).toFixed(4)}`).sort();
        const ours = W.TOWN_POINTS.filter((t) => t.county === county)
          .map((t) => `${t.name} ${t.latitude.toFixed(4)} ${t.longitude.toFixed(4)}`).sort();
        for (const x of live) if (!ours.includes(x)) diffs.push(`${county} CWA has ${x}`);
        for (const x of ours) if (!live.includes(x)) diffs.push(`${county} script has ${x}`);
      }
      assert.deepEqual(diffs, []);
    });
  }
  await test("live CWA website: each 降雨雷達's last 20 minutes read as the next-hour card reads them", async () => {
    reset();
    E.net.cwaSite = "live";
    const frames = await W.fetchRainRadarFrames();
    const towns = { RCSL: "臺北市信義區", RCNT: "臺中市西屯區", RCLY: "高雄市鳳山區" };
    const grid = async (radar, f, town) => {
      const png = decodePNG(Buffer.from(await (await fetch(W.CWA_SITE + "Data/radar_rain/" + f.path)).arrayBuffer()));
      assert.deepEqual([png.width, png.height], [1000, 1000]);
      return W.rainRadarGrid(radarCrop(png.rgba, 1000, W.rainRadarPixel(radar, town, 1000), 160, 4), W.CWA_RADAR_COLORS, 160, 4);
    };
    const hidden = (g) => { let n = 0; for (let y = 78; y <= 82; y++) for (let x = 78; x <= 82; x++) n += g.blind[y * 160 + x]; return n; };
    for (const radar of W.RAIN_RADARS) {
      const list = frames[radar.code], picked = W.pickFrames(list), town = W.findPlace(towns[radar.code]);
      assert.ok(list && Date.now() - list[0].time < 15 * 60e3, `${radar.name}'s newest image: ${list && new Date(list[0].time).toISOString()}`);
      assert.ok(picked.length >= 2, `${radar.name}: ${picked.length} frame(s)`); // a radar sometimes skips a few images
      const grids = [];
      for (const f of picked) grids.push(await grid(radar, f, town));
      const seen = grids.reduce((n, g) => n + g.seen, 0), odd = grids.reduce((n, g) => n + g.odd, 0);
      assert.ok(odd <= 200 || odd <= seen, `${radar.name}: ${odd} strongly coloured pixels not in its colours, ${seen} in them`);
      assert.ok(hidden(grids[2]) <= 7, `${radar.name} doesn't see ${towns[radar.code]}`);
      const gaps = picked.slice(1).map((f, i) => (f.time - picked[i].time) / 60e3);
      const nc = W.nowcastFrom(grids.map((g) => g.dbz), 160, (Date.now() - picked[2].time) / 60e3, gaps);
      console.log(`   ${radar.name} → ${towns[radar.code]}: ${seen} echo pixels (${odd} under borders), frames ${gaps.map((m) => m.toFixed(1)).join(" + ")} min apart,` +
        ` motion ${nc.moving ? `${(nc.motion.dx * 1.214 * 60).toFixed(0)}, ${(-nc.motion.dy * 1.214 * 60).toFixed(0)} km/h E, N` : "none found"},` +
        ` next hour ${nc.steps.map((s) => s.dbz).join(" ")} dBZ`);
    }
    // 林園 can't see 臺東市 (behind the Central Range): the card moves on to the next radar, or RainViewer
    const taitung = W.findPlace("臺東縣臺東市");
    assert.ok(hidden(await grid(W.RAIN_RADARS[2], frames.RCLY[0], taitung)) > 7, "林園 sees 臺東市");
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
