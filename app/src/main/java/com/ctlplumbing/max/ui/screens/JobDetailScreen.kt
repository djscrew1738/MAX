package com.ctlplumbing.max.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ctlplumbing.max.MaxApplication
import com.ctlplumbing.max.data.models.ActionItem
import com.ctlplumbing.max.data.models.JobDetail
import com.ctlplumbing.max.data.models.SessionDetail
import com.ctlplumbing.max.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobDetailScreen(jobId: Int, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val apiClient = MaxApplication.instance.apiClient

    var job by remember { mutableStateOf<JobDetail?>(null) }
    var intel by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(true) }
    var selectedTab by remember { mutableStateOf(0) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(jobId) {
        scope.launch {
            isLoading = true
            try {
                val result = apiClient.getJob(jobId)
                if (result.isSuccess) {
                    job = result.getOrThrow()
                    error = null
                } else {
                    error = result.exceptionOrNull()?.message
                }
            } catch (_: Exception) {}
            isLoading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBg),
    ) {
        // Top bar
        TopAppBar(
            title = {
                Column {
                    Text(
                        job?.subdivision ?: "Job #$jobId",
                        style = MaterialTheme.typography.titleLarge,
                    )
                    val subtitle = listOfNotNull(
                        job?.builderName?.takeIf { it.isNotBlank() },
                        job?.lotNumber?.takeIf { it.isNotBlank() }?.let { "Lot $it" },
                    ).joinToString(" — ")
                    if (subtitle.isNotBlank()) {
                        Text(subtitle, style = MaterialTheme.typography.labelSmall, color = TextMuted)
                    }
                }
            },
            navigationIcon = {
                IconButton(onClick = onBack) {
                    Icon(Icons.Filled.ArrowBack, "Back", tint = TextPrimary)
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkSurface),
        )

        // Tab row
        TabRow(
            selectedTabIndex = selectedTab,
            containerColor = DarkSurface,
            contentColor = MaxBlue,
        ) {
            Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }, text = { Text("Overview") })
            Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }, text = { Text("Walks") })
            Tab(selected = selectedTab == 2, onClick = { selectedTab = 2 }, text = { Text("Intel") })
        }

        when {
            isLoading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaxBlue)
                }
            }
            error != null -> {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Text("Error: $error", color = MaxRed)
                }
            }
            else -> {
                when (selectedTab) {
                    0 -> OverviewTab(job)
                    1 -> WalksTab(job?.sessions ?: emptyList())
                    2 -> IntelTab(intel, jobId)
                }
            }
        }
    }
}

@Composable
private fun OverviewTab(job: JobDetail?) {
    if (job == null) return

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Phase badge
        item {
            val phase = job.phase ?: ""
            if (phase.isNotBlank()) {
                Surface(
                    color = MaxBlue.copy(alpha = 0.15f),
                    shape = RoundedCornerShape(8.dp),
                ) {
                    Text(
                        "Phase: $phase",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.titleMedium,
                        color = MaxBlue,
                    )
                }
            }
        }

        // Stats grid
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Walks",
                    value = job.sessionCount?.toString() ?: "0",
                    icon = Icons.Filled.Mic,
                    color = MaxBlue,
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Fixtures",
                    value = job.fixtureCount?.toString() ?: "—",
                    icon = Icons.Filled.Plumbing,
                    color = MaxGreen,
                )
                StatCard(
                    modifier = Modifier.weight(1f),
                    label = "Open Items",
                    value = job.openItems?.toString() ?: "0",
                    icon = Icons.Filled.CheckCircleOutline,
                    color = MaxOrange,
                )
            }
        }

        // Quick actions
        item {
            Text("Quick Actions", style = MaterialTheme.typography.titleMedium, color = TextPrimary)
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                OutlinedButton(
                    onClick = { /* TODO: Navigate to chat with job context */ },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaxBlue),
                ) {
                    Icon(Icons.Filled.Chat, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Ask Max")
                }
                OutlinedButton(
                    onClick = { /* TODO: Start recording for this job */ },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaxGreen),
                ) {
                    Icon(Icons.Filled.Mic, null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("Record")
                }
            }
        }
    }
}

@Composable
private fun WalksTab(sessions: List<SessionDetail>) {
    if (sessions.isEmpty()) {
        Box(
            Modifier.fillMaxSize().padding(24.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Filled.Mic, null, tint = TextMuted, modifier = Modifier.size(48.dp))
                Spacer(Modifier.height(16.dp))
                Text("No walks recorded yet", color = TextPrimary)
                Text("Start a recording on-site to see walks here", color = TextMuted)
            }
        }
    } else {
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(sessions) { session ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = DarkCard),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            session.title ?: "Walk",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "${session.phase ?: ""} • ${session.recordedAt ?: ""}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMuted,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun IntelTab(intel: String?, jobId: Int) {
    val scope = rememberCoroutineScope()
    val apiClient = MaxApplication.instance.apiClient
    var intelText by remember { mutableStateOf(intel) }
    var isLoading by remember { mutableStateOf(false) }

    // Fetch intel on first view
    LaunchedEffect(jobId) {
        if (intelText == null) {
            isLoading = true
            val result = apiClient.getJobIntel(jobId)
            if (result.isSuccess) {
                intelText = result.getOrNull()
            }
            isLoading = false
        }
    }

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Job Intelligence", style = MaterialTheme.typography.titleMedium, color = MaxBlue)
                OutlinedButton(
                    onClick = {
                        scope.launch {
                            isLoading = true
                            val result = apiClient.getJobIntel(jobId, refresh = true)
                            if (result.isSuccess) {
                                intelText = result.getOrNull()
                            }
                            isLoading = false
                        }
                    },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = MaxBlue),
                ) {
                    Icon(Icons.Filled.Refresh, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Refresh", style = MaterialTheme.typography.labelSmall)
                }
            }
        }

        item {
            if (isLoading) {
                Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaxBlue)
                }
            } else if (intelText != null) {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DarkCard),
                    shape = RoundedCornerShape(12.dp),
                ) {
                    Text(
                        intelText!!,
                        modifier = Modifier.padding(16.dp),
                        style = MaterialTheme.typography.bodyLarge,
                        color = TextPrimary,
                    )
                }
            } else {
                Text(
                    "No intelligence available yet. Record some job walks to build up job intelligence.",
                    color = TextMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun StatCard(
    modifier: Modifier = Modifier,
    label: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    color: androidx.compose.ui.graphics.Color,
) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = DarkCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, null, tint = color, modifier = Modifier.size(24.dp))
            Spacer(Modifier.height(4.dp))
            Text(value, style = MaterialTheme.typography.headlineMedium, color = color, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = TextMuted)
        }
    }
}
