// Runs TaiwanWeather.js under Node with mocked Scriptable APIs.
//   node test/harness.mjs            -> mock CWA (fixture), real Open-Meteo
//   CWA_KEY=xxx node test/harness.mjs -> real CWA too
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = path.join(here, ".state");
fs.rmSync(stateDir, { recursive: true, force: true });

// ---------------- CWA fixture (shape of the real API) ----------------
function hk(d) { return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 13); }
function iso(h) { return hk(new Date(Date.now() + h * 3600e3)) + ":00:00+08:00"; }
const fixtureStations = {
  success: "true",
  records: { Station: [
    { StationName: "信義", StationId: "C0AC70",
      ObsTime: { DateTime: iso(0) },
      GeoInfo: { Coordinates: [{ CoordinateName: "TWD67", StationLatitude: 25.03, StationLongitude: 121.56 },
                               { CoordinateName: "WGS84", StationLatitude: 25.0377, StationLongitude: 121.5645 }],
                 CountyName: "臺北市", TownName: "信義區" },
      WeatherElement: { Weather: "多雲", Now: { Precipitation: 0.0 }, AirTemperature: 29.4 } },
    { StationName: "壞站", StationId: "X1",
      ObsTime: { DateTime: iso(0) },
      GeoInfo: { Coordinates: [{ CoordinateName: "WGS84", StationLatitude: 25.033, StationLongitude: 121.5654 }],
                 CountyName: "臺北市", TownName: "信義區" },
      WeatherElement: { Weather: "-99", Now: { Precipitation: -99 }, AirTemperature: -99 } },
  ] },
};
const fixtureForecast = {
  success: "true",
  records: { Locations: [{ LocationsName: "臺北市", Location: [
    { LocationName: "信義區", Latitude: "25.03", Longitude: "121.57", WeatherElement: [
      { ElementName: "溫度", Time: [0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 48].map((h, i) =>
        ({ DataTime: iso(h), ElementValue: [{ Temperature: String(28 + Math.round(3 * Math.sin(i))) }] })) },
      { ElementName: "3小時降雨機率", Time: [0, 3, 6, 9, 12, 15, 18, 21].map((h) =>
        ({ StartTime: iso(h), EndTime: iso(h + 3), ElementValue: [{ ProbabilityOfPrecipitation: h === 6 ? "70" : "10" }] })) },
      { ElementName: "天氣現象", Time: [0, 3, 6, 9, 12, 15, 18, 21].map((h) =>
        ({ StartTime: iso(h), EndTime: iso(h + 3), ElementValue: [{ Weather: h === 6 ? "短暫陣雨" : "多雲", WeatherCode: "04" }] })) },
    ] },
  ] }] },
};

// ---------------- Scriptable API mocks ----------------
const realKey = process.env.CWA_KEY;
class Request {
  constructor(url) { this.url = url; }
  async loadJSON() {
    if (this.url.includes("opendata.cwa.gov.tw") && !realKey) {
      return this.url.includes("O-A0001-001") ? fixtureStations : fixtureForecast;
    }
    const res = await fetch(this.url);
    return res.json();
  }
}
const files = {
  local() { return files; }, iCloud() { throw new Error("no iCloud"); },
  documentsDirectory: () => stateDir, joinPath: (a, b) => path.join(a, b),
  fileExists: (p) => fs.existsSync(p), createDirectory: (p) => fs.mkdirSync(p, { recursive: true }),
  readString: (p) => fs.readFileSync(p, "utf8"), writeString: (p, s) => fs.writeFileSync(p, s),
};
const log = [];
class Stack {
  constructor(name) { this.name = name; this.children = []; }
  addStack() { const s = new Stack("stack"); this.children.push(s); return s; }
  addText(t) { log.push(t); const o = { text: t }; this.children.push(o); return o; }
  addImage() { return {}; }
  addSpacer() {} layoutVertically() {} centerAlignContent() {} setPadding() {}
  async presentMedium() {}
}
const globals = {
  __TEST__: true,
  Request,
  FileManager: files,
  Location: { setAccuracyToThreeKilometers() {}, async current() { return { latitude: 25.033, longitude: 121.5654 }; } },
  Keychain: { contains: () => true, get: () => realKey || "TEST", set() {} },
  config: { runsInWidget: true, widgetFamily: "medium" },
  Script: { setWidget(w) { globals.__widget = w; }, complete() {} },
  ListWidget: Stack,
  Color: Object.assign(function Color() {}, { white: () => ({}) }),
  Font: { systemFont: () => ({}), boldSystemFont: () => ({}) },
  Size: function Size() {}, LinearGradient: function LinearGradient() {},
  SFSymbol: { named: () => ({ image: {} }) },
  Alert: function Alert() {}, WebView: function WebView() {},
};

