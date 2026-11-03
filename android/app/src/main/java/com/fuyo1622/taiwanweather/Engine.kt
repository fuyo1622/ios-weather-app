package com.fuyo1622.taiwanweather

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

const val TAG = "TaiwanWeather"

/**
 * Runs TaiwanWeather.js in a WebView of its own (nothing to see), with the Scriptable API from shim.js on top of
 * [Bridge], as the Scriptable app runs it on the iPhone. [host] is the app's screen when it is open (dialogs and the
 * page you see); widget refreshes run without one. Create it on the main thread.
 */
class Engine(
    context: Context,
    val host: Host?,
    private val onWidget: (place: String, json: String) -> Unit = { _, _ -> },
    private val onFailed: (message: String) -> Unit = {},
    private val onDone: () -> Unit = {},
) {
    /** What the script needs from the app's screen. Each runs on the main thread and answers once. */
    interface Host {
        fun alert(spec: JSONObject, done: (JSONObject) -> Unit)
        fun load(html: String, baseUrl: String, done: () -> Unit)
        fun eval(js: String, done: (String?) -> Unit)
        fun present(done: () -> Unit)
    }

    val context: Context = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val results = ConcurrentHashMap<Int, String>()
    private var web: WebView? = null
    @Volatile private var finished = false

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun start(mode: String, params: JSONObject) {
        val view = WebView(context)
        web = view
        view.settings.javaScriptEnabled = true
        view.addJavascriptInterface(Bridge(this), "Native")
        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean {
                Log.d(TAG, "script: ${m.message()} (line ${m.lineNumber()})")
                return true
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun onPageFinished(v: WebView, url: String?) {
                v.evaluateJavascript("__start(${JSONObject.quote(mode)}, $params)", null)
            }
        }
        val shim = context.assets.open("shim.js").bufferedReader().use { it.readText() }
        view.loadDataWithBaseURL("https://appassets.androidplatform.net/", "<!doctype html><meta charset=utf-8><script>$shim</script>",
            "text/html", "utf-8", null)
    }

    /** Answers call [id] of the script; it then reads [value] with Native.result(id). Any thread. */
    fun finish(id: Int, ok: Boolean, value: String?) {
        if (value != null) results[id] = value
        main.post { web?.evaluateJavascript("__tw.done($id, $ok)", null) }
    }

    fun take(id: Int): String? = results.remove(id)

    /** A tw-weather:// link tapped on the page you see. */
    fun link(url: String) = main.post { web?.evaluateJavascript("__tw.link(${JSONObject.quote(url)})", null) }

    fun widget(place: String, json: String) = onWidget(place, json)
    fun failed(message: String) = main.post { onFailed(message) }

    fun done() {
        if (finished) return
        finished = true
        main.post { onDone() }
    }

    fun destroy() = main.post {
        web?.destroy()
        web = null
    }
}
