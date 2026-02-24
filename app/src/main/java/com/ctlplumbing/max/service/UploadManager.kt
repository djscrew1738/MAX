package com.ctlplumbing.max.service

import android.content.Context
import android.util.Log
import com.ctlplumbing.max.MaxApplication
import com.ctlplumbing.max.data.models.AttachmentInfo
import com.ctlplumbing.max.data.models.RecordingSession
import com.ctlplumbing.max.data.models.SessionStatus
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File
import java.text.SimpleDateFormat
import java.util.*

/**
 * Manages the upload queue for recordings and attachments.
 * Handles offline queuing and retry logic.
 */
class UploadManager(private val context: Context) {

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val apiClient = MaxApplication.instance.apiClient

    private val _uploadQueue = MutableStateFlow<List<QueuedUpload>>(emptyList())
    val uploadQueue: StateFlow<List<QueuedUpload>> = _uploadQueue

    private val _isUploading = MutableStateFlow(false)
    val isUploading: StateFlow<Boolean> = _isUploading

    data class QueuedUpload(
        val id: String = UUID.randomUUID().toString(),
        val session: RecordingSession,
        val status: UploadStatus = UploadStatus.QUEUED,
        val serverSessionId: Int? = null,
        val error: String? = null,
        val retryCount: Int = 0,
    )

    enum class UploadStatus {
        QUEUED, UPLOADING_AUDIO, UPLOADING_ATTACHMENTS, COMPLETE, ERROR
    }

    /**
     * Queue a completed recording session for upload
     */
    fun queueSession(session: RecordingSession) {
        val queued = QueuedUpload(session = session)
        _uploadQueue.value = _uploadQueue.value + queued
        Log.i(TAG, "Queued session for upload: ${session.audioFilePath}")
        processQueue()
    }

    /**
     * Process the upload queue
     */
    private fun processQueue() {
        if (_isUploading.value) return

        scope.launch {
            _isUploading.value = true

            val queue = _uploadQueue.value.toMutableList()
            
            for (i in queue.indices) {
                val item = queue[i]
                if (item.status != UploadStatus.QUEUED && item.status != UploadStatus.ERROR) continue
                if (item.retryCount >= MAX_RETRIES) continue

                // Update status
                queue[i] = item.copy(status = UploadStatus.UPLOADING_AUDIO)
                _uploadQueue.value = queue.toList()

                try {
                    // 1. Upload audio
                    val audioFile = File(item.session.audioFilePath)
                    if (!audioFile.exists()) {
                        queue[i] = item.copy(status = UploadStatus.ERROR, error = "Audio file not found")
                        continue
                    }

                    val isoDate = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                        .format(Date(item.session.recordedAt))

                    val uploadResult = apiClient.uploadAudio(
                        audioFile = audioFile,
                        jobId = item.session.jobId,
                        title = item.session.title.ifBlank { "Job Walk ${Date()}" },
                        phase = item.session.phase,
                        recordedAt = isoDate,
                    )

                    if (uploadResult.isFailure) {
                        throw uploadResult.exceptionOrNull() ?: Exception("Upload failed")
                    }

                    val response = uploadResult.getOrThrow()
                    val serverSessionId = response.sessionId

                    Log.i(TAG, "Audio uploaded → server session #$serverSessionId")

                    // 2. Upload attachments
                    if (item.session.attachments.isNotEmpty() && serverSessionId != null) {
                        queue[i] = item.copy(status = UploadStatus.UPLOADING_ATTACHMENTS)
                        _uploadQueue.value = queue.toList()

                        for (attachment in item.session.attachments) {
                            val attachFile = File(attachment.filePath)
                            if (attachFile.exists()) {
                                apiClient.uploadAttachment(
                                    file = attachFile,
                                    sessionId = serverSessionId,
                                    jobId = item.session.jobId,
                                )
                                Log.i(TAG, "Attachment uploaded: ${attachment.fileName}")
                            }
                        }
                    }

                    // Success
                    queue[i] = item.copy(
                        status = UploadStatus.COMPLETE,
                        serverSessionId = serverSessionId,
                    )
                    Log.i(TAG, "Session upload complete!")

                } catch (e: Exception) {
                    Log.e(TAG, "Upload failed", e)
                    queue[i] = item.copy(
                        status = UploadStatus.ERROR,
                        error = e.message,
                        retryCount = item.retryCount + 1,
                    )
                }

                _uploadQueue.value = queue.toList()
            }

            _isUploading.value = false

            // Schedule retry for failed items
            val hasRetryable = queue.any { 
                it.status == UploadStatus.ERROR && it.retryCount < MAX_RETRIES 
            }
            if (hasRetryable) {
                delay(RETRY_DELAY_MS)
                processQueue()
            }
        }
    }

    /**
     * Retry all failed uploads
     */
    fun retryFailed() {
        _uploadQueue.value = _uploadQueue.value.map { item ->
            if (item.status == UploadStatus.ERROR) {
                item.copy(status = UploadStatus.QUEUED)
            } else item
        }
        processQueue()
    }

    /**
     * Clear completed uploads from queue
     */
    fun clearCompleted() {
        _uploadQueue.value = _uploadQueue.value.filter { it.status != UploadStatus.COMPLETE }
    }

    companion object {
        private const val TAG = "MaxUpload"
        private const val MAX_RETRIES = 5
        private const val RETRY_DELAY_MS = 30_000L // 30 seconds
    }
}
