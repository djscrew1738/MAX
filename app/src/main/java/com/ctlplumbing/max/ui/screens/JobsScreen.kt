package com.ctlplumbing.max.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import com.ctlplumbing.max.data.models.Job
import com.ctlplumbing.max.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen() {
    val scope = rememberCoroutineScope()
    val apiClient = MaxApplication.instance.apiClient

    var jobs by remember { mutableStateOf<List<Job>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        scope.launch {
            isLoading = true
            val result = apiClient.getJobs()
            if (result.isSuccess) {
                jobs = result.getOrThrow().data
                error = null
            } else {
                error = result.exceptionOrNull()?.message
            }
            isLoading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBg),
    ) {
        TopAppBar(
            title = {
                Column {
                    Text("Jobs", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "${jobs.size} jobs on record",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                    )
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkSurface),
            actions = {
                IconButton(onClick = {
                    scope.launch {
                        isLoading = true
                        val result = apiClient.getJobs()
                        if (result.isSuccess) jobs = result.getOrThrow().data
                        isLoading = false
                    }
                }) {
                    Icon(Icons.Filled.Refresh, "Refresh", tint = MaxBlue)
                }
            }
        )

        when {
            isLoading -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = MaxBlue)
                }
            }
            error != null -> {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Filled.CloudOff, null, tint = MaxRed, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.height(16.dp))
                        Text("Can't reach server", color = TextPrimary, style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(8.dp))
                        Text(error ?: "", color = TextMuted, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
            jobs.isEmpty() -> {
                Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Filled.WorkOff, null, tint = TextMuted, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.height(16.dp))
                        Text("No jobs yet", color = TextPrimary, style = MaterialTheme.typography.titleMedium)
                        Text("Record your first job walk to get started", color = TextMuted)
                    }
                }
            }
            else -> {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(jobs) { job ->
                        JobCard(job)
                    }
                }
            }
        }
    }
}

@Composable
private fun JobCard(job: Job) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { /* TODO: Navigate to job detail */ },
        colors = CardDefaults.cardColors(containerColor = DarkCard),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Header row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    if (job.builderName != null) {
                        Text(
                            job.builderName,
                            style = MaterialTheme.typography.labelLarge,
                            color = MaxBlue,
                        )
                    }
                    Text(
                        buildString {
                            job.subdivision?.let { append(it) }
                            job.lotNumber?.let {
                                if (isNotEmpty()) append(" — ")
                                append("Lot $it")
                            }
                            if (isEmpty()) append("Untagged Job #${job.id}")
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }

                if (job.phase != null) {
                    Surface(
                        color = MaxBlue.copy(alpha = 0.15f),
                        shape = RoundedCornerShape(8.dp),
                    ) {
                        Text(
                            job.phase,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaxBlue,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Stats row
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                StatChip(Icons.Filled.Mic, "${job.sessionCount ?: 0}", "walks")
                StatChip(Icons.Filled.AttachFile, "${job.attachmentCount ?: 0}", "files")
                if ((job.openItems ?: 0) > 0) {
                    StatChip(Icons.Filled.CheckCircleOutline, "${job.openItems}", "open", MaxOrange)
                }
                if (job.fixtureCount != null) {
                    StatChip(Icons.Filled.Plumbing, "${job.fixtureCount}", "fixtures")
                }
            }
        }
    }
}

@Composable
private fun StatChip(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    value: String,
    label: String,
    color: androidx.compose.ui.graphics.Color = TextMuted,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, modifier = Modifier.size(14.dp), tint = color)
        Spacer(Modifier.width(4.dp))
        Text(value, style = MaterialTheme.typography.labelLarge, color = color)
        Spacer(Modifier.width(2.dp))
        Text(label, style = MaterialTheme.typography.labelSmall, color = TextMuted)
    }
}
