# Taiwan Weather (Scriptable widget)

A self-calibrating forecast for Taiwan on your iPhone, with no Mac or App Store needed.

**How it beats a single forecast**
1. **CWA 鄉鎮預報** for your district + **7 models** (JMA 5 km MSM, ECMWF IFS 9 km, ECMWF AIFS, ICON, GFS, UKMO, CMA) via Open-Meteo.
2. **Live correction**: the nearest CWA automatic station's reading pulls the next ~4 h toward reality; if it's raining there now, near-term rain chance is raised.
3. **On-device learning**: every run logs each source's forecast; later runs verify them against station observations, then
   - remove each source's systematic bias (e.g. "GFS is +1.5° here"), and
   - weight sources by their real error at your location (separately for 0–6 h, 6–24 h, 24–48 h, and for rain chance).
   Starts from sensible priors (CWA trusted most) and adapts over ~1–2 weeks.

> Apple doesn't allow plug-ins for the built-in Weather app, so this lives in Home-Screen / Lock-Screen widgets instead.

## Setup (about 10 minutes)

1. **Get a CWA API key** (free): register at <https://opendata.cwa.gov.tw> → 會員登入 → 取得授權碼. Copy the `CWA-...` key.
2. **Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188)** (free) on your iPhone.
3. **Copy the script to the phone**, either way works:
   - *iCloud for Windows*: copy `TaiwanWeather.js` into `iCloud Drive\Scriptable\`, and it appears in the app; or
   - Open Scriptable → `+` → paste the contents of `TaiwanWeather.js` → name it `TaiwanWeather`.
4. **Run it once inside Scriptable**: paste the API key when asked (stored in the iOS Keychain), and allow location access. You'll see the hourly table and the per-source skill scoreboard.
5. **Add widgets**: long-press the Home Screen → `+` → Scriptable → pick Small / Medium / Large → edit widget → Script: `TaiwanWeather`.
   Lock Screen: customise → add Scriptable (circular / rectangular / inline) → same script.
6. In iOS Settings → Privacy → Location Services → Scriptable → choose **"While Using the App or Widgets"**.

### Faster learning (optional)
iOS refreshes widgets roughly every 15–60 min. The model learns from every run, so more runs means faster calibration. In **Shortcuts → Automation**, add a few "Time of Day" automations (e.g. every 2–3 h) that *Run Script → TaiwanWeather*, set to run immediately.

## Reading the in-app view
- **Temp ±x**: the blended value, ± how much the sources disagree (a bigger spread means less certainty).
- **Source skill**: each source's mean absolute error at your location, with sample count and bias. Before data arrives these are priors.

## Files
- `TaiwanWeather.js`: the whole app (Scriptable script).
- `test/harness.mjs`: runs the script under Node with mocked Scriptable APIs; `node test/harness.mjs` (add `CWA_KEY=...` to hit live CWA).
- `SURVEY.md`: background research.

## Ideas for later
- CWA radar / QPESUMS nowcast for minute-level rain timing.
- Rain-start push alerts (Scriptable notifications).
- Verify humidity, wind and rain amount, not only temperature and rain chance.
