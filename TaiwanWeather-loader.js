// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: cloud-sun-rain;

// TaiwanWeather, the short way in: this runs the full script (TaiwanWeather.js from github.com/fuyo1622/ios-weather-app,
// branch main), which it keeps on this iPhone next to the forecasts, so Scriptable never opens the long script itself
// (on iOS 27 a long script can crash Scriptable, which then crashes again at every start). In the app it also asks
// GitHub for a new version and keeps it for the next time; widgets run the version kept here, with no download.
// Name this script TaiwanWeather: the widgets and their tap links look for that name.
const SOURCE = "https://raw.githubusercontent.com/fuyo1622/ios-weather-app/main/TaiwanWeather.js";
const fm = FileManager.local();
const dir = fm.joinPath(fm.documentsDirectory(), "taiwan-weather");
const codeFile = fm.joinPath(dir, "TaiwanWeather.code.txt"); // (.txt: Scriptable never lists it as a script)
const infoFile = fm.joinPath(dir, "TaiwanWeather.code.json"); // { etag, saved }: which version GitHub sent
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const inWidget = Boolean(config.runsInWidget || config.runsInAccessoryWidget);

// The full script, ready to run. Anything else (an error page, half a download) stops here, before it is kept.
function compile(code) {
  if (typeof code !== "string" || !code.startsWith("// Variables used by Scriptable.") || !code.includes("async function main(")) {
    throw new Error("GitHub didn't send TaiwanWeather.js");
  }
  return new AsyncFunction(code); // (a syntax error throws here)
}

// The newest version on GitHub, kept on the phone; null when the one kept is still the newest.
async function download(etag) {
  const req = new Request(SOURCE);
  req.timeoutInterval = 30;
  if (etag) req.headers = { "If-None-Match": etag };
  const code = await req.loadString();
  const status = req.response && req.response.statusCode ? req.response.statusCode : 200; // (the file itself is checked)
  if (status === 304 || (etag && code === "")) return null;
  if (status !== 200) throw new Error("GitHub answered " + status);
  const run = compile(code);
  const headers = (req.response && req.response.headers) || {};
  const tag = Object.keys(headers).find((k) => k.toLowerCase() === "etag");
  if (!fm.fileExists(dir)) fm.createDirectory(dir, true);
  fm.writeString(codeFile, code);
  fm.writeString(infoFile, JSON.stringify({ etag: tag ? headers[tag] : null, saved: Date.now() }));
  return run;
}

const read = (file) => (fm.fileExists(file) ? fm.readString(file) : null);
let run = null, info = {};
try { run = compile(read(codeFile)); } catch (e) { run = null; } // not downloaded yet, or damaged: download it
try { info = JSON.parse(read(infoFile)) || {}; } catch (e) { info = {}; }

if (run && !inWidget) {
  download(info.etag).catch(() => {}); // a new version, if there is one, runs from the next time
} else if (!run && inWidget) {
  const w = new ListWidget();
  for (const line of ["Open TaiwanWeather in Scriptable once to finish installing.", "請在 Scriptable 打開 TaiwanWeather 一次，完成安裝。"]) {
    w.addText(line).minimumScaleFactor = 0.5;
  }
  Script.setWidget(w);
} else if (!run) {
  try {
    run = await download(null);
    if (!run) throw new Error("GitHub sent nothing");
  } catch (e) {
    const a = new Alert();
    a.title = "TaiwanWeather";
    a.message = `Couldn't download the weather script from GitHub (${e.message}). Connect to the internet and run it again.` +
      `\n\n無法從 GitHub 下載天氣程式（${e.message}）。請連上網路後再執行一次。`;
    a.addAction("OK");
    await a.present();
  }
}
if (run) await run();
Script.complete();
