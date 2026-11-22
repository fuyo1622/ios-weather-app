// Tests for TaiwanWeather-loader.js, the short script that goes into Scriptable: it keeps the full TaiwanWeather.js on
// the phone and runs it, so Scriptable never opens the long script. The loader finds Scriptable's API on the global
// object, as in Scriptable, so the fakes go there.
//   node test/loader.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as E from "./env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const loader = fs.readFileSync(path.join(here, "..", "TaiwanWeather-loader.js"), "utf8");
const full = fs.readFileSync(path.join(here, "..", "TaiwanWeather.js"), "utf8");
const SOURCE = "https://raw.githubusercontent.com/fuyo1622/ios-weather-app/main/TaiwanWeather.js";
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runLoader = () => new AsyncFunction(loader)();
const settle = () => new Promise((r) => setTimeout(r, 30)); // the app's check for a new version isn't awaited

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log("✓", name); }
  catch (e) {
    failed++;
    const at = String(e.stack).split("\n").find((l) => l.includes("loader.mjs")) || "";
    console.log("✗", name, "\n   ", String(e.message).split("\n").slice(0, 14).join("\n    "), "\n   ", at.trim());
  }
};

// A stand-in for the full script: it says which version ran, under which name, and where.
const version = (v) => "// Variables used by Scriptable.\n// These must be at the very top of the file. Do not edit.\n" +
  "// icon-color: deep-blue; icon-glyph: cloud-sun-rain;\n" +
  `async function main() { ran.push({ v: ${JSON.stringify(v)}, name: Script.name(), widget: config.runsInWidget }); }\n` +
  "if (typeof __TEST__ === \"undefined\") {\n  await main();\n  Script.complete();\n}\n";

// GitHub, as the loader asks it: the file, its ETag, and each request.
const github = { code: version("1"), etag: '"v1"', status: 200, offline: false, asked: [] };
class GitHubRequest {
  constructor(url) { this.url = url; this.timeoutInterval = 60; this.headers = {}; }
  async loadString() {
    github.asked.push({ url: this.url, etag: this.headers["If-None-Match"] || null, timeout: this.timeoutInterval });
    if (this.url !== SOURCE) throw new Error("unexpected request: " + this.url);
    if (github.offline) throw new Error("The Internet connection appears to be offline.");
    if (github.etag && this.headers["If-None-Match"] === github.etag) {
      this.response = { statusCode: 304, headers: {} };
      return "";
    }
    this.response = { statusCode: github.status, headers: github.etag ? { Etag: github.etag } : {} }; // (as iOS spells it)
    return github.status === 200 ? github.code : "<html><body>Something went wrong</body></html>";
  }
}

// A phone: Scriptable's documents folder (a fresh one unless kept), and what the loader showed.
let docs = null;
const shown = { alerts: [], widget: null, ran: [], completed: 0 };
function phone({ widget = false, fresh = false } = {}) {
  if (fresh || !docs) docs = fs.mkdtempSync(path.join(os.tmpdir(), "tw-loader-"));
  Object.assign(shown, { alerts: [], widget: null, ran: [], completed: 0 });
  Object.assign(globalThis, {
    FileManager: { local: () => files },
    Request: GitHubRequest,
    config: { runsInApp: !widget, runsInWidget: widget, runsInAccessoryWidget: false },
    Script: { name: () => "TaiwanWeather", setWidget: (w) => { shown.widget = w; }, complete: () => { shown.completed++; } },
    ListWidget: class { constructor() { this.texts = []; } addText(text) { const t = { text }; this.texts.push(t); return t; } },
    Alert: class { constructor() { this.actions = []; } addAction(a) { this.actions.push(a); } async present() { shown.alerts.push(this); return 0; } },
    ran: shown.ran,
  });
  github.asked.length = 0;
}
const files = {
  documentsDirectory: () => docs, joinPath: (a, b) => path.join(a, b), fileExists: (p) => fs.existsSync(p),
  createDirectory: (p) => fs.mkdirSync(p, { recursive: true }), readString: (p) => fs.readFileSync(p, "utf8"),
  writeString: (p, s) => fs.writeFileSync(p, s),
};
const kept = () => path.join(docs, "taiwan-weather", "TaiwanWeather.code.txt");
const keptInfo = () => JSON.parse(fs.readFileSync(path.join(docs, "taiwan-weather", "TaiwanWeather.code.json"), "utf8"));

