package com.fuyo1622.taiwanweather

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView

/** Test builds only: the three widgets for My Location, drawn from their last data, on one screen to photograph. */
class WidgetPreviewActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dp = resources.displayMetrics.density
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding((16 * dp).toInt(), (40 * dp).toInt(), (16 * dp).toInt(), (16 * dp).toInt())
            setBackgroundColor(Color.parseColor("#3a4a5e"))
        }
        for ((size, w, h) in listOf(Triple("small", 170, 170), Triple("medium", 360, 170), Triple("large", 360, 380))) {
            val slot = FrameLayout(this)
            slot.addView(Widgets.views(this, size, "", 0).apply(this, slot))
            column.addView(slot, LinearLayout.LayoutParams((w * dp).toInt(), (h * dp).toInt()).apply { bottomMargin = (16 * dp).toInt() })
        }
        setContentView(ScrollView(this).apply { addView(column) })
    }
}
