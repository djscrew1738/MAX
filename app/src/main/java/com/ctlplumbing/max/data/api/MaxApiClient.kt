package com.ctlplumbing.max.data.api

import com.ctlplumbing.max.data.models.*
import com.ctlplumbing.max.data.repository.SettingsRepository
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

class MaxApiClient(private val settings: SettingsRepository) {

    private val gson = Gson()
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Connection state
    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    // HTTP Client with logging in debug mode
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(120, TimeUnit.SECONDS)
            .writeTimeout(120, TimeUnit.SECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .addInterceptor { chain ->
                // Add API key to all requests
                val request = chain.request().newBuilder()
                    .header("x-api-key", apiKey())
                    .build()
                chain.proceed(request)
            }
            .addInterceptor(HttpLoggingInterceptor().apply {
                level = if (BuildConfig.DEBUG) 
                    HttpLoggingInterceptor.Level.BODY 
                else 
                    HttpLoggingInterceptor.Level.BASIC
            })
            .retryOnConnectionFailure(true)
            .build()
    }

    // WebSocket client
    private var webSocket: WebSocket? = null
    private val _webSocketMessages = MutableStateFlow<WebSocketMessage?>(null)
    val webSocketMessages: StateFlow<WebSocketMessage?> = _webSocketMessages

    private fun baseUrl(): String = settings.getServerUrlSync().trimEnd('/')
    private fun apiKey(): String = settings.getApiKeySync()
    private fun wsUrl(): String = settings.getWsUrlSync()

    // ============ CONNECTION MANAGEMENT ============

    sealed class ConnectionState {
        object Disconnected : ConnectionState()
        object Connecting : ConnectionState()
        data class Connected(val clientId: String?) : ConnectionState()
        data class Error(val message: String) : ConnectionState()
    }

    sealed class WebSocketMessage {
        data class Connected(val clientId: String) : WebSocketMessage()
        data class Notification(val notification: com.ctlplumbing.max.data.models.Notification) : WebSocketMessage()
        data class SessionComplete(val sessionId: Int, val summary: SessionSummary?) : WebSocketMessage()
        data class DiscrepancyAlert(val sessionId: Int, val count: Int) : WebSocketMessage()
        data class Error(val error: String) : WebSocketMessage()
    }

    data class SessionSummary(
        val builder_name: String?,
        val subdivision: String?,
        val lot_number: String?,
        val action_items: Int,
        val flags: Int
    )

    fun connectWebSocket() {
        if (webSocket != null) return

        _connectionState.value = ConnectionState.Connecting

        val request = Request.Builder()
            .url(wsUrl())
            .build()

        val listener = object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                _connectionState.value = ConnectionState.Connected(null)
                // Send ping to verify connection
                ws.send(gson.toJson(mapOf("type" to "ping")))
            }

