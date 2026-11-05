// Tests for the Android app's JavaScript side (android/app/src/main/assets/shim.js): TaiwanWeather.js run through the
// shim, with a fake Android bridge (window.Native) that does what Bridge.kt and MainActivity.kt do, on the same
// fixtures as test/harness.mjs.   node test/android-shim.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as E from "./env.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const shim = fs.readFileSync(path.join(root, "android/app/src/main/assets/shim.js"), "utf8");
const script = fs.readFileSync(path.join(root, "TaiwanWeather.js"), "utf8");

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("✓", name); }
  catch (e) { failed++; console.log("✗", name, "\n   ", String(e.stack || e).split("\n").slice(0, 6).join("\n    ")); }
};
const until = async (ok, ms = 5000) => {
  for (let t = 0; t < ms && !ok(); t += 10) await new Promise((r) => setTimeout(r, 10));
  assert.ok(ok(), "still waiting after " + ms + " ms");
};
const fixtures = (at) => {
  Object.assign(E.clock, { now: at });
  Object.assign(E.net, { cwa: "fixture", om: "fixture", rainviewer: "fixture", cwaSite: "fixture", rainRadarGap: null,
    cwaKey: null, offline: false, unknownTowns: [], warnings: [], raw: {}, delay: {}, times: [] });
};

// A phone for the shim: Bridge.kt's answers, and what was asked of it.
function phone({ key = null, answer = { button: -1, values: [] }, located = E.HOME } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tw-android-"));
  const results = new Map(), keys = new Map(key ? [["CWA_API_KEY", key]] : []);
  const seen = { pages: [], bases: [], alerts: [], notes: [], widgets: [], failed: [], lines: [], http: [], refreshes: [], done: false };
  let ctx = null, presented = null;
  const reply = (id, ok, value) => {
    if (value != null) results.set(id, value);
    setTimeout(() => ctx.__tw.done(id, ok), 0);
  };
  const Native = {
    asset: (name) => (name === "TaiwanWeather.js" ? script : ""),
    result: (id) => { const v = results.get(id); results.delete(id); return v ?? null; },
    log: (m) => seen.lines.push(m),
    filesDir: () => dir, exists: (p) => fs.existsSync(p), mkdirs: (p) => fs.mkdirSync(p, { recursive: true }),
    read: (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null), write: (p, text) => fs.writeFileSync(p, text),
    keyHas: (k) => keys.has(k), keyGet: (k) => keys.get(k) ?? null, keySet: (k, v) => keys.set(k, v), keyRemove: (k) => keys.delete(k),
    http: (id, url) => { seen.http.push(url); E.fixtureText(url).then((body) => reply(id, true, body), (e) => reply(id, false, e.message)); },
    location: (id) => (located ? reply(id, true, JSON.stringify(located)) : reply(id, false, "Location access denied")),
    geocode: (id) => reply(id, true, "[]"),
    notify: (identifier, title, body) => seen.notes.push({ identifier, title, body }),
    alert: (id, spec) => { seen.alerts.push(JSON.parse(spec)); reply(id, true, JSON.stringify(answer)); },
    viewCreate: () => 1,
    viewLoad: (id, html, base) => { seen.pages.push(html); seen.bases.push(base); reply(id, true, null); },
    viewEval: (id) => reply(id, true, JSON.stringify(JSON.stringify({ y: 0, busy: false }))), // Android: the value as JSON
    viewPresent: (id) => { presented = () => reply(id, true, null); },
    widget: (place, json) => seen.widgets.push({ place, data: JSON.parse(json) }),
    refreshWidgets: () => seen.refreshes.push(JSON.parse(fs.readFileSync(path.join(dir, "taiwan-weather", "settings.json"), "utf8")).lang),
    failed: (m) => seen.failed.push(m),
    done: () => { seen.done = true; },
  };
  ctx = vm.createContext({ Native, console, setTimeout, clearTimeout, setInterval, clearInterval, Date: E.FakeDate });
  ctx.window = ctx;
  vm.runInContext(shim, ctx);
  return { ctx, seen, keys, dir, close: () => presented && presented(), page: () => seen.pages.at(-1) || "" };
}

