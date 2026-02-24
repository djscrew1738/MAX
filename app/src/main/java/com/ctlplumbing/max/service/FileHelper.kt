package com.ctlplumbing.max.service

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.ctlplumbing.max.data.models.AttachmentInfo
import java.io.File
import java.io.FileOutputStream

/**
 * Handles file operations for mid-recording attachments
 */
object FileHelper {

    /**
     * Copy a URI (from file picker or camera) to internal storage
     * Returns the local file path
     */
    fun copyUriToInternal(context: Context, uri: Uri, sessionDir: File): File? {
        return try {
            sessionDir.mkdirs()
            
            val fileName = getFileName(context, uri) ?: "attachment_${System.currentTimeMillis()}"
            val destFile = File(sessionDir, fileName)

            context.contentResolver.openInputStream(uri)?.use { input ->
                FileOutputStream(destFile).use { output ->
                    input.copyTo(output)
                }
            }

            destFile
        } catch (e: Exception) {
            e.printStackTrace()
            null
        }
    }

    /**
     * Get original filename from URI
     */
    fun getFileName(context: Context, uri: Uri): String? {
        var name: String? = null
        
        if (uri.scheme == "content") {
            context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIndex >= 0) {
                        name = cursor.getString(nameIndex)
                    }
                }
            }
        }

        if (name == null) {
            name = uri.path?.substringAfterLast('/')
        }

        return name
    }

    /**
     * Determine file type from extension
     */
    fun getFileType(fileName: String): String {
        val ext = fileName.substringAfterLast('.', "").lowercase()
        return when (ext) {
            "pdf" -> "pdf"
            "jpg", "jpeg", "png", "webp", "heic" -> "image"
            else -> "document"
        }
    }

    /**
     * Create an AttachmentInfo from a local file
     */
    fun createAttachmentInfo(file: File, recordingElapsedSecs: Int = 0): AttachmentInfo {
        return AttachmentInfo(
            filePath = file.absolutePath,
            fileName = file.name,
            fileType = getFileType(file.name),
            addedAtSecs = recordingElapsedSecs,
        )
    }

    /**
     * Get the session directory for storing attachments
     */
    fun getSessionDir(context: Context, sessionTimestamp: Long): File {
        return File(context.filesDir, "sessions/$sessionTimestamp")
    }

    /**
     * Get all session directories
     */
    fun getAllSessionDirs(context: Context): List<File> {
        val sessionsDir = File(context.filesDir, "sessions")
        return sessionsDir.listFiles()?.filter { it.isDirectory }?.toList() ?: emptyList()
    }

    /**
     * Clean up old session files (older than 7 days, already uploaded)
     */
    fun cleanupOldSessions(context: Context, maxAgeDays: Int = 7) {
        val cutoff = System.currentTimeMillis() - (maxAgeDays * 24 * 60 * 60 * 1000L)
        getAllSessionDirs(context).forEach { dir ->
            try {
                val timestamp = dir.name.toLongOrNull() ?: return@forEach
                if (timestamp < cutoff) {
                    dir.deleteRecursively()
                }
            } catch (_: Exception) {}
        }
    }
}
