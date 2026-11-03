package com.fuyo1622.taiwanweather

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * New forecasts for the widgets (and My Location's rain and warning notifications): every 15 minutes, Android's
 * shortest, while online, and at once when a widget is added. Without the app open, My Location is the last place
 * the app saw (Android shares the phone's location with apps in the background only with an extra permission).
 */
object Refresh {
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun schedule(context: Context) = WorkManager.getInstance(context).enqueueUniquePeriodicWork("refresh",
        ExistingPeriodicWorkPolicy.KEEP, PeriodicWorkRequestBuilder<RefreshWorker>(15, TimeUnit.MINUTES).setConstraints(online).build())

    fun now(context: Context) = WorkManager.getInstance(context).enqueueUniqueWork("refresh-now",
        ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(online).build())
}

class RefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val places = Widgets.places(applicationContext)
        val finished = CountDownLatch(1)
        val main = Handler(Looper.getMainLooper())
        var engine: Engine? = null
        main.post {
            engine = Engine(applicationContext, null,
                onWidget = { place, json ->
                    Widgets.store(applicationContext, place, json)
                    Log.i(TAG, "widget data for '${place.ifEmpty { "My Location" }}': $json")
                },
                onDone = { finished.countDown() })
            engine?.start("widget", JSONObject().put("places", JSONArray(places)))
        }
        val inTime = finished.await(3, TimeUnit.MINUTES)
        main.post { engine?.destroy() }
        Widgets.renderAll(applicationContext)
        Log.i(TAG, "widgets refreshed (${places.size} place(s))" + if (inTime) "" else ", stopped waiting")
        return Result.success()
    }
}