            override fun onMessage(ws: WebSocket, text: String) {
                handleWebSocketMessage(text)
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                ws.close(1000, null)
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                webSocket = null
                _connectionState.value = ConnectionState.Disconnected
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                webSocket = null
                _connectionState.value = ConnectionState.Error(t.message ?: "Connection failed")
            }
        }

        webSocket = client.newWebSocket(request, listener)
    }

    fun disconnectWebSocket() {
        webSocket?.close(1000, "Client disconnecting")
        webSocket = null
        _connectionState.value = ConnectionState.Disconnected
    }

    private fun handleWebSocketMessage(text: String) {
        try {
            val json = gson.fromJson(text, Map::class.java)
            val type = json["type"] as? String ?: return

            when (type) {
                "connected" -> {
                    val clientId = json["clientId"] as? String
                    _connectionState.value = ConnectionState.Connected(clientId)
                    _webSocketMessages.value = WebSocketMessage.Connected(clientId ?: "")
                }
                "notification" -> {
                    val notificationJson = gson.toJson(json["notification"])
                    val notification = gson.fromJson(notificationJson, Notification::class.java)
                    _webSocketMessages.value = WebSocketMessage.Notification(notification)
                }
                "session_complete" -> {
                    val sessionId = (json["sessionId"] as? Double)?.toInt() ?: 0
                    val summaryJson = gson.toJson(json["summary"])
                    val summary = gson.fromJson(summaryJson, SessionSummary::class.java)
                    _webSocketMessages.value = WebSocketMessage.SessionComplete(sessionId, summary)
                }
                "discrepancies" -> {
                    val sessionId = (json["sessionId"] as? Double)?.toInt() ?: 0
                    val count = (json["discrepancies"] as? Map<*, *>)?.get("count") as? Double ?: 0.0
                    _webSocketMessages.value = WebSocketMessage.DiscrepancyAlert(sessionId, count.toInt())
                }
                "error" -> {
                    val error = json["message"] as? String ?: "Unknown error"
                    _webSocketMessages.value = WebSocketMessage.Error(error)
                }
            }
        } catch (e: Exception) {
            // Ignore parsing errors
        }
    }

    fun subscribeToJobs(jobIds: List<Int>) {
        val message = gson.toJson(mapOf(
            "type" to "subscribe",
            "jobIds" to jobIds
        ))
        webSocket?.send(message)
    }

    // ============ UPLOAD ============

    suspend fun uploadAudio(
        audioFile: File,
        jobId: Int? = null,
        title: String? = null,
        phase: String? = null,
        recordedAt: String? = null,
        onProgress: ((Int) -> Unit)? = null
    ): Result<UploadResponse> = withContext(Dispatchers.IO) {
        try {
            val builder = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "audio",
                    audioFile.name,
                    audioFile.asRequestBody("audio/ogg".toMediaType())
                )

            jobId?.let { builder.addFormDataPart("job_id", it.toString()) }
            title?.let { builder.addFormDataPart("title", it) }
            phase?.let { builder.addFormDataPart("phase", it) }
            recordedAt?.let { builder.addFormDataPart("recorded_at", it) }

            val request = Request.Builder()
                .url("${baseUrl()}/api/upload/audio")
                .post(builder.build())
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"
            
            if (response.isSuccessful) {
                Result.success(gson.fromJson(body, UploadResponse::class.java))
            } else {
                val error = gson.fromJson(body, ErrorResponse::class.java)
                Result.failure(IOException(error?.error ?: "Upload failed (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun uploadAttachment(
        file: File,
        sessionId: Int? = null,
        jobId: Int? = null,
    ): Result<AttachmentResponse> = withContext(Dispatchers.IO) {
        try {
            val mimeType = when (file.extension.lowercase()) {
                "pdf" -> "application/pdf"
                "jpg", "jpeg" -> "image/jpeg"
                "png" -> "image/png"
                "webp" -> "image/webp"
                else -> "application/octet-stream"
            }

            val builder = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", file.name, file.asRequestBody(mimeType.toMediaType()))

            sessionId?.let { builder.addFormDataPart("session_id", it.toString()) }
            jobId?.let { builder.addFormDataPart("job_id", it.toString()) }

            val request = Request.Builder()
                .url("${baseUrl()}/api/upload/attachment")
                .post(builder.build())
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                Result.success(gson.fromJson(body, AttachmentResponse::class.java))
            } else {
                val error = gson.fromJson(body, ErrorResponse::class.java)
                Result.failure(IOException(error?.error ?: "Upload failed (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getUploadStatus(sessionId: Int): Result<UploadStatusResponse> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/api/upload/status/$sessionId")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                Result.success(gson.fromJson(body, UploadStatusResponse::class.java))
            } else {
                Result.failure(IOException("Failed to get status (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ============ CHAT ============

    suspend fun chat(
        message: String,
        jobId: Int? = null,
        history: List<ChatMessage> = emptyList(),
    ): Result<ChatResponse> = withContext(Dispatchers.IO) {
        try {
            val chatRequest = ChatRequest(message, jobId, history)
            val jsonBody = gson.toJson(chatRequest)
                .toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url("${baseUrl()}/api/chat")
                .post(jsonBody)
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                Result.success(gson.fromJson(body, ChatResponse::class.java))
            } else {
                val error = gson.fromJson(body, ErrorResponse::class.java)
                Result.failure(IOException(error?.error ?: "Chat failed (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ============ JOBS ============

    suspend fun getJobs(limit: Int = 20, offset: Int = 0): Result<PaginatedResponse<Job>> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/api/jobs?limit=$limit&offset=$offset")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                val type = object : TypeToken<PaginatedResponse<Job>>() {}.type
                Result.success(gson.fromJson(body, type))
            } else {
                Result.failure(IOException("Failed to get jobs (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getJob(jobId: Int): Result<JobDetail> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/api/jobs/$jobId")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                Result.success(gson.fromJson(body, JobDetail::class.java))
            } else {
                Result.failure(IOException("Failed to get job (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getJobIntel(jobId: Int, refresh: Boolean = false): Result<String?> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/api/jobs/$jobId/intel?refresh=$refresh")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                val json = gson.fromJson(body, Map::class.java)
                val intel = json["intel"] as? String
                Result.success(intel)
            } else {
                Result.failure(IOException("Failed to get intel (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getSession(sessionId: Int): Result<SessionDetail> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/api/jobs/sessions/$sessionId")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                Result.success(gson.fromJson(body, SessionDetail::class.java))
            } else {
                Result.failure(IOException("Failed to get session (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun toggleActionItem(actionId: Int, completed: Boolean): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val body = gson.toJson(mapOf("completed" to completed))
                .toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url("${baseUrl()}/api/jobs/actions/$actionId")
                .patch(body)
                .build()

            val response = client.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ============ NOTIFICATIONS ============

    suspend fun getNotifications(): Result<List<Notification>> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/api/notifications")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "[]"

            if (response.isSuccessful) {
                val type = object : TypeToken<List<Notification>>() {}.type
                Result.success(gson.fromJson(body, type))
            } else {
                Result.failure(IOException("Failed to get notifications (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun markNotificationsRead(ids: List<Int>): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val body = gson.toJson(mapOf("ids" to ids))
                .toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url("${baseUrl()}/api/notifications/read")
                .post(body)
                .build()

            val response = client.newCall(request).execute()
            Result.success(response.isSuccessful)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    // ============ SERVER STATUS ============

    suspend fun getStatus(): Result<ServerStatus> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/status")
                .get()
                .build()

            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: "{}"

            if (response.isSuccessful) {
                Result.success(gson.fromJson(body, ServerStatus::class.java))
            } else {
                Result.failure(IOException("Status check failed (${response.code})"))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun healthCheck(): Boolean = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("${baseUrl()}/health")
                .get()
                .build()
            client.newCall(request).execute().isSuccessful
        } catch (e: Exception) {
            false
        }
    }

    fun cleanup() {
        disconnectWebSocket()
        scope.cancel()
    }
}
