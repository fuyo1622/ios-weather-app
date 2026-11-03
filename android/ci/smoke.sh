#!/usr/bin/env bash
# The emulator test (GitHub Actions, .github/workflows/android.yml): install the test build, open it at Taipei 101
# with the CWA key ($CWA_KEY), photograph the full view, a detail sheet, the page after Android's back button, the
# radar and the three widgets, and fail if the script logged an error or the widgets got no forecast.
#   bash android/ci/smoke.sh <app-debug.apk> <folder for the screenshots and the log>
set -eu # (no pipefail: grep stopping early would fail the log pipes)
APK=$1
OUT=${2:-shots}
PKG=com.fuyo1622.taiwanweather
mkdir -p "$OUT"

shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
log() { adb logcat -d -s TaiwanWeather:* 2>/dev/null || true; }
# run JavaScript on the open page (passed in base64: the device's shell would split it); its answer goes to the log
page() { adb shell am broadcast -n "$PKG/.DebugReceiver" -a EVAL --es js64 "$(printf '%s' "$1" | base64 -w0)" > /dev/null; }
wait_for() { # a line in the app's log, within $2 seconds
  for _ in $(seq 1 $(( ${2:-60} / 3 ))); do log | grep -- "$1" > /dev/null && return 0; sleep 3; done
  echo "timed out waiting for: $1"; log | tail -40; return 1
}

adb install -r "$APK"
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant "$PKG" "android.permission.$p" || true; done
adb emu geo fix 121.5654 25.033 # Taipei 101 (longitude first)
adb logcat -c

adb shell am start -n "$PKG/.MainActivity" --es cwaKey "${CWA_KEY:-}"
wait_for "page loaded" 90
# the first page is the saved forecast or the place's name; wait for the fresh one (with the hourly card)
for _ in $(seq 1 30); do
  page "document.getElementById('outlook') ? 'fresh page' : 'waiting'"
  sleep 3
  log | grep 'eval: "fresh page"' > /dev/null && break
done
sleep 12 # the next-hour card reads the radar images
shot 1-full-view
page "document.getElementById('nh-source') ? document.getElementById('nh-text').textContent + ' | ' + document.getElementById('nh-source').textContent : 'no next hour'"
page "document.querySelector('[data-detail=conditions]').click(); 'opened the conditions sheet'"
sleep 3
shot 2-detail-sheet
adb shell input keyevent KEYCODE_BACK
sleep 3
shot 3-after-back
page "document.getElementById('detail').hidden ? 'sheet closed by back' : 'sheet still open'"
page "window.scrollTo(0, document.querySelector('.radar').offsetTop); 'scrolled to the radar'"
sleep 8
shot 4-radar

adb shell am broadcast -n "$PKG/.DebugReceiver" -a REFRESH > /dev/null
wait_for "widgets refreshed" 120
adb shell am start -n "$PKG/.WidgetPreviewActivity"
sleep 5
shot 5-widgets

log > "$OUT/logcat.txt"
grep -q 'eval: "sheet closed by back"' "$OUT/logcat.txt" || { echo "the back button didn't close the sheet"; exit 1; }
grep -q "widget data for 'My Location': {\"place\"" "$OUT/logcat.txt" || { echo "no forecast for the widgets"; exit 1; }
if grep -E "Uncaught|TypeError|ReferenceError|SyntaxError|TaiwanWeather.js stopped" "$OUT/logcat.txt"; then
  echo "script errors above"
  exit 1
fi
grep -E 'eval: "|widget data for' "$OUT/logcat.txt" | cut -c1-400
echo "emulator test passed"
