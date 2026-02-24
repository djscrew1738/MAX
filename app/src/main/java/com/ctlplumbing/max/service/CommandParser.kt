package com.ctlplumbing.max.service

import com.ctlplumbing.max.data.models.MaxCommand

/**
 * Parses voice input to detect Max commands.
 * Used by the RecordingService to handle mid-recording commands.
 * 
 * In Phase 2+, this will work with on-device speech recognition
 * to detect commands in real-time during recording.
 * For now, commands are detected post-transcription on the server.
 */
object CommandParser {

    private val PLANS_PATTERN = Regex(
        """(?:hey\s+)?max[,.]?\s*here\s+are\s+the\s+plans?""",
        RegexOption.IGNORE_CASE
    )
    private val PHOTO_PATTERN = Regex(
        """(?:hey\s+)?max[,.]?\s*take\s+a\s+photo""",
        RegexOption.IGNORE_CASE
    )
    private val ROOM_PATTERN = Regex(
        """(?:hey\s+)?max[,.]?\s*new\s+room\s*[-–—]?\s*(.+)""",
        RegexOption.IGNORE_CASE
    )
    private val FLAG_PATTERN = Regex(
        """(?:hey\s+)?max[,.]?\s*flag\s+that""",
        RegexOption.IGNORE_CASE
    )
    private val TAG_PATTERN = Regex(
        """(?:hey\s+)?max[,.]?\s*this\s+is\s+(.+)""",
        RegexOption.IGNORE_CASE
    )
    private val STOP_PATTERN = Regex(
        """(?:hey\s+)?max[,.]?\s*stop""",
        RegexOption.IGNORE_CASE
    )
    private val START_PATTERN = Regex(
        """hey\s+max""",
        RegexOption.IGNORE_CASE
    )

    /**
     * Parse a text input and return the detected command
     */
    fun parse(text: String, currentTimeSecs: Int = 0): MaxCommand {
        return when {
            STOP_PATTERN.containsMatchIn(text) -> MaxCommand.StopRecording
            PLANS_PATTERN.containsMatchIn(text) -> MaxCommand.AttachPlans(currentTimeSecs)
            PHOTO_PATTERN.containsMatchIn(text) -> MaxCommand.TakePhoto(currentTimeSecs)
            ROOM_PATTERN.containsMatchIn(text) -> {
                val match = ROOM_PATTERN.find(text)
                val roomName = match?.groupValues?.get(1)?.trim() ?: "unnamed"
                MaxCommand.NewRoom(roomName, currentTimeSecs)
            }
            FLAG_PATTERN.containsMatchIn(text) -> MaxCommand.FlagMoment(currentTimeSecs)
            TAG_PATTERN.containsMatchIn(text) -> {
                val match = TAG_PATTERN.find(text)
                val tag = match?.groupValues?.get(1)?.trim() ?: ""
                MaxCommand.TagJob(tag, currentTimeSecs)
            }
            START_PATTERN.containsMatchIn(text) -> MaxCommand.StartRecording
            else -> MaxCommand.Unknown
        }
    }

    /**
     * Quick check if text contains any Max command
     */
    fun containsCommand(text: String): Boolean {
        return parse(text) !is MaxCommand.Unknown
    }
}
