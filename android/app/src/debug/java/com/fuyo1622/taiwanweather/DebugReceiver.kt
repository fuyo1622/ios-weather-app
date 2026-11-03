package com.fuyo1622.taiwanweather

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log

/**
 * Test builds only, for the emulator tests (android/ci/smoke.sh):
 *   adb shell am broadcast -n com.fuyo1622.taiwanweather/.DebugReceiver -a EVAL --es js64 <base64 of js>
 *       runs js on the open page and logs its answer ("eval: …")
 *   adb shell am broadcast -n com.fuyo1622.taiwanweather/.DebugReceiver -a REFRESH
 *       refreshes the widgets now
 */
class DebugReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            "EVAL" -> {
                val js = intent.getStringExtra("js64")?.let { String(Base64.decode(it, Base64.DEFAULT)) } ?: return
                val screen = MainActivity.current ?: run { Log.i(TAG, "eval: the app isn't open"); return }
                screen.runOnUiThread { screen.page.evaluateJavascript(js) { Log.i(TAG, "eval: $it") } }
            }
            "REFRESH" -> Refresh.now(context)
        }
    }
}
