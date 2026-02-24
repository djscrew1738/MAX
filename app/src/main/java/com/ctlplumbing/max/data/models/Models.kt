package com.ctlplumbing.max.data.models

import com.google.gson.annotations.SerializedName

// --- Session / Recording ---

data class RecordingSession(
    val id: Long = 0,
    var jobId: Int? = null,
    var title: String = "",
    var phase: String? = null,
    var builderName: String? = null,
    var subdivision: String? = null,
    var lotNumber: String? = null,
    var audioFilePath: String = "",
    var status: SessionStatus = SessionStatus.RECORDING,
    var recordedAt: Long = System.currentTimeMillis(),
    var durationSecs: Int = 0,
    val attachments: MutableList<AttachmentInfo> = mutableListOf(),
    val roomMarkers: MutableList<RoomMarker> = mutableListOf(),
    val flags: MutableList<FlagMarker> = mutableListOf(),
)

enum class SessionStatus {
    RECORDING,
    STOPPED,
    QUEUED,
    UPLOADING,
    PROCESSING,
    COMPLETE,
    ERROR
}

data class AttachmentInfo(
    val filePath: String,
    val fileName: String,
    val fileType: String, // "pdf", "image"
    val addedAtSecs: Int = 0, // seconds into recording
)

data class RoomMarker(
    val name: String,
    val atSecs: Int,
)

data class FlagMarker(
    val atSecs: Int,
)

// --- API Responses ---

data class UploadResponse(
    val success: Boolean,
    @SerializedName("session_id") val sessionId: Int?,
    val status: String?,
    val message: String?,
    @SerializedName("estimated_time") val estimatedTime: String?,
    val error: String?,
)

data class UploadStatusResponse(
    @SerializedName("session_id") val sessionId: Int,
    val status: String,
    @SerializedName("has_transcript") val hasTranscript: Boolean,
    @SerializedName("has_summary") val hasSummary: Boolean,
    @SerializedName("duration_secs") val durationSecs: Int?,
    val error: String?,
    @SerializedName("created_at") val createdAt: String?,
    @SerializedName("processed_at") val processedAt: String?,
)

data class AttachmentResponse(
    val success: Boolean,
    @SerializedName("attachment_id") val attachmentId: Int?,
    @SerializedName("file_type") val fileType: String?,
    @SerializedName("file_name") val fileName: String?,
    val message: String?,
)

data class ErrorResponse(
    val error: String?,
    @SerializedName("allowedTypes") val allowedTypes: List<String>?,
    @SerializedName("maxSize") val maxSize: Long?,
    @SerializedName("allowedPhases") val allowedPhases: List<String>?,
)

data class ChatRequest(
    val message: String,
    @SerializedName("job_id") val jobId: Int? = null,
    val history: List<ChatMessage> = emptyList(),
)

data class ChatResponse(
    val reply: String,
    val sources: List<ChatSource> = emptyList(),
    val error: String? = null,
)

data class ChatMessage(
    val role: String, // "user" or "assistant"
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
)

data class ChatSource(
    @SerializedName("session_id") val sessionId: Int?,
    val builder: String?,
    val subdivision: String?,
    val lot: String?,
    val date: String?,
    val type: String?,
    val similarity: Float?,
)

// --- Jobs ---

data class Job(
    val id: Int,
    @SerializedName("builder_name") val builderName: String?,
    val subdivision: String?,
    @SerializedName("lot_number") val lotNumber: String?,
    val address: String?,
    val phase: String?,
    val status: String?,
    @SerializedName("fixture_count") val fixtureCount: Int?,
    @SerializedName("session_count") val sessionCount: Int?,
    @SerializedName("attachment_count") val attachmentCount: Int?,
    @SerializedName("open_items") val openItems: Int?,
    @SerializedName("job_intel") val jobIntel: String?,
    @SerializedName("created_at") val createdAt: String?,
    @SerializedName("updated_at") val updatedAt: String?,
)