await test("first run in the app: downloads the full script, keeps it out of Scriptable's list, and runs it as TaiwanWeather", async () => {
  Object.assign(github, { code: version("1"), etag: '"v1"', status: 200, offline: false });
  phone({ fresh: true });
  await runLoader();
  assert.deepEqual(shown.ran, [{ v: "1", name: "TaiwanWeather", widget: false }]);
  assert.deepEqual(github.asked.map((a) => [a.etag, a.timeout]), [[null, 30]]);
  assert.equal(fs.readFileSync(kept(), "utf8"), version("1"));
  assert.equal(keptInfo().etag, '"v1"');
  assert.deepEqual(fs.readdirSync(docs), ["taiwan-weather"]); // no second script next to the user's (only .js are)
  assert.deepEqual(fs.readdirSync(path.join(docs, "taiwan-weather")).sort(), ["TaiwanWeather.code.json", "TaiwanWeather.code.txt"]);
  assert.equal(shown.alerts.length, 0);
  assert.ok(shown.completed >= 1);
});

await test("the next run in the app starts the kept version at once; GitHub, unchanged, sends nothing again", async () => {
  phone();
  const before = fs.statSync(kept()).mtimeMs;
  await runLoader();
  await settle();
  assert.deepEqual(shown.ran.map((r) => r.v), ["1"]);
  assert.deepEqual(github.asked.map((a) => a.etag), ['"v1"']); // asked with the ETag kept: "304 Not Modified"
  assert.equal(fs.statSync(kept()).mtimeMs, before);
});

await test("a new version on GitHub: this run uses the kept one, keeps the new one, and the next run uses it", async () => {
  Object.assign(github, { code: version("2"), etag: '"v2"' });
  phone();
  await runLoader();
  assert.deepEqual(shown.ran.map((r) => r.v), ["1"]);
  await settle();
  assert.equal(fs.readFileSync(kept(), "utf8"), version("2"));
  assert.equal(keptInfo().etag, '"v2"');
  phone();
  await runLoader();
  assert.deepEqual(shown.ran.map((r) => r.v), ["2"]);
});

await test("widgets run the kept version and never ask GitHub", async () => {
  Object.assign(github, { code: version("3"), etag: '"v3"' }); // (a newer one waits on GitHub)
  phone({ widget: true });
  await runLoader();
  await settle();
  assert.deepEqual(shown.ran, [{ v: "2", name: "TaiwanWeather", widget: true }]);
  assert.equal(github.asked.length, 0);
  assert.equal(fs.readFileSync(kept(), "utf8"), version("2"));
});

await test("a widget before the first download says to open the app once, in both languages, and asks nothing", async () => {
  phone({ widget: true, fresh: true });
  await runLoader();
  assert.deepEqual(shown.widget.texts.map((t) => t.text), ["Open TaiwanWeather in Scriptable once to finish installing.",
    "請在 Scriptable 打開 TaiwanWeather 一次，完成安裝。"]);
  assert.ok(shown.widget.texts.every((t) => t.minimumScaleFactor === 0.5));
  assert.equal(github.asked.length, 0);
  assert.equal(shown.ran.length, 0);
  assert.ok(shown.completed >= 1);
});

