package com.ctlplumbing.max.ui.navigation

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.graphics.vector.ImageVector

sealed class Screen(val route: String, val title: String, val icon: ImageVector) {
    data object Home : Screen("home", "Max", Icons.Filled.Home)
    data object Chat : Screen("chat", "Chat", Icons.Filled.Chat)
    data object Jobs : Screen("jobs", "Jobs", Icons.Filled.Work)
    data object Settings : Screen("settings", "Settings", Icons.Filled.Settings)
}

val bottomNavScreens = listOf(Screen.Home, Screen.Chat, Screen.Jobs, Screen.Settings)