await test("app: the first run asks for the CWA key; the full view is drawn as a page of CWA's site, and its links work", async () => {
  fixtures(E.tw("2026-10-02T13:20"));
  const p = phone({ answer: { button: 0, values: ["KEY"] } });
  p.ctx.__start("app", { place: null });
  await until(() => p.page().includes('id="outlook"') && p.page().includes("const DETAIL = "));
  assert.equal(p.seen.alerts[0].title, "CWA API key");
  assert.deepEqual([p.seen.alerts[0].actions, p.seen.alerts[0].cancel], [["Save"], "Skip"]);
  assert.equal(p.keys.get("CWA_API_KEY"), "KEY", "kept for the next runs (Bridge.kt: the app's private settings)");
  assert.equal(p.seen.bases.at(-1), "https://www.cwa.gov.tw/");
  assert.ok(p.page().includes("臺北市信義區") && p.page().includes("township from the nearest township centre"));
  assert.ok(fs.existsSync(path.join(p.dir, "taiwan-weather", "state.json")), "the learning state is saved in the app's files");
  // a link on the page (中文), then the back of the app
  p.ctx.__tw.link("tw-weather://lang?to=zh");
  await until(() => p.page().includes("目前位置"));
  p.close();
  await until(() => p.seen.done);
  assert.deepEqual(p.seen.failed, []);
});

await test("app: no location, no key: the Android geocoder's label, models only, nothing fails", async () => {
  fixtures(E.tw("2026-10-02T13:20"));
  const p = phone({ located: null });
  p.ctx.__start("app", {});
  await until(() => p.page().includes('id="outlook"'));
  assert.equal(p.seen.alerts.length, 1, "asked once; Skip");
  assert.ok(!p.keys.has("CWA_API_KEY"));
  p.close();
  await until(() => p.seen.done);
  assert.ok(p.ctx.__W.WORDS.en.via.apple.includes("Android") && p.ctx.__W.WORDS.zh.via.apple.includes("Android"));
});

await test("app: a widget's place that doesn't exist says so (Android shows the message)", async () => {
  fixtures(E.tw("2026-10-02T13:20"));
  const p = phone({ key: "KEY" });
  p.ctx.__start("app", { place: "Tokyo" });
  await until(() => p.seen.done);
  assert.deepEqual(p.seen.failed, ['Unknown place "Tokyo". Use a township, e.g. 臺南市東區.']);
});

await test("widgets: My Location and a saved place, with what each widget size shows; notifications for My Location", async () => {
  fixtures(E.tw("2026-10-02T14:20")); // rain due at 15:00
  E.net.warnings = [{ phenomena: "大雨", significance: "特報", end: "2026-10-02 23:00:00" },
    { phenomena: "陸上強風", significance: "特報", end: "2026-10-02 23:00:00" }];
  const p = phone({ key: "KEY" });
  p.ctx.__start("widget", { places: ["", "臺南市東區", "Tokyo"] });
  await until(() => p.seen.done, 10000);
  assert.deepEqual(p.seen.widgets.map((w) => w.place), ["", "臺南市東區", "Tokyo"]);
  const [here, tainan, tokyo] = p.seen.widgets.map((w) => w.data);
  assert.equal(here.place, "臺北市信義區");
  assert.match(here.temp, /^\d+°$/);
  assert.match(here.hiLo, /^H\d+° L\d+°$/);
  assert.match(here.rain, /^Rain (likely \d+%|~15:00 \(\d+%\))$/);
  assert.deepEqual([here.hours8.length, here.hours24.length], [8, 24]);
  assert.deepEqual(Object.keys(here.hours8[0]).sort(), ["h", "icon", "pop", "t"]);
  assert.equal(here.hours8[0].h, "15");
  assert.match(here.tomorrow, /^Tomorrow  H\d+° L\d+°  ·  Rain \d+%$/);
  assert.match(here.bottom, /^⚠︎ 大雨特報 · 陸上強風特報 · \d\d:\d\d$/);
  assert.match(here.bottomSmall, /^⚠︎ 大雨特報 \+1 · \d\d:\d\d$/);
  assert.equal(here.warn, true);
  assert.equal(tainan.place, "臺南市東區");
  assert.equal(tokyo.error, 'Weather error: Unknown place "Tokyo". Use a township, e.g. 臺南市東區.');
  assert.deepEqual(p.seen.notes.map((n) => n.title), ["🌧️ Rain soon · 臺北市信義區", "⚠️ 大雨特報 · 臺北市信義區", "⚠️ 陸上強風特報 · 臺北市信義區"]);
  // widget runs stay light: no ten days, radar or air quality
  assert.ok(!p.seen.http.some((u) => /air-quality|daily=|rainviewer|O-A0058/.test(u)), p.seen.http.join("\n"));
});