await test("no internet at the first run: says so in both languages and keeps nothing; the next run downloads it", async () => {
  Object.assign(github, { code: version("1"), etag: '"v1"', offline: true });
  phone({ fresh: true });
  await runLoader();
  assert.equal(shown.alerts.length, 1);
  assert.match(shown.alerts[0].message, /^Couldn't download the weather script from GitHub \(The Internet connection appears to be offline\.\)/);
  assert.match(shown.alerts[0].message, /無法從 GitHub 下載天氣程式/);
  assert.deepEqual(shown.alerts[0].actions, ["OK"]);
  assert.equal(shown.ran.length, 0);
  assert.equal(fs.existsSync(kept()), false);
  github.offline = false;
  phone();
  await runLoader();
  assert.deepEqual(shown.ran.map((r) => r.v), ["1"]);
});

await test("a bad answer from GitHub (an error, an error page, a cut-off file, a syntax error) never replaces the kept version", async () => {
  const bad = [
    { status: 500, code: version("9") },
    { status: 200, code: "<html><body>Rate limited</body></html>" },
    { status: 200, code: version("9").slice(0, 140) }, // cut off before main
    { status: 200, code: version("9").replace("async function main() {", "async function main() {{") },
  ];
  for (const b of bad) {
    Object.assign(github, { ...b, etag: '"bad"' });
    phone();
    await runLoader();
    await settle();
    assert.deepEqual(shown.ran.map((r) => r.v), ["1"], JSON.stringify(b).slice(0, 80));
    assert.equal(fs.readFileSync(kept(), "utf8"), version("1"));
    assert.equal(keptInfo().etag, '"v1"');
  }
  // the first run, with only a bad answer to be had: it says so, and keeps nothing
  Object.assign(github, { status: 200, code: "<html></html>", etag: '"bad"' });
  phone({ fresh: true });
  await runLoader();
  assert.match(shown.alerts[0].message, /GitHub didn't send TaiwanWeather\.js/);
  assert.equal(fs.existsSync(kept()), false);
});

await test("a damaged kept copy: widgets say to open the app, and the app downloads it again", async () => {
  Object.assign(github, { status: 200, code: version("4"), etag: '"v4"' });
  phone({ fresh: true });
  await runLoader();
  fs.writeFileSync(kept(), version("4").slice(0, 100)); // as if the phone stopped halfway through saving it
  phone({ widget: true });
  await runLoader();
  assert.match(shown.widget.texts[0].text, /^Open TaiwanWeather in Scriptable once/);
  assert.equal(github.asked.length, 0);
  phone();
  await runLoader();
  assert.deepEqual(shown.ran.map((r) => r.v), ["4"]);
  assert.deepEqual(github.asked.map((a) => a.etag), [null]); // a fresh download, not "has it changed?"
  assert.equal(fs.readFileSync(kept(), "utf8"), version("4"));
});

await test("the loader stays short (that is its point), with the full script's icon and its address on GitHub", async () => {
  assert.ok(loader.split("\n").length < 80, `${loader.split("\n").length} lines`);
  assert.ok(loader.startsWith("// Variables used by Scriptable.\n// These must be at the very top of the file. Do not edit.\n" +
    "// icon-color: deep-blue; icon-glyph: cloud-sun-rain;\n"));
  assert.ok(full.startsWith(loader.split("\n").slice(0, 3).join("\n")), "the same icon as TaiwanWeather.js");
  assert.ok(loader.includes(`"${SOURCE}"`));
});

await test("end to end: the real TaiwanWeather.js through the loader, in the app and then in a widget", async () => {
  // Scriptable's API from the harness (fixtures for CWA, Open-Meteo and the radar, a fake WebView), plus GitHub
  for (const [k, v] of Object.entries(E.globals)) if (k !== "__TEST__" && k !== "Date") globalThis[k] = v;
  class WithGitHub extends E.globals.Request {
    async loadString() {
      if (this.url !== SOURCE) return super.loadString();
      E.net.log.push(this.url);
      this.response = { statusCode: 200, headers: { Etag: '"real"' } };
      return full;
    }
  }
  globalThis.Request = WithGitHub;
  fs.mkdirSync(E.stateDir, { recursive: true });
  E.resetState();
  E.keychain.clear();
  E.keychain.set("CWA_API_KEY", "KEY");
  E.net.log.length = 0;
  E.setConfig({ runsInApp: true });
  await runLoader();
  assert.equal(E.env.presented, "webview");
  assert.ok(E.env.html.includes('<p class="place">臺北市信義區</p>') && E.env.html.includes('class="temp"'), "the forecast page");
  assert.equal(E.net.log.filter((u) => u === SOURCE).length, 1);
  assert.ok(fs.existsSync(path.join(E.stateDir, "taiwan-weather", "TaiwanWeather.code.txt")));
  assert.ok(fs.existsSync(E.stateFile), "the script's own state, next to it");
  E.setConfig({ runsInWidget: true, widgetFamily: "medium" });
  E.env.widget = null;
  const asked = E.net.log.length;
  await runLoader();
  const texts = E.texts(E.env.widget);
  assert.ok(texts.includes("臺北市信義區") || texts.includes("My Location"), texts.slice(0, 4).join(" | "));
  assert.ok(texts.some((t) => /^-?\d+°$/.test(t)), texts.slice(0, 6).join(" | "));
  assert.equal(E.net.log.slice(asked).filter((u) => u === SOURCE).length, 0, "a widget never downloads the script");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(), 1000).unref(); // a failed test may leave a page's timer running: end anyway
