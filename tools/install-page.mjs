// Builds the install page: the short TaiwanWeather script (TaiwanWeather-loader.js) behind a "Copy script" button,
// with the iPhone steps. The short script downloads the full TaiwanWeather.js from GitHub and keeps it up to date, so
// Scriptable never opens the long script (on iOS 27 that can crash Scriptable at every start). It is published as a
// private claude.ai artifact, so it can be pasted into Scriptable without iCloud Drive. Rebuild and republish it
// whenever TaiwanWeather-loader.js changes (a new TaiwanWeather.js reaches the phones by itself, from branch main).
//   node tools/install-page.mjs <out.html> [the page's own URL, for the QR code]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [out, pageUrl = ""] = process.argv.slice(2);
if (!out) throw new Error("usage: node tools/install-page.mjs <out.html> [page URL]");

const code = fs.readFileSync(path.join(root, "TaiwanWeather-loader.js"), "utf8");
const lines = code.trimEnd().split("\n").length;
const full = fs.readFileSync(path.join(root, "TaiwanWeather.js"), "utf8");
const fullLines = full.trimEnd().split("\n").length, fullKb = Math.round(Buffer.byteLength(full) / 1024);
const version = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TaiwanWeather Script</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600&family=Noto+Sans+TC:wght@400;500;700&family=Noto+Serif+TC:wght@700&display=swap">
<style>
/* Layout: one narrow column, the copy action first, then the steps, then the raw script as a fallback. */
:root {
  --bg: #eef3f9; --surface: #ffffff; --fg: #13213a; --muted: #52627a; --line: #d3dce9;
  --accent: #1d3b6e; --accent-fg: #ffffff; --ok: #1d7a4c; --warn: #9a5b00;
  --display: "Noto Serif TC", "Songti TC", "PMingLiU", serif;
  --body: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #0c1424; --surface: #131f37; --fg: #e6edf7; --muted: #9fb1c9;
    --line: #26385a; --accent: #7cc4ff; --accent-fg: #0c1424; --ok: #63d49d; --warn: #f0b456; color-scheme: dark; }
}
:root[data-theme="dark"] { --bg: #0c1424; --surface: #131f37; --fg: #e6edf7; --muted: #9fb1c9;
  --line: #26385a; --accent: #7cc4ff; --accent-fg: #0c1424; --ok: #63d49d; --warn: #f0b456; color-scheme: dark; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 var(--body); }
.wrap { max-width: 42rem; margin: 0 auto; padding-inline: 16px; padding-block: 28px 56px; display: grid; gap: 30px; }
header { display: grid; gap: 4px; }
.eyebrow { margin: 0; color: var(--muted); font-size: 13px; letter-spacing: .04em; }
h1 { margin: 0; font: 700 clamp(30px, 7vw, 40px)/1.15 var(--display); text-wrap: balance; }
h2 { margin: 0 0 10px; font-size: 18px; text-wrap: balance; }
.meta { margin: 0; color: var(--muted); font: 13px var(--mono); font-variant-numeric: tabular-nums; }
.copy { display: grid; gap: 10px; padding: 18px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }
button { font: 600 18px var(--body); color: var(--accent-fg); background: var(--accent); border: 0; border-radius: 12px;
  padding: 16px 20px; cursor: pointer; }
button:focus-visible, textarea:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.status { margin: 0; color: var(--muted); font-size: 14px; }
.status[data-state="ok"] { color: var(--ok); }
.status[data-state="fail"] { color: var(--warn); }
ol { margin: 0; padding-left: 1.4em; display: grid; gap: 12px; }
li span { display: block; color: var(--muted); font-size: 14px; }
a { color: var(--accent); }
code { font: 14px var(--mono); }
.note { margin: 12px 0 0; color: var(--muted); font-size: 14px; }
textarea { width: 100%; box-sizing: border-box; height: 16em; resize: vertical; padding: 12px; border-radius: 10px;
  border: 1px solid var(--line); background: var(--surface); color: var(--fg); font: 12px/1.5 var(--mono); }
.qr { display: none; }
@media (min-width: 720px) { .qr.ready { display: grid; grid-template-columns: auto 1fr; gap: 18px; align-items: center; } }
#qr { background: #ffffff; padding: 10px; border-radius: 10px; line-height: 0; }
.qr p { margin: 0; color: var(--muted); font-size: 14px; word-break: break-all; }
</style>
</head>
<body>
<main class="wrap">
  <header>
    <p class="eyebrow">Scriptable widget · 中央氣象署 + 7 models</p>
    <h1>TaiwanWeather</h1>
    <p class="meta">Version ${version} · a ${lines}-line script that runs the full one (${fullLines.toLocaleString("en")} lines, ${fullKb} KB) from GitHub</p>
  </header>

  <section class="qr" id="qr-box" aria-label="Open on your phone">
    <div id="qr"></div>
    <p><b>On the PC?</b> Scan this with the iPhone camera to open this page there.<br>用 iPhone 相機掃描，在手機上開啟本頁。<br>${esc(pageUrl)}</p>
  </section>

  <section class="copy">
    <button id="copy" type="button">Copy script</button>
    <p id="status" class="status" role="status">Copies the short script, ready to paste into Scriptable. 複製這個短程式。</p>
  </section>

  <section>
    <h2>Scriptable crashes when it opens?</h2>
    <p class="note">If your iCloud storage is full, Scriptable may fail to keep its scripts in iCloud Drive. Let it keep them on the
      phone instead. This changes only this iPhone. The short script keeps everything on the phone, never in iCloud.<br>
      iCloud 空間已滿時，Scriptable 可能無法把程式存在 iCloud 雲碟。改成存在手機上即可；這只影響這支 iPhone。這個短程式的所有資料都存在手機上，不用 iCloud。</p>
    <ol>
      <li><b>Settings</b> → your name → <b>iCloud</b> → <b>See All</b> (next to Saved to iCloud) → <b>Scriptable</b> (it may be inside
        <b>iCloud Drive</b>) → off.<span>「設定」→ 你的名字 → iCloud →「儲存到 iCloud」旁的「顯示全部」→ Scriptable（可能在「iCloud 雲碟」裡）→ 關閉。</span></li>
      <li>Open Scriptable (its list is empty now), then follow the steps below.<span>打開 Scriptable（清單現在是空的），再照下面的步驟做。</span></li>
    </ol>
    <p class="note">Still crashes? Tell Claude. 仍然閃退的話，請告訴 Claude。</p>
  </section>

  <section>
    <h2>Already have the long TaiwanWeather?</h2>
    <p class="note">Where Scriptable works, you can switch: copy the short script, open TaiwanWeather in Scriptable, select all, and
      paste over it. Then tap ▶ once; updates come by themselves from then on.<br>
      在 Scriptable 正常的手機上也可以換成短程式：複製後到 Scriptable 打開 TaiwanWeather，全選後貼上取代，再按一次 ▶；之後就會自動更新。</p>
  </section>

  <section>
    <h2>On your iPhone</h2>
    <ol>
      <li><b>Install Scriptable</b> (free) from the <a href="https://apps.apple.com/app/scriptable/id1405459188">App Store</a>.<span>安裝 Scriptable（免費）。</span></li>
      <li>Tap <b>Copy script</b> above.<span>按上方的 Copy script。</span></li>
      <li>In Scriptable, tap <b>+</b> (top right), tap the empty page, then <b>Paste</b>.<span>在 Scriptable 點右上角「+」，點一下空白處，選「貼上」。</span></li>
      <li>Tap the title at the top, rename it <b>TaiwanWeather</b>, then tap <b>Done</b>.<span>點最上方的標題，改名為 TaiwanWeather，再按「完成」。</span></li>
      <li>Open it and tap <b>▶</b> (bottom right). The first time, it downloads the full weather script from GitHub (about ${fullKb} KB,
        so it needs the internet). Paste your CWA key (<code>CWA-XXXXXXXX-…</code>) if asked, and allow location.<span>打開它，按右下角 ▶ 執行。第一次會從 GitHub 下載完整的天氣程式（約 ${fullKb} KB，需要網路）。若要求授權碼，貼上 CWA 授權碼，並允許取用位置。</span></li>
    </ol>
    <p class="note">Updates need nothing from you. Each time you open TaiwanWeather in Scriptable, it gets the newest version from
      GitHub and uses it from the next time. The widgets use the copy kept on the phone.<br>
      之後的更新不必做任何事：每次在 Scriptable 打開 TaiwanWeather，它會從 GitHub 取得最新版，下次開啟時使用。小工具用手機上保留的那一份。</p>
  </section>

  <section>
    <h2>Copy didn't work?</h2>
    <p class="note">Tap in the box, choose <b>Select All</b> (全選), then <b>Copy</b> (拷貝).</p>
    <textarea id="code" readonly spellcheck="false" aria-label="TaiwanWeather (short script)">${esc(code)}</textarea>
  </section>
</main>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
const code = document.getElementById("code"), status = document.getElementById("status");
function report(ok) {
  status.dataset.state = ok ? "ok" : "fail";
  status.textContent = ok
    ? "Copied " + code.value.length.toLocaleString("en") + " characters. Now open Scriptable and paste. 已複製，請到 Scriptable 貼上。"
    : "This browser blocked copying. Use the box below: Select All, then Copy. 請用下方方框：全選後拷貝。";
}
document.getElementById("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(code.value); report(true); return; } catch (e) { /* fall back below */ }
  code.focus();
  code.setSelectionRange(0, code.value.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  report(ok);
});
const pageUrl = ${JSON.stringify(pageUrl)};
if (pageUrl && window.QRCode) {
  new QRCode(document.getElementById("qr"), { text: pageUrl, width: 148, height: 148, correctLevel: QRCode.CorrectLevel.M });
  document.getElementById("qr-box").classList.add("ready");
}
</script>
</body>
</html>
`;
fs.writeFileSync(out, html);
console.log(`wrote ${out}: the ${lines}-line loader (full script ${fullLines} lines, ${fullKb} KB)${pageUrl ? ", QR for " + pageUrl : ""}`);
