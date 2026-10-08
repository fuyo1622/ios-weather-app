// Builds the install page: TaiwanWeather.js behind a "Copy script" button, with the iPhone steps.
// It is published as a private claude.ai artifact, so the script can be pasted into Scriptable
// without iCloud Drive. Rebuild and republish it whenever TaiwanWeather.js changes.
//   node tools/install-page.mjs <out.html> [the page's own URL, for the QR code]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [out, pageUrl = ""] = process.argv.slice(2);
if (!out) throw new Error("usage: node tools/install-page.mjs <out.html> [page URL]");

const code = fs.readFileSync(path.join(root, "TaiwanWeather.js"), "utf8");
const lines = code.split("\n").length, kb = Math.round(Buffer.byteLength(code) / 1024);
const version = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const html = `<title>TaiwanWeather Script</title>
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
body { background: var(--bg); color: var(--fg); font: 16px/1.6 var(--body); }
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
<main class="wrap">
  <header>
    <p class="eyebrow">Scriptable widget · 中央氣象署 + 7 models</p>
    <h1>TaiwanWeather</h1>
    <p class="meta">Version ${version} · ${lines.toLocaleString("en")} lines · ${kb} KB</p>
  </header>

  <section class="qr" id="qr-box" aria-label="Open on your phone">
    <div id="qr"></div>
    <p><b>On the PC?</b> Scan this with the iPhone camera to open this page there.<br>用 iPhone 相機掃描，在手機上開啟本頁。<br>${esc(pageUrl)}</p>
  </section>

  <section class="copy">
    <button id="copy" type="button">Copy script</button>
    <p id="status" class="status" role="status">Copies the whole script, ready to paste into Scriptable. 複製整個程式。</p>
  </section>

  <section>
    <h2>On your iPhone</h2>
    <ol>
      <li><b>Install Scriptable</b> (free) from the <a href="https://apps.apple.com/app/scriptable/id1405459188">App Store</a>.<span>安裝 Scriptable（免費）。</span></li>
      <li>Tap <b>Copy script</b> above.<span>按上方的 Copy script。</span></li>
      <li>In Scriptable, tap <b>+</b> (top right), tap the empty page, then <b>Paste</b>.<span>在 Scriptable 點右上角「+」，點一下空白處，選「貼上」。</span></li>
      <li>Tap the title at the top, rename it <b>TaiwanWeather</b>, then tap <b>Done</b>.<span>點最上方的標題，改名為 TaiwanWeather，再按「完成」。</span></li>
      <li>Open it and tap <b>▶</b> (bottom right): paste your CWA key (<code>CWA-XXXXXXXX-…</code>) and allow location.<span>打開它，按右下角 ▶ 執行：貼上 CWA 授權碼，並允許取用位置。</span></li>
    </ol>
    <p class="note">Updating later: open this page again, copy, then open TaiwanWeather in Scriptable, select all, and paste over it.<br>
      之後更新：再開本頁複製，到 Scriptable 打開 TaiwanWeather，全選後貼上取代。</p>
  </section>

  <section>
    <h2>Copy didn't work?</h2>
    <p class="note">Tap in the box, choose <b>Select All</b> (全選), then <b>Copy</b> (拷貝).</p>
    <textarea id="code" readonly spellcheck="false" aria-label="TaiwanWeather.js">${esc(code)}</textarea>
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
`;
fs.writeFileSync(out, html);
console.log(`wrote ${out}: ${lines} lines, ${kb} KB of script${pageUrl ? ", QR for " + pageUrl : ""}`);
