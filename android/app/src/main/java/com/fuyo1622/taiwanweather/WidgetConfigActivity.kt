package com.fuyo1622.taiwanweather

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.ListView
import org.json.JSONObject
import java.io.File

/**
 * Which place a new widget shows (as the iPhone widget's Parameter field): My Location, or one of the places saved
 * in the full view. Optional from Android 12 on; a widget can be set again later by holding it.
 */
class WidgetConfigActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val id = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()
        title = getString(R.string.choose_place)
        val places = listOf("") + savedPlaces()
        val list = ListView(this)
        list.adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, places.map { it.ifEmpty { getString(R.string.my_location) } })
        list.setOnItemClickListener { _, _, position, _ ->
            Widgets.pin(this, id, places[position])
            val manager = AppWidgetManager.getInstance(this)
            val size = when (manager.getAppWidgetInfo(id)?.provider?.className) {
                SmallWidget::class.java.name -> "small"
                MediumWidget::class.java.name -> "medium"
                else -> "large"
            }
            Widgets.render(this, manager, id, size)
            Refresh.now(this)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id))
            finish()
        }
        setContentView(list)
    }

    // The places saved in the full view (TaiwanWeather.js keeps them in settings.json), e.g. "臺南市東區".
    private fun savedPlaces(): List<String> = runCatching {
        val settings = JSONObject(File(filesDir, "taiwan-weather/settings.json").readText())
        val list = settings.optJSONArray("places") ?: return@runCatching emptyList<String>()
        (0 until list.length()).map { list.getJSONObject(it).let { p -> p.optString("county") + p.optString("name") } }
    }.getOrDefault(emptyList())
}
