package com.ctlplumbing.max.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.ctlplumbing.max.MaxApplication
import com.ctlplumbing.max.service.FileHelper
import com.ctlplumbing.max.service.RecordingService
import com.ctlplumbing.max.service.UploadManager
import com.ctlplumbing.max.ui.theme.*
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(uploadManager: UploadManager) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val isRecording by RecordingService.recordingState.collectAsState()
    val duration by RecordingService.currentDuration.collectAsState()
    val currentSession by RecordingService.currentSession.collectAsState()
    val uploadQueue by uploadManager.uploadQueue.collectAsState()
    val isUploading by uploadManager.isUploading.collectAsState()

    var serverConnected by remember { mutableStateOf<Boolean?>(null) }
    var hasPermission by remember { mutableStateOf(false) }
    var attachmentCount by remember { mutableStateOf(0) }
    var flagCount by remember { mutableStateOf(0) }
    var lastAction by remember { mutableStateOf("") }

    // File picker launcher (for PDFs / plans)
    val filePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        uri?.let {
            val session = RecordingService.currentSession.value ?: return@let
            val sessionDir = FileHelper.getSessionDir(context, session.recordedAt)
            val file = FileHelper.copyUriToInternal(context, it, sessionDir)
            file?.let { f ->
                val elapsed = RecordingService.currentDuration.value
                val attachment = FileHelper.createAttachmentInfo(f, elapsed)
                session.attachments.add(attachment)
                attachmentCount = session.attachments.size
                lastAction = "📄 Plans attached"
            }
        }
    }

    // Camera launcher (for photos)
    val cameraLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        if (success) {
            // Photo was saved to the URI we provided
            attachmentCount = RecordingService.currentSession.value?.attachments?.size ?: 0
            lastAction = "📸 Photo captured"
        }
    }

    // Check permissions
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        hasPermission = permissions.values.all { it }
    }

    LaunchedEffect(Unit) {
        hasPermission = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            permissionLauncher.launch(arrayOf(
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.POST_NOTIFICATIONS,
            ))
        }

        // Check server
        scope.launch {
            serverConnected = MaxApplication.instance.apiClient.healthCheck()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBg)
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(20.dp))

        // Header
        Text(
            "MAX",
            style = MaterialTheme.typography.headlineLarge.copy(
                fontSize = 36.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 4.sp,
            ),
            color = MaxBlue,
        )
        Text(
            "AI Field Assistant",
            style = MaterialTheme.typography.bodyMedium,
            color = TextMuted,
        )

        Spacer(modifier = Modifier.height(40.dp))

        // --- Big Record Button ---
        RecordButton(
            isRecording = isRecording,
            duration = duration,
            hasPermission = hasPermission,
            onToggle = {
                if (isRecording) {
                    RecordingService.stop(context)
                    // Queue upload after a short delay for the service to finish
                    scope.launch {
                        kotlinx.coroutines.delay(500)
                        RecordingService.currentSession.value?.let { session ->
                            uploadManager.queueSession(session)
                        }
                    }
                } else {
                    RecordingService.start(context)
                }
            },
        )

        Spacer(modifier = Modifier.height(12.dp))

        // Recording hint
        AnimatedVisibility(visible = !isRecording) {
            Text(
                "Tap to start recording\nor say \"Hey Max\"",
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted,
                textAlign = TextAlign.Center,
            )
        }

        AnimatedVisibility(visible = isRecording) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    "Recording...",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaxRed,
                )
                Text(
                    "Say \"Max, stop\" to end",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted,
                )
            }
        }

        Spacer(modifier = Modifier.height(40.dp))

        // --- Quick Actions During Recording ---
        AnimatedVisibility(visible = isRecording) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                QuickActionButton(Icons.Filled.Description, "Plans") {
                    filePickerLauncher.launch("application/pdf")
                }
                QuickActionButton(Icons.Filled.CameraAlt, "Photo") {
                    // For camera, we'd need a temp URI. Simplified: use gallery for now.
                    filePickerLauncher.launch("image/*")
                }
                QuickActionButton(Icons.Filled.Flag, "Flag") {
                    RecordingService.currentSession.value?.let { session ->
                        val elapsed = RecordingService.currentDuration.value
                        session.flags.add(com.ctlplumbing.max.data.models.FlagMarker(elapsed))
                        flagCount = session.flags.size
                        lastAction = "🚩 Flagged at ${formatDuration(elapsed)}"
                    }
                }
                QuickActionButton(Icons.Filled.MeetingRoom, "Room") {
                    // TODO: Show dialog for room name input
                    RecordingService.currentSession.value?.let { session ->
                        val elapsed = RecordingService.currentDuration.value
                        session.roomMarkers.add(
                            com.ctlplumbing.max.data.models.RoomMarker("Room ${session.roomMarkers.size + 1}", elapsed)
                        )
                        lastAction = "🚪 Room marker added"
                    }
                }
            }

            // Show last action feedback
            if (lastAction.isNotBlank()) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    lastAction,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaxGreen,
                )
            }

            // Attachment count
            if (attachmentCount > 0 || flagCount > 0) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    "$attachmentCount files attached • $flagCount flags",
                    style = MaterialTheme.typography.labelSmall,
                    color = TextMuted,
                )
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        // --- Status Cards ---
        // Server connection
        StatusCard(
            icon = if (serverConnected == true) Icons.Filled.Cloud else Icons.Filled.CloudOff,
            title = "Server",
            value = when (serverConnected) {
                true -> "Connected"
                false -> "Offline"
                null -> "Checking..."
            },
            color = when (serverConnected) {
                true -> MaxGreen
                false -> MaxRed
                null -> TextMuted
            },
        )

        Spacer(modifier = Modifier.height(12.dp))

        // Upload queue
        if (uploadQueue.isNotEmpty()) {
            StatusCard(
                icon = Icons.Filled.Upload,
                title = "Upload Queue",
                value = "${uploadQueue.count { it.status == UploadManager.UploadStatus.COMPLETE }}/${uploadQueue.size} complete",
                color = if (isUploading) MaxOrange else MaxGreen,
            )
        }
    }
}