// ---------------- Load script ----------------
const src = fs.readFileSync(path.join(here, "..", "TaiwanWeather.js"), "utf8");
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const exportsLine = "\nreturn { hourKey, addHours, cwaElementHourly, blend, computeSkill, sourceParams," +
  " recordForecasts, recordObservation, hourlyRain, summarize, nearestStation, run, buildWidget, detailHTML, main, CONFIG };";
const factory = new AsyncFunction(...Object.keys(globals), src + exportsLine);
const W = await factory(...Object.values(globals));

// ---------------- Tests ----------------
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("✓", name); };

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

await test("hourly rain from daily accumulation", () => {
  const state = { obs: {
    "2026-10-01T10": { t: 25, acc: 1.0, station: "S" },
    "2026-10-01T11": { t: 25, acc: 3.5, station: "S" },
    "2026-10-02T00": { t: 25, acc: 0.5, station: "S" } } };
  assert.equal(W.hourlyRain(state, "2026-10-01T11"), 2.5);
  assert.equal(W.hourlyRain(state, "2026-10-02T00"), 0.5);
  assert.equal(W.hourlyRain(state, "2026-10-01T10"), null);
});

await test("nowcast pulls hour-0 temp to the station reading", () => {
  const now = W.hourKey(new Date());
  const series = {}; for (let h = 0; h < 48; h++) series[W.addHours(now, h)] = { t: 25, pop: 10 };
  const rows = W.blend({ cwa: series }, {}, now, { t: 28, time: now + ":00:00+08:00", weather: "陰" });
  assert.ok(Math.abs(rows[0].t - 28) < 1e-9);
  assert.ok(rows[4].t > 25 && rows[4].t < 27.5);
  assert.ok(Math.abs(rows[30].t - 25) < 0.01);
});

await test("full pipeline: CWA (" + (realKey ? "live" : "fixture") + ") + live Open-Meteo, two runs", async () => {
  const r1 = await W.run(realKey || "TEST");
  const r2 = await W.run(realKey || "TEST"); // second run reads persisted state
  for (const r of [r1, r2]) {
    assert.equal(r.errors.length, 0, r.errors.join("; "));
    assert.ok(r.sources.includes("cwa") && r.sources.length >= 6, r.sources.join(","));
    assert.ok(r.rows[0].t > 0 && r.rows[0].t < 45);
    assert.ok(r.summary.hi >= r.summary.lo);
  }
  console.log("   place:", r2.place, "| now:", r2.station.t, r2.station.weather,
    "| H/L:", r2.summary.hi.toFixed(1), r2.summary.lo.toFixed(1), "| sources:", r2.sources.join(","));
  console.log("   next 6h:", r2.rows.slice(0, 6).map((h) => `${h.key.slice(11)}h ${h.t.toFixed(1)}° ${h.pop == null ? "-" : Math.round(h.pop) + "%"}`).join(" | "));
  fs.writeFileSync(path.join(stateDir, "detail.html"), W.detailHTML(r2));
});

await test("main() renders a widget", async () => {
  log.length = 0;
  await W.main();
  assert.ok(globals.__widget && log.some((t) => /°/.test(t)), log.join(" / "));
  console.log("   widget text:", log.join(" / "));
});

console.log(`\n${passed} tests passed`);
