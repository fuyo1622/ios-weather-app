// The Scriptable API that TaiwanWeather.js uses, on Android. The script runs in a WebView of its own (Engine.kt), as
// Scriptable runs it on the iPhone; everything that needs the phone (the internet, files, the stored CWA key, location,
// notifications, dialogs, the page you see) goes through window.Native (Bridge.kt). Calls that take time answer later
// through __tw.done(id, ok); their result is then fetched with Native.result(id).
(() => {
  const waiting = new Map();
  let nextId = 1;
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    Native[method](id, ...args);
  });
  const views = new Map();
  window.__tw = {
    done(id, ok) {
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      const value = Native.result(id);
      if (ok) w.resolve(value); else w.reject(new Error(value || "failed"));
    },
    // a tw-weather:// link tapped on the page you see
    link(url) { for (const v of views.values()) if (v.shouldAllowRequest) v.shouldAllowRequest({ url }); },
  };

  class Request {
    constructor(url) { this.url = url; this.timeoutInterval = 60; this.method = "GET"; this.headers = {}; }
    loadString() { return call("http", this.url, Math.round(this.timeoutInterval * 1000)); }
    async loadJSON() { return JSON.parse(await this.loadString()); }
  }
  const files = {
    documentsDirectory: () => Native.filesDir(),
    joinPath: (a, b) => a.replace(/\/+$/, "") + "/" + b,
    fileExists: (path) => Native.exists(path),
    createDirectory: (path) => Native.mkdirs(path),
    readString: (path) => Native.read(path),
    writeString: (path, text) => Native.write(path, text),
  };
  const FileManager = { local: () => files, iCloud: () => files };
  const Keychain = {
    contains: (key) => Native.keyHas(key), get: (key) => Native.keyGet(key),
    set: (key, value) => Native.keySet(key, String(value)), remove: (key) => Native.keyRemove(key),
  };
  const Location = {
    setAccuracyToThreeKilometers() {},
    async current() { return JSON.parse(await call("location")); },
    async reverseGeocode(latitude, longitude, locale) { return JSON.parse(await call("geocode", latitude, longitude, locale || "zh_TW")); },
  };
  class Notification {
    async schedule() { Native.notify(String(this.identifier || ""), String(this.title || ""), String(this.body || "")); }
  }
  class Alert {
    constructor() { this.title = ""; this.message = ""; this.fields = []; this.actions = []; this.cancel = null; this.values = []; }
    addTextField(placeholder, text) { this.fields.push({ placeholder: placeholder || "", text: text || "" }); }
    addSecureTextField(placeholder, text) { this.addTextField(placeholder, text); }
    addAction(title) { this.actions.push(title); }
    addDestructiveAction(title) { this.actions.push(title); }
    addCancelAction(title) { this.cancel = title; }
    async present() {
      const answer = JSON.parse(await call("alert", JSON.stringify({ title: this.title, message: this.message,
        fields: this.fields, actions: this.actions, cancel: this.cancel })));
      this.values = answer.values || [];
      return answer.button;
    }
    textFieldValue(i) { return this.values[i] ?? ""; }
  }
  // The page you see: one per app screen, as on the iPhone.
  class WebView {
    constructor() { this.id = Native.viewCreate(); this.shouldAllowRequest = null; views.set(this.id, this); }
    loadHTML(html, baseURL) { return call("viewLoad", String(html), baseURL || ""); }
    present() { return call("viewPresent"); }
    // Android answers with the value as JSON (a string comes quoted); Scriptable with the value itself
    async evaluateJavaScript(js) { const json = await call("viewEval", String(js)); return json == null ? null : JSON.parse(json); }
  }
  const Timer = {
    schedule(ms, repeats, fn) {
      const id = repeats ? setInterval(fn, ms) : setTimeout(fn, ms);
      return { invalidate() { clearTimeout(id); clearInterval(id); } };
    },
  };
  // Widgets are drawn by Android from widgetData() below; these only let the script's iPhone widget code load.
  class WidgetStack {
    constructor() { this.children = []; }
    add(o) { this.children.push(o); return o; }
    addStack() { return this.add(new WidgetStack()); }
    addText(text) { return this.add({ text }); }
    addImage(image) { return this.add({ image }); }
    addSpacer() { return this.add({}); }
    layoutVertically() {} layoutHorizontally() {} topAlignContent() {} centerAlignContent() {} bottomAlignContent() {} setPadding() {}
  }
  class ListWidget extends WidgetStack { presentSmall() {} presentMedium() {} presentLarge() {} }
  function Color(hex, alpha = 1) { this.hex = hex; this.alpha = alpha; }
  Color.white = () => new Color("#ffffff");
  const Font = { systemFont: (size) => ({ size }), boldSystemFont: (size) => ({ size, bold: true }) };
  function Size(width, height) { this.width = width; this.height = height; }
  function LinearGradient() { this.colors = []; this.locations = []; }
  const SFSymbol = { named: (name) => ({ image: { name } }) };
  const config = { runsInApp: false, runsInWidget: false, runsInAccessoryWidget: false, widgetFamily: null };
  const args = { widgetParameter: null, queryParameters: {} };
  const Script = { name: () => "TaiwanWeather", setWidget() {}, complete() {}, refreshWidgets: () => Native.refreshWidgets() };

  // What a home-screen widget shows, as buildWidget() does on the iPhone: now, the condition, today's high and low,
  // the rain line, the hours (8, every 2 hours, and 24), tomorrow, and the bottom line (warnings, or the time and
  // the station).
  function widgetData(W, r) {
    const T = W.T(), time = new Date(r.updated).toTimeString().slice(0, 5);
    // My Location outside Taiwan: no forecast, the widget says so
    if (r.outside) return { place: T.here, temp: "–", icon: "🌏", condition: T.outside, hiLo: "", rain: T.outsideShort,
      hours8: [], hours24: [], tomorrow: "", bottom: time, bottomSmall: time, warn: false, updated: r.updated, outside: true };
    const now = r.rows[0], cur = r.station && r.station.t != null ? r.station.t : now.t;
    const wx = (r.station && r.station.weather) || now.wx || "";
    const hour = (h) => ({ h: W.fmtHour(h.key), icon: W.EMOJI[W.wxSymbol(h.wx, h.pop, h.night)], t: W.fmtT(h.t),
      pop: h.pop == null ? "" : Math.round(h.pop) + "%" });
    const titles = (r.warnings || []).map((x) => x.title);
    // active CWA warnings replace the bottom line; small widgets name the first and count the rest ("⚠︎ 豪雨特報 +1")
    const warning = (compact) => "⚠︎ " + (compact && titles.length > 1 ? `${titles[0]} +${titles.length - 1}` : titles.join(" · "));
    const plain = (r.stale ? `⚠︎ ${T.stale} · ` : "") + time + (r.station ? ` · ${r.station.name} ${r.station.distance.toFixed(1)}km` : "");
    const stale = r.stale ? T.stale + " · " : "", t = r.summary.tomorrow;
    return {
      place: r.place, temp: W.fmtT(cur), icon: W.EMOJI[W.wxSymbol(wx, now.pop, now.night)], condition: wx,
      hiLo: T.hiLo(W.fmtT(r.summary.hi), W.fmtT(r.summary.lo)), rain: W.nowText(r),
      hours8: [1, 3, 5, 7, 9, 11, 13, 15].map((i) => r.rows[i]).filter(Boolean).map(hour),
      hours24: r.rows.slice(1, 25).map(hour),
      tomorrow: t ? T.tomorrowLine(W.fmtT(t.hi), W.fmtT(t.lo), t.pop == null ? "–" : Math.round(t.pop) + "%") : "",
      bottom: titles.length ? `${stale}${warning(false)} · ${time}` : plain,
      bottomSmall: titles.length ? `${stale}${warning(true)} · ${time}` : plain,
      warn: titles.length > 0, updated: r.updated,
    };
  }

  // Android's own words where the iPhone's would be wrong.
  function android(W) {
    W.WORDS.en.via.apple = "township from Android's geocoder";
    W.WORDS.zh.via.apple = "鄉鎮由 Android 地理編碼判定";
    W.WORDS.en.widgetsFollow = W.WORDS.zh.widgetsFollow = ""; // here they refresh at once (Script.refreshWidgets)
  }

  // Start the script: "app" (the full view, as when you open it), or "widget" (a forecast for each place a widget
  // shows, handed to Android with Native.widget; My Location also sends its rain and warning notifications).
  window.__start = async (mode, params) => {
    try {
      const globals = { __TEST__: true, Request, FileManager, Location, Keychain, config, Script, args, Notification,
        ListWidget, Color, Font, Size, LinearGradient, SFSymbol, Alert, WebView, Timer };
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      const exportsLine = "\nreturn { main, run, loadSettings, saveSettings, setLang, findPlace, sendNotification, T, WORDS," +
        " EMOJI, wxSymbol, fmtT, fmtHour, nowText, KEYCHAIN_KEY };";
      const W = await new AsyncFunction(...Object.keys(globals), Native.asset("TaiwanWeather.js") + exportsLine)(...Object.values(globals));
      android(W);
      window.__W = W;
      if (mode === "app") {
        config.runsInApp = true;
        if (params && params.place) args.queryParameters = { place: params.place };
        await W.main();
      } else {
        config.runsInWidget = true;
        const settings = await W.loadSettings();
        W.setLang(settings.lang);
        const key = Keychain.contains(W.KEYCHAIN_KEY) ? Keychain.get(W.KEYCHAIN_KEY) : null;
        for (const name of (params && params.places) || [""]) {
          try {
            const place = name ? W.findPlace(name) : null;
            if (name && !place) throw new Error(W.T().unknownPlace(name));
            const r = await W.run(key, { place, settings });
            Native.widget(name, JSON.stringify(widgetData(W, r)));
          } catch (e) {
            Native.widget(name, JSON.stringify({ error: W.T().weatherError + e.message }));
          }
        }
        if (settings.notifyTest) { // armed by "Send a test" in the full view
          await W.sendNotification("test", W.T().testTitle, W.T().testBodyWidget);
          settings.notifyTest = false;
          W.saveSettings(settings);
        }
      }
    } catch (e) {
      Native.log("TaiwanWeather.js stopped: " + (e && e.stack ? e.stack : e));
      if (mode === "app") Native.failed(String(e && e.message ? e.message : e));
    }
    Native.done();
  };
  window.__widgetData = widgetData;
})();
