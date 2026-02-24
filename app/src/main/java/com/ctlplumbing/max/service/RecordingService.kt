package com.ctlplumbing.max.service

import android.app.*
import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.os.*
import android.util.Log
import androidx.core.app.NotificationCompat
import com.ctlplumbing.max.MaxApplication
import com.ctlplumbing.max.MainActivity
import com.ctlplumbing.max.R
import com.ctlplumbing.max.data.models.RecordingSession
import com.ctlplumbing.max.data.models.SessionStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

class RecordingService : Service() {

    private var mediaRecorder: MediaRecorder? = null
    private var audioFile: File? = null
    private var startTime: Long = 0
    private var isRecording = false
    private val vibrator by lazy { getSystemService(Context.VIBRATOR_SERVICE) as Vibrator }

    private val handler = Handler(Looper.getMainLooper())
    private val durationUpdater = object : Runnable {
        override fun run() {
            if (isRecording) {
                val elapsed = ((System.currentTimeMillis() - startTime) / 1000).toInt()
                _currentDuration.value = elapsed
                handler.postDelayed(this, 1000)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder = LocalBinder()

    inner class LocalBinder : Binder() {
        fun getService(): RecordingService = this@RecordingService
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startRecording()
            ACTION_STOP -> stopRecording()
            ACTION_TOGGLE -> {
                if (isRecording) stopRecording() else startRecording()
            }
        }
        return START_STICKY
    }

    private fun startRecording() {
        if (isRecording) return

        try {
            // Create audio file
            val timestamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
            val audioDir = File(filesDir, "recordings").apply { mkdirs() }
            audioFile = File(audioDir, "max_walk_$timestamp.ogg")

            // Setup MediaRecorder
            mediaRecorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(this)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }.apply {
                setAudioSource(MediaRecorder.AudioSource.MIC)
                setOutputFormat(MediaRecorder.OutputFormat.OGG)
                setAudioEncoder(MediaRecorder.AudioEncoder.OPUS)
                setAudioEncodingBitRate(64000)
                setAudioSamplingRate(16000)
                setOutputFile(audioFile!!.absolutePath)
                prepare()
                start()
            }

            isRecording = true
            startTime = System.currentTimeMillis()
            _recordingState.value = true
            _currentDuration.value = 0

            // Create the session
            _currentSession.value = RecordingSession(
                audioFilePath = audioFile!!.absolutePath,
                recordedAt = startTime,
                status = SessionStatus.RECORDING,
            )

            // Start duration counter
            handler.post(durationUpdater)

            // Vibrate feedback
            vibrateShort()

            // Show foreground notification
            startForeground(NOTIFICATION_ID, buildRecordingNotification())

            Log.i(TAG, "Recording started: ${audioFile!!.name}")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to start recording", e)
            _recordingState.value = false
            stopSelf()
        }
    }

    fun stopRecording(): RecordingSession? {
        if (!isRecording) return null

        try {
            mediaRecorder?.apply {
                stop()
                release()
            }
            mediaRecorder = null
            isRecording = false

            handler.removeCallbacks(durationUpdater)

            val duration = ((System.currentTimeMillis() - startTime) / 1000).toInt()

            val session = _currentSession.value?.copy(
                status = SessionStatus.STOPPED,
                durationSecs = duration,
            )
            _currentSession.value = session
            _recordingState.value = false
            _currentDuration.value = 0

            // Vibrate feedback (double pulse for stop)
            vibrateLong()

            Log.i(TAG, "Recording stopped: ${duration}s, file: ${audioFile?.name}")

            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()

            return session
        } catch (e: Exception) {
            Log.e(TAG, "Failed to stop recording", e)
            _recordingState.value = false
            stopSelf()
            return null
        }
    }

    fun getElapsedSeconds(): Int {
        return if (isRecording) {
            ((System.currentTimeMillis() - startTime) / 1000).toInt()
        } else 0
    }

    fun isCurrentlyRecording(): Boolean = isRecording

    private fun vibrateShort() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(100, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(100)
        }
    }

    private fun vibrateLong() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 100, 100, 100), -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(longArrayOf(0, 100, 100, 100), -1)
        }
    }

    private fun buildRecordingNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val stopIntent = PendingIntent.getService(
            this, 1,
            Intent(this, RecordingService::class.java).apply { action = ACTION_STOP },
            PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, MaxApplication.CHANNEL_RECORDING)
            .setContentTitle("Max is recording")
            .setContentText("Tap to open • Recording job walk...")
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    override fun onDestroy() {
        if (isRecording) {
            stopRecording()
        }
        handler.removeCallbacks(durationUpdater)
        super.onDestroy()
    }

    companion object {
        private const val TAG = "MaxRecording"
        private const val NOTIFICATION_ID = 1001

        const val ACTION_START = "com.ctlplumbing.max.START_RECORDING"
        const val ACTION_STOP = "com.ctlplumbing.max.STOP_RECORDING"
        const val ACTION_TOGGLE = "com.ctlplumbing.max.TOGGLE_RECORDING"

        // Shared state observable by UI
        private val _recordingState = MutableStateFlow(false)
        val recordingState: StateFlow<Boolean> = _recordingState

        private val _currentDuration = MutableStateFlow(0)
        val currentDuration: StateFlow<Int> = _currentDuration

        private val _currentSession = MutableStateFlow<RecordingSession?>(null)
        val currentSession: StateFlow<RecordingSession?> = _currentSession

        fun start(context: Context) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = ACTION_START
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, RecordingService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }
}
