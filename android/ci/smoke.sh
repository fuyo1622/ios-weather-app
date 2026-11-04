#!/usr/bin/env bash
# The emulator test (GitHub Actions, .github/workflows/android.yml): install the test build and open it at Taipei 101
# as on a new phone, typing the CWA key ($CWA_KEY) into its first-run dialog; photograph the dialog, the full view, a
# detail sheet, the page after Android's back button, the radar, the page after its 中文 link, the three widgets, the
# test notification, and then, with the phone moved to Tokyo, the widgets and the page outside Taiwan; fail if the
# script logged an error, the key wasn't kept, a link or a notification didn't work, the widgets got no forecast, or
# abroad, either still showed one. The screenshots and the log are a public artifact: nothing here prints the
# key, and no screenshot is taken while it is on screen.
#   bash android/ci/smoke.sh <app-debug.apk> <folder for the screenshots and the log>
set -eu # (no pipefail: grep stopping early would fail the log pipes)
APK=$1
OUT=${2:-shots}
PKG=com.fuyo1622.taiwanweather
mkdir -p "$OUT"

shot() { adb exec-out screencap -p > "$OUT/$1.png"; }
log() { adb logcat -d -s TaiwanWeather:* 2>/dev/null || true; }
trap 'log > "$OUT/logcat.txt"' EXIT
count() { log | grep -c -- "$1" || true; }
fail() { echo "$1"; exit 1; }
# run JavaScript on the open page (passed in base64: the device's shell would split it); its answer goes to the log
page() { adb shell am broadcast -n "$PKG/.DebugReceiver" -a EVAL --es js64 "$(printf '%s' "$1" | base64 -w0)" > /dev/null; }
wait_for() { # a line in the app's log, within $2 seconds
  for _ in $(seq 1 $(( ${2:-60} / 3 ))); do log | grep -- "$1" > /dev/null && return 0; sleep 3; done
  echo "timed out waiting for: $1"; log | tail -40; return 1
}
another() { # one more line with $1 in the log than the $2 before, within $3 seconds
  for _ in $(seq 1 $(( ${3:-60} / 3 ))); do [ "$(count "$1")" -gt "$2" ] && return 0; sleep 3; done
  echo "timed out waiting for another: $1"; log | tail -40; return 1
}
tap() { # the first view on screen whose node in uiautomator's dump matches $1, within $2 seconds
  for _ in $(seq 1 $(( ${2:-30} / 3 ))); do
    adb shell rm -f /data/local/tmp/ui.xml
    adb shell uiautomator dump /data/local/tmp/ui.xml > /dev/null 2>&1 || true
    at=$(adb shell cat /data/local/tmp/ui.xml 2>/dev/null | tr '>' '\n' | grep -- "$1" | head -1 |
      sed -nE 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/p')
    if [ -n "$at" ]; then
      set -- $at
      adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
      return 0
    fi
    sleep 3
  done
  echo "not on screen: $1"; return 1
}
notes() { adb shell dumpsys notification --noredact | grep -c -- "$1" || true; } # lines of the posted ones with $1

adb install -r "$APK"
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do adb shell pm grant "$PKG" "android.permission.$p" || true; done
adb shell cmd location set-location-enabled true || true
adb emu geo fix 121.5654 25.033 # Taipei 101 (longitude first)
adb logcat -c

# The first run, as on a new phone: the CWA key dialog.
adb shell am start -n "$PKG/.MainActivity"
adb emu geo fix 121.5654 25.033 # again, for an app that waits for a new fix
tap 'class="android.widget.EditText"' 60
sleep 2
shot 0-key-dialog # (before the key is typed)
if [ -n "${CWA_KEY:-}" ]; then
  adb shell input text "$CWA_KEY"
  adb shell input keyevent KEYCODE_BACK # hides the keyboard (the dialog itself stays)
  sleep 1
  tap 'resource-id="android:id/button1"' # Save
else
  tap 'resource-id="android:id/button2"' # Skip: no key in this repository's secrets
fi
wait_for "page loaded" 90
# the first page is the saved forecast or the place's name; wait for the fresh one (with the hourly card)
for _ in $(seq 1 30); do
  page "document.getElementById('outlook') ? 'fresh page' : 'waiting'"
  sleep 3
  log | grep 'eval: "fresh page"' > /dev/null && break
done
if [ -n "${CWA_KEY:-}" ]; then # kept for the next runs? (compared here, never printed)
  kept=$(adb shell run-as "$PKG" cat shared_prefs/keychain.xml | tr -d '\r' | sed -n 's/.*name="CWA_API_KEY">\([^<]*\)<.*/\1/p')
  [ "$kept" = "$CWA_KEY" ] || fail "the dialog didn't keep the key"
  echo "the dialog kept the key"
fi
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

# The page's links go to the script (tw-weather://): Send a test (a notification now, one more from the widgets'
# next refresh), then 中文.
loads=$(count "page loaded")
page "document.querySelector(\"a[href='tw-weather://test']\").click(); 'tapped Send a test'"
another "page loaded" "$loads" 30
app_notes=$(notes "Notifications work.")
loads=$(count "page loaded")
page "document.querySelector(\"a[href='tw-weather://lang?to=zh']\").click(); 'tapped 中文'"
another "page loaded" "$loads" 30
sleep 2
page "window.scrollTo(0, 0); document.body.innerText.includes('目前位置') ? 'page in 中文' : 'page not in 中文'"
sleep 3
shot 5-zh-view

refreshed=$(count "widgets refreshed")
adb shell am broadcast -n "$PKG/.DebugReceiver" -a REFRESH > /dev/null
another "widgets refreshed" "$refreshed" 120
widget_notes=$(notes "小工具的通知也正常")
adb shell am start -n "$PKG/.WidgetPreviewActivity"
sleep 5
shot 6-widgets
adb shell cmd statusbar expand-notifications
sleep 3
shot 7-notification
adb shell cmd statusbar collapse

# Abroad (Tokyo): My Location's widget, then the app opened afresh, say it's outside Taiwan. The phone moves through
# Android's test location providers, so Tokyo is at once the newest fix the app can find (a GPS fix from the emulator
# isn't, while the app still has one from Taipei under 10 minutes old; on a real trip that one is hours old).
adb shell appops set com.android.shell android:mock_location allow || adb shell appops set com.android.shell MOCK_LOCATION allow || true
for p in gps network fused; do
  adb shell cmd location providers add-test-provider "$p" || true
  adb shell cmd location providers set-test-provider-enabled "$p" true || true
  adb shell cmd location providers set-test-provider-location "$p" --location 35.68,139.76 --accuracy 10 || true
done
sleep 3
refreshed=$(count "widgets refreshed")
adb shell am broadcast -n "$PKG/.DebugReceiver" -a REFRESH > /dev/null
another "widgets refreshed" "$refreshed" 120
adb shell am start -n "$PKG/.WidgetPreviewActivity"
sleep 4
shot 8-widgets-abroad
adb shell am force-stop "$PKG"
adb shell am start -n "$PKG/.MainActivity"
for _ in $(seq 1 30); do
  page "document.getElementById('outside') ? 'page outside Taiwan' : 'waiting'"
  sleep 3
  log | grep 'eval: "page outside Taiwan"' > /dev/null && break
done
shot 9-abroad-view

log > "$OUT/logcat.txt"
grep -q 'eval: "sheet closed by back"' "$OUT/logcat.txt" || fail "the back button didn't close the sheet"
grep -q 'eval: "page in 中文"' "$OUT/logcat.txt" || fail "the 中文 link didn't switch the page"
grep -q "widget data for 'My Location': {\"place\"" "$OUT/logcat.txt" || fail "no forecast for the widgets"
[ "$app_notes" -gt 0 ] || fail "no notification from the page's Send a test"
[ "$widget_notes" -gt 0 ] || fail "no test notification from the widgets' refresh"
grep -q "widget data for 'My Location': .*\"outside\":true" "$OUT/logcat.txt" || fail "abroad, the widget didn't say outside Taiwan"
grep -q 'eval: "page outside Taiwan"' "$OUT/logcat.txt" || fail "abroad, the page didn't say outside Taiwan"
if grep -E "Uncaught|TypeError|ReferenceError|SyntaxError|TaiwanWeather.js stopped" "$OUT/logcat.txt"; then fail "script errors above"; fi
grep -E 'eval: "|widget data for' "$OUT/logcat.txt" | cut -c1-400
echo "emulator test passed"
