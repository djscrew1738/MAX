package com.ctlplumbing.max.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.ctlplumbing.max.MaxApplication
import com.ctlplumbing.max.data.models.ChatMessage
import com.ctlplumbing.max.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen() {
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val apiClient = MaxApplication.instance.apiClient

    var messages by remember { mutableStateOf(listOf<ChatMessage>()) }
    var input by remember { mutableStateOf("") }
    var isLoading by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(DarkBg),
    ) {
        // Header
        TopAppBar(
            title = {
                Column {
                    Text("Chat with Max", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "Ask about any job, recording, or plan",
                        style = MaterialTheme.typography.labelSmall,
                        color = TextMuted,
                    )
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = DarkSurface),
        )

        // Messages
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(vertical = 16.dp),
        ) {
            // Welcome message if empty
            if (messages.isEmpty()) {
                item {
                    ChatBubble(
                        message = ChatMessage(
                            role = "assistant",
                            content = "Hey! I'm Max, your field assistant. Ask me anything about your job walks, recordings, plans, or action items.\n\nTry:\n• \"What's open on Lot 14?\"\n• \"Catch me up on DR Horton jobs\"\n• \"Any fixture count discrepancies this week?\"",
                        ),
                        isUser = false,
                    )
                }
            }

            items(messages) { message ->
                ChatBubble(
                    message = message,
                    isUser = message.role == "user",
                )
            }

            // Loading indicator
            if (isLoading) {
                item {
                    Row(
                        modifier = Modifier.padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = MaxBlue,
                            strokeWidth = 2.dp,
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Max is thinking...", color = TextMuted, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }

        // Input bar
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(DarkSurface)
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = input,
                onValueChange = { input = it },
                modifier = Modifier.weight(1f),
                placeholder = { Text("Ask Max anything...", color = TextMuted) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MaxBlue,
                    unfocusedBorderColor = DarkBorder,
                    cursorColor = MaxBlue,
                    focusedTextColor = TextPrimary,
                    unfocusedTextColor = TextPrimary,
                ),
                shape = RoundedCornerShape(24.dp),
                singleLine = false,
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(
                    onSend = {
                        if (input.isNotBlank() && !isLoading) {
                            val query = input.trim()
                            input = ""
                            sendMessage(query, messages, scope, apiClient) { updated, loading ->
                                messages = updated
                                isLoading = loading
                            }
                        }
                    }
                ),
            )

            Spacer(modifier = Modifier.width(8.dp))

            FilledIconButton(
                onClick = {
                    if (input.isNotBlank() && !isLoading) {
                        val query = input.trim()
                        input = ""
                        sendMessage(query, messages, scope, apiClient) { updated, loading ->
                            messages = updated
                            isLoading = loading
                        }
                    }
                },
                enabled = input.isNotBlank() && !isLoading,
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MaxBlue,
                    disabledContainerColor = DarkCard,
                ),
            ) {
                Icon(Icons.Filled.Send, contentDescription = "Send", tint = Color.White)
            }
        }
    }

    // Auto-scroll to bottom on new messages
    LaunchedEffect(messages.size, isLoading) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1 + if (isLoading) 1 else 0)
        }
    }
}

private fun sendMessage(
    query: String,
    currentMessages: List<ChatMessage>,
    scope: kotlinx.coroutines.CoroutineScope,
    apiClient: com.ctlplumbing.max.data.api.MaxApiClient,
    onUpdate: (List<ChatMessage>, Boolean) -> Unit,
) {
    val userMsg = ChatMessage(role = "user", content = query)
    val updated = currentMessages + userMsg
    onUpdate(updated, true)

    scope.launch {
        val result = apiClient.chat(
            message = query,
            history = updated.takeLast(10),
        )

        val reply = if (result.isSuccess) {
            result.getOrThrow().reply
        } else {
            "Sorry, I couldn't reach the server. Make sure your server is running and you're connected. Error: ${result.exceptionOrNull()?.message}"
        }

        val assistantMsg = ChatMessage(role = "assistant", content = reply)
        onUpdate(updated + assistantMsg, false)
    }
}

@Composable
private fun ChatBubble(message: ChatMessage, isUser: Boolean) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = 320.dp)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isUser) 16.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 16.dp,
                    )
                )
                .background(if (isUser) MaxBlue.copy(alpha = 0.15f) else DarkCard)
                .padding(12.dp),
        ) {
            Text(
                text = message.content,
                style = MaterialTheme.typography.bodyLarge,
                color = if (isUser) MaxBlueLight else TextPrimary,
            )
        }
    }
}
