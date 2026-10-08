// Renders mocked widget trees (see env.mjs) as HTML at real iPhone widget sizes, and estimates
// their size, to catch clipped layouts without a phone. Stacks map to flexbox the way Scriptable
// maps them to SwiftUI stacks; text uses SF Pro's line height (about 1.19 × the font size).
export const LINE = 1.193;

// Widget sizes in points from Apple's Human Interface Guidelines, for three screen classes.
export const DEVICES = {
  "iPhone SE · 375 pt": { small: [148, 148], medium: [321, 148], large: [321, 324],
    accessoryCircular: [68, 68], accessoryRectangular: [153, 68], accessoryInline: [225, 26] },
  "iPhone 15/16 · 393 pt": { small: [158, 158], medium: [338, 158], large: [338, 354],
    accessoryCircular: [72, 72], accessoryRectangular: [160, 72], accessoryInline: [234, 26] },
  "iPhone Pro Max · 430 pt": { small: [170, 170], medium: [364, 170], large: [364, 382],
    accessoryCircular: [76, 76], accessoryRectangular: [172, 76], accessoryInline: [257, 26] },
};
export const FAMILIES = ["small", "medium", "large", "accessoryCircular", "accessoryRectangular", "accessoryInline"];

const isFlexSpacer = (n) => n.type === "spacer" && n.length == null;
const flexW = (n) => (n.type === "stack" || n.type === "widget") &&
  n.children.some((c) => (n.layout === "h" && isFlexSpacer(c)) || flexW(c));
const flexH = (n) => (n.type === "stack" || n.type === "widget") &&
  n.children.some((c) => (n.layout === "v" && isFlexSpacer(c)) || flexH(c));

/** Ideal height (pt) of a node; flexible spacers count as zero. */
export function estimateHeight(node, parentLayout = "v") {
  if (node.type === "text") return LINE * node.font.size;
  if (node.type === "image") return node.imageSize.height;
  if (node.type === "spacer") return parentLayout === "v" && node.length != null ? node.length : 0;
  const pad = node.padding ? node.padding[0] + node.padding[2] : 0;
  const hs = node.children.map((c) => estimateHeight(c, node.layout));
  const gaps = node.spacing * Math.max(0, hs.length - 1);
  return pad + (node.layout === "v" ? hs.reduce((a, b) => a + b, 0) + gaps : Math.max(0, ...hs));
}

// Rough SF Pro advance widths in em.
const charEm = (ch) => /[⺀-鿿豈-﫿＀-￯]/.test(ch) ? 1
  : /[0-9]/.test(ch) ? 0.62 : ch === " " ? 0.27 : ch === "°" ? 0.4 : ch === "·" ? 0.3 : 0.58;
/** Ideal width (pt) of a node, or its narrowest width when texts shrink to their minimum scale. */
export function estimateWidth(node, parentLayout = "v", shrunk = false) {
  if (node.type === "text") {
    const w = [...node.text].reduce((a, ch) => a + charEm(ch), 0) * node.font.size * (node.font.bold ? 1.05 : 1);
    return shrunk ? w * (node.minimumScaleFactor || 1) : w;
  }
  if (node.type === "image") return node.imageSize.width;
  if (node.type === "spacer") return parentLayout === "h" && node.length != null ? node.length : 0;
  const pad = node.padding ? node.padding[1] + node.padding[3] : 0;
  const ws = node.children.map((c) => estimateWidth(c, node.layout, shrunk));
  const gaps = node.spacing * Math.max(0, ws.length - 1);
  return pad + (node.layout === "h" ? ws.reduce((a, b) => a + b, 0) + gaps : Math.max(0, ...ws));
}