data class JobDetail(
    val id: Int,
    @SerializedName("builder_name") val builderName: String?,
    val subdivision: String?,
    @SerializedName("lot_number") val lotNumber: String?,
    val address: String?,
    val phase: String?,
    val status: String?,
    val notes: String?,
    @SerializedName("job_intel") val jobIntel: String?,
    val sessions: List<SessionSummary>?,
    val attachments: List<AttachmentDetail>?,
    @SerializedName("action_items") val actionItems: List<ActionItem>?,
    @SerializedName("created_at") val createdAt: String?,
    @SerializedName("updated_at") val updatedAt: String?,
)

data class SessionSummary(
    val id: Int,
    val title: String?,
    val phase: String?,
    val status: String?,
    @SerializedName("duration_secs") val durationSecs: Int?,
    @SerializedName("has_transcript") val hasTranscript: Boolean?,
    @SerializedName("has_summary") val hasSummary: Boolean?,
    @SerializedName("recorded_at") val recordedAt: String?,
)

data class ActionItem(
    val id: Int,
    val description: String,
    val priority: String,
    val completed: Boolean,
    @SerializedName("due_date") val dueDate: String?,
)

data class SessionDetail(
    val id: Int,
    val title: String?,
    val phase: String?,
    val transcript: String?,
    val summary: String?,
    @SerializedName("summary_json") val summaryJson: Map<String, Any>?,
    val status: String?,
    @SerializedName("recorded_at") val recordedAt: String?,
    @SerializedName("duration_secs") val durationSecs: Int?,
    @SerializedName("builder_name") val builderName: String?,
    val subdivision: String?,
    @SerializedName("lot_number") val lotNumber: String?,
    val attachments: List<AttachmentDetail>?,
    @SerializedName("action_items") val actionItems: List<ActionItem>?,
)

data class AttachmentDetail(
    val id: Int,
    @SerializedName("file_type") val fileType: String?,
    @SerializedName("file_name") val fileName: String?,
)

// --- Notifications ---

data class Notification(
    val id: Int,
    val type: String, // session_complete, discrepancy, error, info
    val title: String,
    val body: String,
    val data: Map<String, Any>?,
    val read: Boolean,
    @SerializedName("created_at") val createdAt: String?,
)

data class NotificationCounts(
    val total: Int,
    val unread: Int,
    val sessions: Int,
    val discrepancies: Int,
    val errors: Int,
)

// --- Voice Commands ---

sealed class MaxCommand {
    data object StartRecording : MaxCommand()
    data object StopRecording : MaxCommand()
    data class AttachPlans(val timestamp: Int) : MaxCommand()
    data class TakePhoto(val timestamp: Int) : MaxCommand()
    data class NewRoom(val roomName: String, val timestamp: Int) : MaxCommand()
    data class FlagMoment(val timestamp: Int) : MaxCommand()
    data class TagJob(val rawTag: String, val timestamp: Int) : MaxCommand()
    data object Unknown : MaxCommand()
}

// --- Server Status ---

data class ServerStatus(
    val status: String,
    val version: String?,
    @SerializedName("response_time") val responseTime: Long?,
    @SerializedName("total_sessions") val totalSessions: Int?,
    @SerializedName("completed_sessions") val completedSessions: Int?,
    @SerializedName("processing_sessions") val processingSessions: Int?,
    @SerializedName("error_sessions") val errorSessions: Int?,
    @SerializedName("total_jobs") val totalJobs: Int?,
    @SerializedName("total_chunks") val totalChunks: Int?,
    @SerializedName("open_actions") val openActions: Int?,
    @SerializedName("total_attachments") val totalAttachments: Int?,
    @SerializedName("unread_notifications") val unreadNotifications: Int?,
    val tailscale: TailscaleInfo?,
)

data class TailscaleInfo(
    val ip: String,
    val port: Int,
)

// --- Upload Queue (for offline support) ---

data class QueuedUpload(
    val id: Long = 0,
    val filePath: String,
    val fileName: String,
    val uploadType: UploadType,
    val jobId: Int?,
    val sessionId: Int?,
    val metadata: Map<String, String>?,
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0,
    val status: QueueStatus = QueueStatus.PENDING,
)

enum class UploadType {
    AUDIO,
    ATTACHMENT
}

enum class QueueStatus {
    PENDING,
    UPLOADING,
    COMPLETED,
    FAILED,
    RETRYING
}
