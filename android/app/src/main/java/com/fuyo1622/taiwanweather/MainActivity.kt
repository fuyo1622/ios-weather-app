package com.fuyo1622.taiwanweather

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.text.InputType
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONArray
import org.json.JSONObject

/**
 * The full view: the page TaiwanWeather.js draws (as Scriptable presents it on the iPhone), its links back to the
 * script, the CWA-key dialog, and Android's back button (it first closes a sheet or the radar's full screen).
 */
class MainActivity : ComponentActivity(), Engine.Host {
    lateinit var page: WebView
    private var engine: Engine? = null
    private var loaded: (() -> Unit)? = null
    private var dismissed: (() -> Unit)? = null

    private val askPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { start() }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        page = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#2f6fbd"))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val url = request.url.toString()
                    if (!url.startsWith("tw-weather:")) return false
                    engine?.link(url)
                    return true
                }
                override fun onPageFinished(view: WebView, url: String?) {
                    Log.i(TAG, "page loaded")
                    loaded?.invoke()
                    loaded = null
                }
            }
            webChromeClient = object : android.webkit.WebChromeClient() {
                override fun onConsoleMessage(m: android.webkit.ConsoleMessage): Boolean {
                    Log.d(TAG, "page: ${m.message()} (line ${m.lineNumber()})")
                    return true
                }
            }
        }
        // the page stays clear of the status and navigation bars
        val frame = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#1d2a40"))
            addView(page, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(frame)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                page.evaluateJavascript("window.__back ? __back() : false") { if (it != "true") finish() }
            }
        })
        val wanted = mutableListOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) wanted += Manifest.permission.POST_NOTIFICATIONS
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) start() else askPermissions.launch(missing.toTypedArray())
    }

    private fun start() {
        if (engine != null) return
        val params = JSONObject().put("place", intent.getStringExtra(EXTRA_PLACE) ?: JSONObject.NULL)
        engine = Engine(this, this, onFailed = ::showError).also { it.start("app", params) }
        Refresh.schedule(this)
    }

    // A widget for another place tapped while the app is open: start again on that place.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.getStringExtra(EXTRA_PLACE) != this.intent.getStringExtra(EXTRA_PLACE)) {
            setIntent(intent)
            recreate()
        }
    }

    override fun onDestroy() {
        if (current === this) current = null
        dismissed?.invoke()
        dismissed = null
        engine?.destroy()
        page.destroy()
        super.onDestroy()
    }

    // Engine.Host
    override fun load(html: String, baseUrl: String, done: () -> Unit) {
        loaded?.invoke() // a page replaced before it finished loading
        loaded = done
        page.loadDataWithBaseURL(baseUrl.ifEmpty { null }, html, "text/html", "utf-8", null)
    }

    override fun eval(js: String, done: (String?) -> Unit) = page.evaluateJavascript(js) { done(it) }

    override fun present(done: () -> Unit) { dismissed = done }

    override fun alert(spec: JSONObject, done: (JSONObject) -> Unit) {
        val fields = spec.optJSONArray("fields") ?: JSONArray()
        val inputs = (0 until fields.length()).map { i ->
            EditText(this).apply {
                hint = fields.getJSONObject(i).optString("placeholder")
                setText(fields.getJSONObject(i).optString("text"))
                isSingleLine = true
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            }
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(56, 8, 56, 0)
            inputs.forEach { addView(it) }
        }
        val answer = { button: Int -> done(JSONObject().put("button", button).put("values", JSONArray(inputs.map { it.text.toString() }))) }
        val actions = spec.optJSONArray("actions") ?: JSONArray()
        val dialog = AlertDialog.Builder(this).setTitle(spec.optString("title")).setMessage(spec.optString("message"))
            .setView(box).setCancelable(false)
        if (actions.length() > 0) dialog.setPositiveButton(actions.getString(0)) { _, _ -> answer(0) }
        if (actions.length() > 1) dialog.setNeutralButton(actions.getString(1)) { _, _ -> answer(1) }
        val cancel = spec.optString("cancel")
        if (cancel.isNotEmpty() && cancel != "null") dialog.setNegativeButton(cancel) { _, _ -> answer(-1) }
        if (actions.length() == 0 && (cancel.isEmpty() || cancel == "null")) dialog.setPositiveButton(android.R.string.ok) { _, _ -> answer(0) }
        dialog.show()
    }

    // TaiwanWeather.js stopped before it could draw anything (e.g. a place it doesn't know).
    private fun showError(message: String) {
        val html = "<html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'></head>" +
            "<body style='margin:0;min-height:100vh;display:grid;place-content:center;padding:0 24px;text-align:center;" +
            "color:#fff;font:17px sans-serif;background:linear-gradient(#2f6fd0,#5aa9e6)'><p>" +
            message.replace("&", "&amp;").replace("<", "&lt;") + "</p></body></html>"
        page.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    companion object {
        const val EXTRA_PLACE = "place"
        /** The open screen, for the test builds' broadcasts. */
        @Volatile var current: MainActivity? = null
    }
}