await test("widgets: in 中文, as the app's language is", async () => {
  fixtures(E.tw("2026-10-02T13:20"));
  const p = phone({ key: "KEY" });
  fs.mkdirSync(path.join(p.dir, "taiwan-weather"), { recursive: true });
  fs.writeFileSync(path.join(p.dir, "taiwan-weather", "settings.json"), JSON.stringify({ lang: "zh" }));
  p.ctx.__start("widget", { places: [""] });
  await until(() => p.seen.done, 10000);
  const d = p.seen.widgets[0].data;
  assert.match(d.hiLo, /^高\d+° 低\d+°$/);
  assert.match(d.tomorrow, /^明天  高\d+° 低\d+°  ·  降雨 \d+%$/);
});

await test("widgets abroad: My Location says it's outside Taiwan, with nothing downloaded for it; a saved place still has its forecast", async () => {
  fixtures(E.tw("2026-10-02T13:20"));
  const p = phone({ key: "KEY", located: { latitude: 35.68, longitude: 139.76 } }); // Tokyo
  p.ctx.__start("widget", { places: ["", "臺南市東區"] });
  await until(() => p.seen.done, 10000);
  const [here, tainan] = p.seen.widgets.map((w) => w.data);
  assert.deepEqual([here.outside, here.place, here.temp, here.condition, here.rain, here.hours8.length, here.tomorrow],
    [true, "My Location", "–", "Outside Taiwan", "No forecast here", 0, ""]);
  assert.match(here.bottom, /^\d\d:\d\d$/);
  assert.equal(tainan.place, "臺南市東區");
  assert.ok(!p.seen.http.some((u) => u.includes("139.76")), "nothing asked about Tokyo");
  assert.deepEqual(p.seen.notes, []);
});

await test("language on Android: the widgets refresh at once, with the choice already saved, so the page needn't mention them", async () => {
  fixtures(E.tw("2026-10-02T13:20"));
  const p = phone({ key: "KEY" });
  p.ctx.__start("app", {});
  await until(() => p.page().includes('id="outlook"') && p.page().includes("const DETAIL = "));
  p.ctx.__tw.link("tw-weather://lang?to=zh");
  await until(() => p.page().includes("目前位置"));
  assert.deepEqual(p.seen.refreshes, ["zh"]);
  assert.ok(!p.page().includes("小工具會在下次更新"));
  p.ctx.__tw.link("tw-weather://notify?rain=0"); // anything else leaves the widgets alone
  await until(() => p.page().includes('notify?rain=1"'));
  assert.deepEqual(p.seen.refreshes, ["zh"]);
  p.close();
  await until(() => p.seen.done);
});

await test("no internet on Android: a widget's error says so once, in the app's words", async () => {
  fixtures(E.tw("2026-10-02T13:20"));
  E.net.offline = true;
  const p = phone({ key: "KEY" });
  p.ctx.__start("widget", { places: [""] });
  await until(() => p.seen.done, 10000);
  assert.deepEqual(p.seen.widgets[0].data, { error: "Weather error: No internet connection." });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(), 1000).unref(); // a failed test may leave a page's timer running: end anyway
