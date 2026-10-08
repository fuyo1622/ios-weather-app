# Taiwan Weather (Scriptable widget)

A self-calibrating forecast for Taiwan on your iPhone, with no Mac or App Store needed.

**How it beats a single forecast**
1. **CWA 鄉鎮預報** for your district + **7 models** (JMA 5 km MSM, ECMWF IFS 9 km, ECMWF AIFS, ICON, GFS, UKMO, CMA) via Open-Meteo.
2. **Live correction**: the nearest CWA automatic station's reading pulls the next ~4 h toward reality; if it's raining there now, near-term rain chance is raised.
3. **On-device learning**: every run logs each source's forecast; later runs verify them against station observations, then
   - remove each source's systematic bias (e.g. "GFS is +1.5° here"), and
   - weight sources by their real error at your location (separately for 0–6 h, 6–24 h, 24–48 h, and for rain chance).
   Starts from sensible priors (CWA trusted most) and adapts over ~1–2 weeks.

> Apple doesn't allow plug-ins for the built-in Weather app, so this lives in Home-Screen / Lock-Screen widgets, and tapping
> a widget opens a full view modelled on the Weather app (see below).

## Setup (about 10 minutes)

1. **Get a CWA API key** (free): <https://opendata.cwa.gov.tw/userLogin> → 加入會員 (register) → 氣象會員登入, then
   開發指南 → 使用說明 → 取得授權碼. Copy the `CWA-...` key.
2. **Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** (free) on your iPhone.
3. **Copy the script to the phone**, either way works:
   - Open Scriptable → `+` → paste the contents of `TaiwanWeather.js` → tap the title and name it `TaiwanWeather`; or
   - *iCloud for Windows* (iCloud Drive on and not full): copy `TaiwanWeather.js` into iCloud Drive's Scriptable folder
     (on Windows it is named `iCloud~dk~simonbs~Scriptable`; it appears after Scriptable has been opened once on the phone).
4. **Run it once inside Scriptable**: paste the API key when asked (stored in the iOS Keychain), and allow location access. You'll see the full view.
   If CWA rejects the key (e.g. a typo), running the script in the app again offers to replace it.
5. **Add widgets**: long-press the Home Screen → `+` → Scriptable → pick Small / Medium / Large → edit widget → Script: `TaiwanWeather`.
   Lock Screen: customise → add Scriptable (circular / rectangular / inline) → same script.
6. In iOS Settings → Privacy → Location Services → Scriptable → choose **"While Using the App or Widgets"**.

**Widgets:** Small shows now, condition, today's high/low and the next rain; Medium adds 8 hours (every 2 h);
Large shows 24 hours and tomorrow. Lock Screen: temperature and next rain. Active CWA warnings (特報) replace the
bottom line. Outside Taiwan only the models are used.

**Your township** comes from Apple's geocoder when its names match CWA's, else from the nearest of CWA's 368
township forecast points; the in-app view says which. Learning data stays on the phone (not iCloud).
**Data use:** about 5 KB per widget refresh, plus CWA's full station list (~65 KB) once a week. Opening the full view
adds about 0.3 MB, mostly the map and the radar image.

### Faster learning (optional)
iOS refreshes widgets roughly every 15–60 min. The model learns from every run, so more runs means faster calibration. In **Shortcuts → Automation**, add a few "Time of Day" automations (e.g. every 2–3 h) that *Run Script → TaiwanWeather*, set to run immediately.

## The full view
Tapping a widget (or running the script in Scriptable) opens a page laid out like the iPhone Weather app:
- now, today's high/low, and CWA warnings (特報) for your county;
- a one-line outlook and the next 24 hours, with sunrise and sunset;
- ten days: today and tomorrow from the blend, later days from CWA's 1-week township forecast and Open-Meteo
  (CWA counts double), with bars on the ten days' temperature range;
- a rain radar map (CWA's radar composite over OpenStreetMap, darkened at night) with your position;
- tiles for air quality (US AQI, CAMS model via Open-Meteo), UV, sunrise/sunset, wind (with Beaufort force), rainfall,
  feels-like (Steadman's formula, as CWA's 體感溫度), humidity and dew point, visibility, pressure, and the moon;
- "How this forecast is made": each source's temperature error at your location (samples, bias), the learning above.

Readings come from the nearest CWA station where it measures them, otherwise from Open-Meteo. OpenStreetMap's tiles
are free for light personal use with credit; a widely shared copy would need another map provider.

## Files
- `TaiwanWeather.js`: the whole app (Scriptable script).
- `test/harness.mjs`: the tests. They run the script under Node with mocked Scriptable APIs (`test/env.mjs`), on
  fixtures generated from a synthetic "true" weather (including 10 simulated days of learning), then once against live Open-Meteo.
  - `node test/harness.mjs`; with `OFFLINE=1` the live run is skipped.
  - Put `CWA_KEY=CWA-...` in `.env` (git-ignored) to also test against live CWA, including a check of every response field the script reads.
  - Writes `test/.state/widgets.html` (every widget at iPhone SE, 15/16 and Pro Max sizes, with clipped or cut-off text flagged; `test/preview.mjs`),
    and the full view as `test/.state/app.html` (fixtures) and `app-live.html` (live data).
- `tools/install-page.mjs`: builds the copy page (the whole script behind a "Copy script" button, with the iPhone
  steps and a QR code), published as a private claude.ai artifact so the script can be installed without iCloud Drive.
  Rebuild and republish it whenever `TaiwanWeather.js` changes: `node tools/install-page.mjs <out.html> <page URL>`.
- `SURVEY.md`: background research.

## Toward the iPhone Weather app
Done: hourly and ten-day forecasts, the detail tiles, air quality, CWA warnings, a radar map, sunrise/sunset and moon.
Next, roughly in order:
- Saved places: pin a widget to a township (widget parameter) and switch between places in the full view.
- Notifications: rain starting within the hour, and new CWA warnings (Scriptable can schedule local notifications).
- Radar animation (recent frames) and minute-level rain timing from CWA's QPESUMS nowcast.
- Taiwan's official air-quality stations (環境部, needs a free API key) instead of the model estimate.
- Moonrise/moonset, and today's high/low against the normal for the date.
- Verify humidity, wind and rain amount, not only temperature and rain chance.