const EMOJI = {
  "sun.max.fill": "☀️", "moon.stars.fill": "🌙", "cloud.sun.fill": "⛅", "cloud.moon.fill": "☁️",
  "cloud.fill": "☁️", "cloud.rain.fill": "🌧️", "cloud.drizzle.fill": "🌦️", "cloud.bolt.rain.fill": "⛈️",
  "cloud.fog.fill": "🌫️", "cloud.snow.fill": "🌨️",
};
const escHTML = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rgba = (c) => {
  if (!c || !c.hex) return "#fff";
  const n = parseInt(c.hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${c.alpha ?? 1})`;
};

function render(node, parentLayout) {
  // how this node sizes itself inside its parent stack
  const fit = [];
  if (parentLayout === "h") {
    if (isFlexSpacer(node) || flexW(node)) fit.push("flex:1 1 0", "min-width:0");
    else if (node.type === "spacer") fit.push(`flex:0 0 ${node.length}px`);
    else fit.push("flex:0 1 auto", "min-width:0");
  } else {
    if (isFlexSpacer(node) || flexH(node)) fit.push("flex:1 1 0", "min-height:0");
    else if (node.type === "spacer") fit.push(`flex:0 0 ${node.length}px`);
    else fit.push("flex:0 0 auto");
    if (flexW(node)) fit.push("align-self:stretch");
  }
  if (node.type === "spacer") return `<div style="${fit.join(";")}"></div>`;
  if (node.type === "text") {
    const s = [...fit, `font-size:${node.font.size}px`, `font-weight:${node.font.bold ? 700 : 400}`, `color:${rgba(node.textColor)}`];
    return `<div class="t" data-min="${node.minimumScaleFactor || 1}" style="${s.join(";")}">${escHTML(node.text) || "&#8203;"}</div>`;
  }
  if (node.type === "image") {
    const { width, height } = node.imageSize;
    return `<div class="im" title="${node.symbol}" style="${fit.join(";")};width:${width}px;height:${height}px;font-size:${height * 0.82}px">${EMOJI[node.symbol] || "?"}</div>`;
  }
  const align = { top: "flex-start", center: "center", bottom: "flex-end" }[node.align];
  const s = [...fit, "display:flex", `flex-direction:${node.layout === "v" ? "column" : "row"}`, `align-items:${align}`, `gap:${node.spacing}px`];
  if (node.padding) s.push(`padding:${node.padding.map((p) => p + "px").join(" ")}`);
  return `<div style="${s.join(";")}">${node.children.map((c) => render(c, node.layout)).join("")}</div>`;
}

/** One widget as an HTML card at the given size (points = CSS px). */
export function widgetHTML(widget, family, [w, h], label) {
  const home = !family.startsWith("accessory");
  const pad = widget.padding || (home ? [16, 16, 16, 16] : [0, 0, 0, 0]);
  const g = widget.backgroundGradient;
  const bg = !home ? (widget.addAccessoryWidgetBackground ? "rgba(255,255,255,.2)" : "transparent")
    : g ? `linear-gradient(${g.colors.map(rgba).join(",")})` : "#1c1c1e";
  const root = ["display:flex", "flex-direction:column", "align-items:flex-start", "max-width:100%"];
  if (flexW(widget)) root.push("width:100%");
  if (flexH(widget)) root.push("height:100%");
  const body = widget.children.map((c) => render(c, "v")).join("");
  return `<figure class="card"><div class="w ${home ? "home" : "acc"} ${family}" style="width:${w}px;height:${h}px;` +
    `padding:${pad.map((p) => p + "px").join(" ")};background:${bg}"><div class="root" style="${root.join(";")}">${body}</div></div>` +
    `<figcaption>${escHTML(label)} · ${w}×${h}</figcaption></figure>`;
}

/** A page of widget cards; flags clipped or truncated widgets (window.__issues). */
export function previewPage(title, sections) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHTML(title)}</title><style>
body{margin:0;padding:16px;font:13px -apple-system,"Segoe UI",sans-serif;background:#f2f2f7;color:#111}
h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 8px}p{margin:4px 0;color:#555}
.row{display:flex;flex-wrap:wrap;gap:14px;align-items:flex-start;padding:14px;border-radius:14px;
  background:linear-gradient(135deg,#3b4a6b,#7a5c8f)}
.card{margin:0;display:flex;flex-direction:column;gap:4px}figcaption{color:#fff;font-size:11px;opacity:.85}
.w{box-sizing:border-box;overflow:hidden;display:flex;align-items:center;justify-content:center;position:relative;
  font-family:-apple-system,"SF Pro Text","Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;line-height:${LINE};color:#fff}
.w.home{border-radius:22px}.w.accessoryCircular{border-radius:50%}
.root{min-width:0;min-height:0;box-sizing:border-box}
.t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.im{display:flex;align-items:center;justify-content:center;line-height:1;flex-shrink:0}
.bad{outline:3px solid #ff3b30;outline-offset:2px}.warn{outline:3px solid #ffcc00;outline-offset:2px}
.issue{font-size:11px;color:#fff;background:#ff3b30;border-radius:6px;padding:2px 6px;max-width:220px}
.issue.trunc{background:#c79100}
</style></head><body><h1>${escHTML(title)}</h1><div id="summary"></div>
${sections.map((s) => `<h2>${escHTML(s.title)}</h2>${s.note ? `<p>${escHTML(s.note)}</p>` : ""}<div class="row">${s.cards.join("")}</div>`).join("\n")}
<script>
// Shrink text to its minimumScaleFactor like iOS does, then report clipping and truncation.
const issues = [];
for (const t of document.querySelectorAll(".t")) {
  const min = Number(t.dataset.min), base = parseFloat(t.style.fontSize);
  for (let s = 1; t.scrollWidth > t.clientWidth + 0.5 && s - 0.02 >= min - 1e-9; ) {
    s -= 0.02; t.style.fontSize = base * s + "px";
  }
}
for (const w of document.querySelectorAll(".w")) {
  const card = w.parentElement, label = card.querySelector("figcaption").textContent;
  const cs = getComputedStyle(w), root = w.querySelector(".root");
  const avail = w.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const need = Math.max(root.scrollHeight, root.offsetHeight);
  const notes = [];
  if (need > avail + 0.5) {
    w.classList.add("bad");
    notes.push(["clipped: content " + need.toFixed(0) + " pt, room " + avail.toFixed(0) + " pt", ""]);
  }
  for (const t of w.querySelectorAll(".t")) {
    if (t.scrollWidth > t.clientWidth + 0.5) {
      w.classList.add("warn");
      notes.push(["truncated: " + t.textContent, "trunc"]);
    }
  }
  for (const [text, cls] of notes) {
    issues.push(label + " → " + text);
    card.insertAdjacentHTML("beforeend", '<div class="issue ' + cls + '"></div>');
    card.lastChild.textContent = text;
  }
}
window.__issues = issues;
document.getElementById("summary").innerHTML = issues.length
  ? "<p><b>" + issues.length + " layout issue(s)</b> (red = clipped, yellow = text cut off with …)</p>"
  : "<p><b>No clipped or truncated widgets.</b></p>";
</script></body></html>`;
}
