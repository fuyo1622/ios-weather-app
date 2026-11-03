package com.fuyo1622.taiwanweather

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

/** Home-screen widgets in three sizes; each shows My Location or a saved place (WidgetConfigActivity). */
abstract class WeatherWidget(private val size: String) : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        for (id in ids) Widgets.render(context, manager, id, size)
        Refresh.schedule(context)
        Refresh.now(context)
    }

    override fun onDeleted(context: Context, ids: IntArray) = Widgets.forget(context, ids)
}

class SmallWidget : WeatherWidget("small")
class MediumWidget : WeatherWidget("medium")
class LargeWidget : WeatherWidget("large")

object Widgets {
    private const val PLACES = "widget-places" // widget id → the saved place it shows ("" = My Location)
    private const val DATA = "widget-data"     // place → what the script last said for it (shim.js widgetData)
    private val sizes = listOf("small" to SmallWidget::class.java, "medium" to MediumWidget::class.java, "large" to LargeWidget::class.java)

    fun placeOf(context: Context, id: Int): String = context.getSharedPreferences(PLACES, Context.MODE_PRIVATE).getString("$id", "") ?: ""

    fun pin(context: Context, id: Int, place: String) =
        context.getSharedPreferences(PLACES, Context.MODE_PRIVATE).edit().putString("$id", place).apply()

    fun forget(context: Context, ids: IntArray) {
        val e = context.getSharedPreferences(PLACES, Context.MODE_PRIVATE).edit()
        for (id in ids) e.remove("$id")
        e.apply()
    }

    /** Every place a widget shows, My Location always included (its forecast also sends the notifications). */
    fun places(context: Context): List<String> {
        val manager = AppWidgetManager.getInstance(context)
        val shown = sizes.flatMap { (_, c) -> manager.getAppWidgetIds(ComponentName(context, c)).map { placeOf(context, it) } }
        return (listOf("") + shown).distinct()
    }

    fun store(context: Context, place: String, json: String) =
        context.getSharedPreferences(DATA, Context.MODE_PRIVATE).edit().putString(place, json).apply()

    fun renderAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        for ((size, c) in sizes) for (id in manager.getAppWidgetIds(ComponentName(context, c))) render(context, manager, id, size)
    }

    fun render(context: Context, manager: AppWidgetManager, id: Int, size: String) =
        manager.updateAppWidget(id, views(context, size, placeOf(context, id), id))

    /** The widget's views for [size] from the last forecast for [place]. */
    fun views(context: Context, size: String, place: String, id: Int): RemoteViews {
        val layout = when (size) { "small" -> R.layout.widget_small; "medium" -> R.layout.widget_medium; else -> R.layout.widget_large }
        val v = RemoteViews(context.packageName, layout)
        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (place.isNotEmpty()) open.putExtra(MainActivity.EXTRA_PLACE, place)
        v.setOnClickPendingIntent(R.id.root, PendingIntent.getActivity(context, id, open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        val raw = context.getSharedPreferences(DATA, Context.MODE_PRIVATE).getString(place, null)
        val d = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (d == null || d.has("error")) {
            v.setTextViewText(R.id.place, place.ifEmpty { context.getString(R.string.my_location) })
            v.setTextViewText(R.id.temp, "–")
            v.setTextViewText(R.id.rain, d?.optString("error") ?: context.getString(R.string.loading))
            return v
        }
        v.setTextViewText(R.id.place, d.optString("place"))
        v.setTextViewText(R.id.temp, d.optString("temp"))
        v.setTextViewText(R.id.icon, d.optString("icon"))
        v.setTextViewText(R.id.rain, d.optString("rain"))
        v.setTextViewText(R.id.bottom, d.optString(if (size == "small") "bottomSmall" else "bottom"))
        v.setTextColor(R.id.bottom, if (d.optBoolean("warn")) 0xFFFFD166.toInt() else 0xA6FFFFFF.toInt()) // warnings in amber
        if (size == "small") {
            v.setTextViewText(R.id.condition, d.optString("condition"))
            v.setTextViewText(R.id.hilo, d.optString("hiLo"))
        } else {
            v.setTextViewText(R.id.condition, listOf(d.optString("condition"), d.optString("hiLo")).filter { it.isNotEmpty() }.joinToString("  "))
            hours(context, v, R.id.hours, if (size == "medium") d.optJSONArray("hours8") else d.optJSONArray("hours24")?.let { first(it, 12) })
            if (size == "large") {
                hours(context, v, R.id.hours2, d.optJSONArray("hours24")?.let { first(it, 24, from = 12) })
                v.setTextViewText(R.id.tomorrow, d.optString("tomorrow"))
                v.setViewVisibility(R.id.tomorrow, if (d.optString("tomorrow").isEmpty()) View.GONE else View.VISIBLE)
            }
        }
        return v
    }

    private fun first(list: JSONArray, end: Int, from: Int = 0) = JSONArray().also { out ->
        for (i in from until minOf(end, list.length())) out.put(list.get(i))
    }

    // One column per hour: the hour, its weather, temperature and chance of rain.
    private fun hours(context: Context, v: RemoteViews, row: Int, list: JSONArray?) {
        v.removeAllViews(row)
        for (i in 0 until (list?.length() ?: 0)) {
            val h = list!!.getJSONObject(i)
            val col = RemoteViews(context.packageName, R.layout.widget_hour)
            col.setTextViewText(R.id.hour, h.optString("h"))
            col.setTextViewText(R.id.hour_icon, h.optString("icon"))
            col.setTextViewText(R.id.hour_temp, h.optString("t"))
            col.setTextViewText(R.id.hour_pop, h.optString("pop"))
            v.addView(row, col)
        }
    }
}