@Composable
private fun RecordButton(
    isRecording: Boolean,
    duration: Int,
    hasPermission: Boolean,
    onToggle: () -> Unit,
) {
    val pulseAnim = rememberInfiniteTransition(label = "pulse")
    val pulse by pulseAnim.animateFloat(
        initialValue = 1f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = EaseInOut),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "pulse",
    )

    val buttonScale = if (isRecording) pulse else 1f

    Box(contentAlignment = Alignment.Center) {
        // Outer glow when recording
        if (isRecording) {
            Box(
                modifier = Modifier
                    .size(180.dp)
                    .scale(pulse)
                    .clip(CircleShape)
                    .background(
                        Brush.radialGradient(
                            colors = listOf(MaxRed.copy(alpha = 0.3f), Color.Transparent)
                        )
                    )
            )
        }

        // Main button
        Button(
            onClick = onToggle,
            modifier = Modifier
                .size(140.dp)
                .scale(buttonScale),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(
                containerColor = if (isRecording) MaxRed else MaxBlue,
            ),
            elevation = ButtonDefaults.buttonElevation(defaultElevation = 8.dp),
            enabled = hasPermission,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    if (isRecording) Icons.Filled.Stop else Icons.Filled.Mic,
                    contentDescription = if (isRecording) "Stop" else "Record",
                    modifier = Modifier.size(40.dp),
                    tint = Color.White,
                )
                if (isRecording) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        formatDuration(duration),
                        color = Color.White,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }
}

@Composable
private fun QuickActionButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    onClick: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledIconButton(
            onClick = onClick,
            modifier = Modifier.size(52.dp),
            colors = IconButtonDefaults.filledIconButtonColors(
                containerColor = DarkCard,
            ),
        ) {
            Icon(icon, contentDescription = label, tint = MaxBlue, modifier = Modifier.size(24.dp))
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = TextMuted)
    }
}

@Composable
private fun StatusCard(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    value: String,
    color: Color,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = DarkCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(24.dp))
            Spacer(modifier = Modifier.width(12.dp))
            Text(title, style = MaterialTheme.typography.bodyMedium, color = TextSecondary)
            Spacer(modifier = Modifier.weight(1f))
            Text(value, style = MaterialTheme.typography.labelLarge, color = color)
        }
    }
}

private fun formatDuration(seconds: Int): String {
    val m = seconds / 60
    val s = seconds % 60
    return "%d:%02d".format(m, s)
}
