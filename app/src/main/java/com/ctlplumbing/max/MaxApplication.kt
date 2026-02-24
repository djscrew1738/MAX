package com.ctlplumbing.max

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.ctlplumbing.max.data.api.MaxApiClient
import com.ctlplumbing.max.data.repository.SettingsRepository

class MaxApplication : Application() {

    lateinit var apiClient: MaxApiClient
        private set
    lateinit var settings: SettingsRepository
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        settings = SettingsRepository(this)
        apiClient = MaxApiClient(settings)

        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(NotificationManager::class.java)

            // Recording channel
            val recordingChannel = NotificationChannel(
                CHANNEL_RECORDING,
                "Recording",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows when Max is recording a job walk"
                setShowBadge(false)
            }
            manager.createNotificationChannel(recordingChannel)

            // Processing channel
            val processingChannel = NotificationChannel(
                CHANNEL_PROCESSING,
                "Processing",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notifications about upload and processing status"
            }
            manager.createNotificationChannel(processingChannel)

            // Wake word channel
            val wakeWordChannel = NotificationChannel(
                CHANNEL_WAKE_WORD,
                "Listening",
                NotificationManager.IMPORTANCE_MIN
            ).apply {
                description = "Shows when Max is listening for wake word"
                setShowBadge(false)
            }
            manager.createNotificationChannel(wakeWordChannel)
        }
    }

    companion object {
        lateinit var instance: MaxApplication
            private set

        const val CHANNEL_RECORDING = "max_recording"
        const val CHANNEL_PROCESSING = "max_processing"
        const val CHANNEL_WAKE_WORD = "max_wake_word"
    }
}
