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
  catch (e) { failed++; console.log("✗", name, "\n   ", String(e.stack).split("\n").slice(0, 4).join("\n    ")); }
};
function reset({ at = null, cwa = "fixture", om = "fixture" } = {}) {
  Object.assign(E.clock, { now: at });
  Object.assign(E.net, { cwa, om, cwaKey: null, unknownTowns: [], warnings: [], raw: {} });
  E.net.log.length = 0;
  Object.assign(E.env, { location: E.HOME, geocode: () => [], geocodeCalls: 0, usedICloud: false,
    widget: null, html: null, presented: null });
  E.alerts.answers.length = 0; E.alerts.shown.length = 0;
  E.keychain.clear();
  E.setConfig({ runsInWidget: true, widgetFamily: "medium" });
  E.resetState();
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
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

await test("rain line: 'Rain now' only once the rainy hour has begun; 'tmrw' for tomorrow", () => {
  const r = { summary: { nextRain: "2026-10-01T21", nextRainPop: 60 } };
  E.clock.now = E.tw("2026-10-01T20:40");
  assert.equal(W.nowText(r), "Rain ~21:00 (60%)");
  E.clock.now = E.tw("2026-10-01T21:10");
  assert.equal(W.nowText(r), "Rain now 60%");
  E.clock.now = E.tw("2026-10-01T23:20");
  assert.equal(W.nowText({ summary: { nextRain: "2026-10-02T15", nextRainPop: 73.4 } }), "Rain tmrw ~15:00 (73%)");
  assert.equal(W.nowText({ summary: { nextRain: null } }), "No rain next 24h");
  E.clock.now = null;
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
  assert.deepEqual([st.stations, st.wgs84, st.dailyHighLow], [3, 3, 1]);
  assert.deepEqual(st.precipitation, { mm: 2, "-99": 1 });
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
  assert.deepEqual([r.place, r.placeVia], ["臺北市大同區", "nearest township centre"]);
  reset({ at: E.tw("2026-10-02T15:10") });
  E.env.location = border;
  E.env.geocode = () => [{ name: "南京西路", administrativeArea: "台北市", locality: "台北市", subLocality: "中山區",
    location: { latitude: 25.0675, longitude: 121.512 } }];
  r = await W.run("KEY");
  assert.deepEqual([r.place, r.placeVia], ["臺北市中山區", "Apple Maps"]);
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
  assert.equal(E.readState().stations.list.length, 3);
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
  const appOnly = ["air-quality", "O-A0058-006", "F-D0047-063", "daily="];
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
  assert.equal((E.env.html.match(/<li><span>(Today|Sun|Mon|Tue|Wed|Thu|Fri|Sat)<\/span>/g) || []).length, 10);
  assert.ok((E.env.html.match(/<li( class="sun")?><span>/g) || []).length >= 25, "25 hours plus sunrise/sunset");
  fs.writeFileSync(path.join(E.stateDir, "app.html"), E.env.html);
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

await test("widgets fit iPhone SE, 15/16 and Pro Max sizes (estimated from SF Pro metrics)", () => {
  const problems = [];
  for (const [device, sizes] of Object.entries(DEVICES)) {
    for (const family of FAMILIES) {
      for (const [name, r] of Object.entries({ wet, night, worst })) {
        const w = W.buildWidget(r, family), [width, height] = sizes[family];
        const needH = estimateHeight(w), needW = estimateWidth(w, "v", true);
        if (needH > height || needW > width) {
          problems.push(`${device} ${family} (${name}): needs ${needW.toFixed(0)}×${needH.toFixed(0)}, has ${width}×${height}`);
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

const sections = [];
for (const [title, r] of [["Rainy afternoon (13:20)", wet], ["Clear night (23:20)", night],
  ["Worst case: long place and condition, stale, -12°", worst]]) {
  for (const [device, sizes] of Object.entries(DEVICES)) {
    sections.push({ title: `${title} · ${device}`,
      cards: FAMILIES.map((f) => widgetHTML(W.buildWidget(r, f), f, sizes[f], f)) });
  }
}
fs.writeFileSync(path.join(E.stateDir, "widgets.html"), previewPage("Taiwan Weather widget preview", sections));
console.log("   preview: test/.state/widgets.html · in-app view: test/.state/detail.html");

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
  if (realKey) {
    await test("live CWA: responses have every field the script reads", () => {
      const st = stationFormat(rawResponse("O-A0001-001")), fc = forecastFormat(rawResponse("F-D0047-"));
      assert.ok(st.stations > 300 && st.wgs84 > 0.95 * st.stations, JSON.stringify(st));
      console.log("   stations:", JSON.stringify(st));
      console.log("   township forecast:", JSON.stringify(fc));
    });
    await test("live: the app view's extra data (week, warnings, details, air quality, radar)", async () => {
      reset({ cwa: "live", om: "live" });
      E.keychain.set("CWA_API_KEY", realKey);
      E.setConfig({ runsInApp: true });
      await W.main();
      const r = E.readState().lastResult;
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
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
