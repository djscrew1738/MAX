package com.ctlplumbing.max.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ctlplumbing.max.MaxApplication
import com.ctlplumbing.max.data.models.ServerStatus
import com.ctlplumbing.max.data.repository.SettingsRepository
import com.ctlplumbing.max.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen() {
    val scope = rememberCoroutineScope()
    val settings = MaxApplication.instance.settings
    val apiClient = MaxApplication.instance.apiClient

    val serverUrl by settings.serverUrl.collectAsState(initial = "")
    val apiKey by settings.apiKey.collectAsState(initial = "")
    val wakeWordEnabled by settings.wakeWordEnabled.collectAsState(initial = true)
    val autoUpload by settings.autoUpload.collectAsState(initial = true)
    val vibrateOnCommand by settings.vibrateOnCommand.collectAsState(initial = true)
    val porcupineKey by settings.porcupineAccessKey.collectAsState(initial = "")

    var serverStatus by remember { mutableStateOf<ServerStatus?>(null) }
    var editUrl by remember { mutableStateOf("") }
    var editApiKey by remember { mutableStateOf("") }
    var editPorcupineKey by remember { mutableStateOf("") }
    var showSaved by remember { mutableStateOf(false) }

    // Sync edit fields with settings
    LaunchedEffect(serverUrl) { editUrl = serverUrl }
    LaunchedEffect(apiKey) { editApiKey = apiKey }
    LaunchedEffect(porcupineKey) { editPorcupineKey = porcupineKey }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBg),
    ) {
        TopAppBar(
            title = { Text("Settings", style = MaterialTheme.typography.titleLarge) },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkSurface),
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // --- Server Connection ---
            SectionHeader("Server Connection")

            OutlinedTextField(
                value = editUrl,
                onValueChange = { editUrl = it },
                label = { Text("Server URL") },
                placeholder = { Text("http://192.168.1.100:3210") },
                modifier = Modifier.fillMaxWidth(),
                colors = maxTextFieldColors(),
                singleLine = true,
            )

            OutlinedTextField(
                value = editApiKey,
                onValueChange = { editApiKey = it },
                label = { Text("API Key") },
                modifier = Modifier.fillMaxWidth(),
                colors = maxTextFieldColors(),
                singleLine = true,
            )

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = {
                        scope.launch {
                            settings.update(SettingsRepository.SERVER_URL, editUrl)
                            settings.update(SettingsRepository.API_KEY, editApiKey)
                            showSaved = true
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = MaxBlue),
                ) {
                    Text("Save")
                }

                OutlinedButton(
                    onClick = {
                        scope.launch {
                            val result = apiClient.getStatus()
                            serverStatus = result.getOrNull()
                        }
                    },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaxGreen),
                ) {
                    Text("Test Connection")
                }
            }

            if (serverStatus != null) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DarkCard),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("✅ Connected", color = MaxGreen, style = MaterialTheme.typography.labelLarge)
                        serverStatus?.let { s ->
                            Text("Sessions: ${s.totalSessions ?: 0} (${s.completedSessions ?: 0} complete)", color = TextSecondary, style = MaterialTheme.typography.bodyMedium)
                            Text("Jobs: ${s.totalJobs ?: 0}", color = TextSecondary, style = MaterialTheme.typography.bodyMedium)
                            Text("Open actions: ${s.openActions ?: 0}", color = TextSecondary, style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }

            Divider(color = DarkBorder)

            // --- Wake Word ---
            SectionHeader("Wake Word")

            SettingsToggle(
                title = "Enable \"Hey Max\"",
                subtitle = "Listen for wake word in background",
                checked = wakeWordEnabled,
                onCheckedChange = {
                    scope.launch { settings.update(SettingsRepository.WAKE_WORD_ENABLED, it) }
                },
            )

            OutlinedTextField(
                value = editPorcupineKey,
                onValueChange = { editPorcupineKey = it },
                label = { Text("Picovoice Access Key") },
                placeholder = { Text("Get free key at picovoice.ai") },
                modifier = Modifier.fillMaxWidth(),
                colors = maxTextFieldColors(),
                singleLine = true,
            )

            Button(
                onClick = {
                    scope.launch {
                        settings.update(SettingsRepository.PORCUPINE_ACCESS_KEY, editPorcupineKey)
                        showSaved = true
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = MaxBlue),
            ) {
                Text("Save Key")
            }

            Divider(color = DarkBorder)

            // --- Behavior ---
            SectionHeader("Behavior")

            SettingsToggle(
                title = "Auto-upload recordings",
                subtitle = "Upload immediately when recording stops",
                checked = autoUpload,
                onCheckedChange = {
                    scope.launch { settings.update(SettingsRepository.AUTO_UPLOAD, it) }
                },
            )

            SettingsToggle(
                title = "Vibrate on commands",
                subtitle = "Haptic feedback when Max hears a command",
                checked = vibrateOnCommand,
                onCheckedChange = {
                    scope.launch { settings.update(SettingsRepository.VIBRATE_ON_COMMAND, it) }
                },
            )

            Divider(color = DarkBorder)

            // --- About ---
            SectionHeader("About")

            Text(
                "Max v1.0.0 — AI Field Assistant\nCTL Plumbing LLC\nAll processing runs on your home server.",
                style = MaterialTheme.typography.bodyMedium,
                color = TextMuted,
            )

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    // Saved snackbar
    if (showSaved) {
        LaunchedEffect(showSaved) {
            kotlinx.coroutines.delay(2000)
            showSaved = false
        }
    }
}

@Composable
private fun SectionHeader(title: String) {
    Text(
        title,
        style = MaterialTheme.typography.titleMedium,
        color = MaxBlue,
        modifier = Modifier.padding(top = 8.dp),
    )
}

@Composable
private fun SettingsToggle(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = TextPrimary)
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = TextMuted)
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedTrackColor = MaxBlue,
                checkedThumbColor = DarkBg,
            ),
        )
    }
}

@Composable
private fun maxTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = MaxBlue,
    unfocusedBorderColor = DarkBorder,
    cursorColor = MaxBlue,
    focusedTextColor = TextPrimary,
    unfocusedTextColor = TextPrimary,
    focusedLabelColor = MaxBlue,
    unfocusedLabelColor = TextMuted,
)
