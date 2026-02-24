package com.ctlplumbing.max.service

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import com.ctlplumbing.max.MaxApplication
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

data class ServerNotification(
    val id: Int,
    val type: String,
    val title: String,
    val body: String?,
    val data: Map<String, Any>?,
    val read: Boolean,
    val created_at: String,
)

/**
 * Polls the Max server for notifications and shows them as Android notifications
 */
class NotificationPoller(private val context: Context) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val gson = Gson()
    private val settings = MaxApplication.instance.settings

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private var pollingJob: Job? = null

    private val _unreadCount = MutableStateFlow(0)
    val unreadCount: StateFlow<Int> = _unreadCount

    private val _notifications = MutableStateFlow<List<ServerNotification>>(emptyList())
    val notifications: StateFlow<List<ServerNotification>> = _notifications

    /**
     * Start polling for notifications
     */
    fun startPolling(intervalMs: Long = 15_000L) {
        pollingJob?.cancel()
        pollingJob = scope.launch {
            while (isActive) {
                try {
                    poll()
                } catch (e: Exception) {
                    // Silently fail - we'll retry next interval
                }
                delay(intervalMs)
            }
        }
    }

    /**
     * Stop polling
     */
    fun stopPolling() {
        pollingJob?.cancel()
        pollingJob = null
    }

    /**
     * Single poll for notifications
     */
    private suspend fun poll() {
        val baseUrl = settings.getServerUrlSync().trimEnd('/')
        val apiKey = settings.getApiKeySync()

        val request = Request.Builder()
            .url("$baseUrl/api/notifications")
            .header("x-api-key", apiKey)
            .get()
            .build()

        val response = client.newCall(request).execute()
        if (!response.isSuccessful) return

        val body = response.body?.string() ?: return
        val type = object : TypeToken<List<ServerNotification>>() {}.type
        val serverNotifs: List<ServerNotification> = gson.fromJson(body, type)

        _notifications.value = serverNotifs
        _unreadCount.value = serverNotifs.size

        // Show Android notifications for new items
        for (notif in serverNotifs) {
            showAndroidNotification(notif)
        }

        // Mark as read on server
        if (serverNotifs.isNotEmpty()) {
            val ids = serverNotifs.map { it.id }
            markRead(ids)
        }
    }

    /**
     * Show an Android notification
     */
    private fun showAndroidNotification(notif: ServerNotification) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val channelId = when (notif.type) {
            "error" -> MaxApplication.CHANNEL_PROCESSING
            "discrepancy" -> MaxApplication.CHANNEL_PROCESSING
            else -> MaxApplication.CHANNEL_PROCESSING
        }

        val notification = NotificationCompat.Builder(context, channelId)
            .setContentTitle(notif.title)
            .setContentText(notif.body)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .setPriority(
                if (notif.type == "discrepancy" || notif.type == "error")
                    NotificationCompat.PRIORITY_HIGH
                else NotificationCompat.PRIORITY_DEFAULT
            )
            .build()

        manager.notify(notif.id, notification)
    }

    /**
     * Mark notifications as read on server
     */
    private suspend fun markRead(ids: List<Int>) {
        try {
            val baseUrl = settings.getServerUrlSync().trimEnd('/')
            val apiKey = settings.getApiKeySync()

            val jsonBody = gson.toJson(mapOf("ids" to ids))
            val requestBody = okhttp3.RequestBody.create(
                okhttp3.MediaType.parse("application/json"),
                jsonBody
            )

            val request = Request.Builder()
                .url("$baseUrl/api/notifications/read")
                .header("x-api-key", apiKey)
                .post(requestBody)
                .build()

            client.newCall(request).execute()
        } catch (_: Exception) {}
    }
}
