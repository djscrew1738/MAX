package com.ctlplumbing.max

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.ctlplumbing.max.service.NotificationPoller
import com.ctlplumbing.max.service.NotificationPoller
import com.ctlplumbing.max.service.UploadManager
import com.ctlplumbing.max.ui.navigation.Screen
import com.ctlplumbing.max.ui.navigation.bottomNavScreens
import com.ctlplumbing.max.ui.screens.*
import com.ctlplumbing.max.ui.theme.*

class MainActivity : ComponentActivity() {

    private lateinit var uploadManager: UploadManager
    private lateinit var notificationPoller: NotificationPoller

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        uploadManager = UploadManager(this)
        notificationPoller = NotificationPoller(this)

        setContent {
            MaxTheme {
                MaxApp(uploadManager, notificationPoller)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        notificationPoller.startPolling()
    }

    override fun onPause() {
        super.onPause()
        notificationPoller.stopPolling()
    }
}

@Composable
fun MaxApp(uploadManager: UploadManager, notificationPoller: NotificationPoller) {
    val navController = rememberNavController()
    val currentBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = currentBackStackEntry?.destination?.route
    val unreadCount by notificationPoller.unreadCount.collectAsState()

    Scaffold(
        containerColor = DarkBg,
        bottomBar = {
            // Hide bottom bar on detail screens
            val showBottomBar = currentRoute in bottomNavScreens.map { it.route }
            if (showBottomBar) {
                NavigationBar(
                    containerColor = DarkSurface,
                    contentColor = TextPrimary,
                    tonalElevation = 0.dp,
                ) {
                    bottomNavScreens.forEach { screen ->
                        val selected = currentRoute == screen.route

                        NavigationBarItem(
                            icon = {
                                BadgedBox(
                                    badge = {
                                        // Show notification badge on Home tab
                                        if (screen == Screen.Home && unreadCount > 0) {
                                            Badge(
                                                containerColor = MaxRed,
                                            ) {
                                                Text("$unreadCount")
                                            }
                                        }
                                    }
                                ) {
                                    Icon(
                                        screen.icon,
                                        contentDescription = screen.title,
                                        tint = if (selected) MaxBlue else TextMuted,
                                    )
                                }
                            },
                            label = {
                                Text(
                                    screen.title,
                                    color = if (selected) MaxBlue else TextMuted,
                                    style = MaterialTheme.typography.labelSmall,
                                )
                            },
                            selected = selected,
                            onClick = {
                                if (currentRoute != screen.route) {
                                    navController.navigate(screen.route) {
                                        popUpTo(Screen.Home.route) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                }
                            },
                            colors = NavigationBarItemDefaults.colors(
                                indicatorColor = MaxBlue.copy(alpha = 0.12f),
                            ),
                        )
                    }
                }
            }
        },
    ) { paddingValues ->
        NavHost(
            navController = navController,
            startDestination = Screen.Home.route,
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .background(DarkBg),
        ) {
            composable(Screen.Home.route) {
                HomeScreen(uploadManager = uploadManager)
            }
            composable(Screen.Chat.route) {
                ChatScreen()
            }
            composable(Screen.Jobs.route) {
                JobsScreen()
            }
            composable(Screen.Settings.route) {
                SettingsScreen()
            }
            composable(
                "job/{jobId}",
                arguments = listOf(navArgument("jobId") { type = NavType.IntType })
            ) { backStackEntry ->
                val jobId = backStackEntry.arguments?.getInt("jobId") ?: return@composable
                JobDetailScreen(
                    jobId = jobId,
                    onBack = { navController.popBackStack() },
                )
            }
        }
    }
}
