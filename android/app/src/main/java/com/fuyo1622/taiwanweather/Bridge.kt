package com.fuyo1622.taiwanweather

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Geocoder
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.Locale
import java.util.concurrent.Executors

/**
 * What shim.js asks of the phone (window.Native). Methods run on WebView's bridge thread: quick ones answer at once;
 * the rest answer later with [Engine.finish] for the call id the script passes first.
 */
class Bridge(private val engine: Engine) {
    private val context: Context = engine.context
    private val io = Executors.newCachedThreadPool()
    private val main = Handler(Looper.getMainLooper())
    private val keys = context.getSharedPreferences(KEYCHAIN, Context.MODE_PRIVATE)
    private val home = context.filesDir.canonicalFile

    @JavascriptInterface fun asset(name: String): String = context.assets.open(name).bufferedReader().use { it.readText() }
    @JavascriptInterface fun result(id: Int): String? = engine.take(id)
    @JavascriptInterface fun log(message: String) { Log.i(TAG, message) }

    // Files: only inside the app's own folder.
    private fun own(path: String): File {
        val f = File(path).canonicalFile
        require(f.path == home.path || f.path.startsWith(home.path + File.separator)) { "outside the app's files: $path" }
        return f
    }
    @JavascriptInterface fun filesDir(): String = home.path
    @JavascriptInterface fun exists(path: String): Boolean = own(path).exists()
    @JavascriptInterface fun mkdirs(path: String) { own(path).mkdirs() }
    @JavascriptInterface fun read(path: String): String? = own(path).takeIf { it.isFile }?.readText()
    @JavascriptInterface fun write(path: String, text: String) {
        val f = own(path)
        f.parentFile?.mkdirs()
        val part = File(f.path + ".part")
        part.writeText(text)
        if (!part.renameTo(f)) { f.writeText(text); part.delete() }
    }

    // The CWA key, kept in the app's private settings.
    @JavascriptInterface fun keyHas(key: String): Boolean = keys.contains(key)
    @JavascriptInterface fun keyGet(key: String): String? = keys.getString(key, null)
    @JavascriptInterface fun keySet(key: String, value: String) { keys.edit().putString(key, value).apply() }
    @JavascriptInterface fun keyRemove(key: String) { keys.edit().remove(key).apply() }

    /** GET url as text; an error status still answers with its body (CWA's errors are JSON), as in Scriptable. */
    @JavascriptInterface fun http(id: Int, url: String, timeoutMs: Int) = io.execute {
        try {
            val c = URL(url).openConnection() as HttpURLConnection
            c.connectTimeout = timeoutMs
            c.readTimeout = timeoutMs // without an answer for this long: given up, like Scriptable's timeoutInterval
            c.setRequestProperty("User-Agent", "TaiwanWeather-Android/${BuildConfig.VERSION_NAME}")
            val stream = if (c.responseCode in 200..299) c.inputStream else c.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            c.disconnect()
            engine.finish(id, true, body)
        } catch (e: SocketTimeoutException) {
            engine.finish(id, false, "The request timed out.")
        } catch (e: Exception) {
            engine.finish(id, false, masked(e.message ?: e.javaClass.simpleName))
        }
    }

    // An error can quote its URL, and CWA's URLs carry the key: the page and the logs show errors without it.
    private fun masked(message: String) = message.replace(Regex("Authorization=[^&\\s]*"), "Authorization=…")

    /** Where the phone is: a fix under 10 minutes old at once, else a new one (the script gives up after 6 s). */
    @JavascriptInterface fun location(id: Int) = main.post {
        val granted = listOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            .any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        if (!granted) return@post engine.finish(id, false, "Location access denied")
        val lm = context.getSystemService(LocationManager::class.java) ?: return@post engine.finish(id, false, "no location")
        val answer = { l: Location -> engine.finish(id, true, JSONObject().put("latitude", l.latitude).put("longitude", l.longitude).toString()) }
        try {
            val providers = lm.getProviders(true)
            val last = providers.mapNotNull { lm.getLastKnownLocation(it) }.maxByOrNull { it.time }
            if (last != null && System.currentTimeMillis() - last.time < 10 * 60_000) return@post answer(last)
            val provider = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER, "fused").firstOrNull { it in providers }
            if (provider == null) return@post if (last != null) answer(last) else engine.finish(id, false, "no location")
            if (Build.VERSION.SDK_INT >= 30) {
                lm.getCurrentLocation(provider, null, context.mainExecutor) { l ->
                    if (l != null) answer(l) else if (last != null) answer(last) else engine.finish(id, false, "no location")
                }
            } else {
                // every method written out: before Android 11 they have no defaults
                val listener = object : LocationListener {
                    override fun onLocationChanged(l: Location) = answer(l)
                    @Deprecated("Deprecated in Java")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                }
                @Suppress("DEPRECATION")
                lm.requestSingleUpdate(provider, listener, Looper.getMainLooper())
            }
        } catch (e: SecurityException) {
            engine.finish(id, false, "Location access denied")
        }
    }

    /** The places at a point, from Android's geocoder: the script looks for a county and a township among them. */
    @JavascriptInterface fun geocode(id: Int, latitude: Double, longitude: Double, locale: String) = io.execute {
        try {
            @Suppress("DEPRECATION")
            val found = Geocoder(context, Locale.forLanguageTag(locale.replace('_', '-'))).getFromLocation(latitude, longitude, 3)
            val list = JSONArray()
            for (a in found ?: emptyList()) {
                list.put(JSONObject().put("adminArea", a.adminArea).put("subAdminArea", a.subAdminArea).put("locality", a.locality)
                    .put("subLocality", a.subLocality).put("thoroughfare", a.thoroughfare).put("featureName", a.featureName))
            }
            engine.finish(id, true, list.toString())
        } catch (e: Exception) {
            engine.finish(id, false, e.message ?: "no geocoder")
        }
    }

    @JavascriptInterface fun notify(identifier: String, title: String, body: String) = Notifications.show(context, identifier, title, body)

    @JavascriptInterface fun alert(id: Int, spec: String) {
        val host = engine.host ?: return engine.finish(id, true, """{"button":-1,"values":[]}""")
        main.post { host.alert(JSONObject(spec)) { engine.finish(id, true, it.toString()) } }
    }

    // The page you see (one per screen).
    @JavascriptInterface fun viewCreate(): Int = 1
    @JavascriptInterface fun viewLoad(id: Int, html: String, baseUrl: String) {
        val host = engine.host ?: return engine.finish(id, false, "no screen")
        main.post { host.load(html, baseUrl) { engine.finish(id, true, null) } }
    }
    @JavascriptInterface fun viewEval(id: Int, js: String) {
        val host = engine.host ?: return engine.finish(id, false, "no screen")
        main.post { host.eval(js) { engine.finish(id, true, it ?: "null") } }
    }
    @JavascriptInterface fun viewPresent(id: Int) {
        val host = engine.host ?: return engine.finish(id, true, null)
        main.post { host.present { engine.finish(id, true, null) } }
    }

    @JavascriptInterface fun widget(place: String, json: String) = engine.widget(place, json)
    @JavascriptInterface fun failed(message: String) = engine.failed(message)
    @JavascriptInterface fun done() = engine.done()

    companion object {
        const val KEYCHAIN = "keychain"
    }
}
