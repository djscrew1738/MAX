package com.ctlplumbing.max.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

// Max brand colors — high contrast for outdoor visibility
val MaxBlue = Color(0xFF00D4FF)
val MaxBlueLight = Color(0xFF80EAFF)
val MaxBlueDark = Color(0xFF0099BB)
val MaxGreen = Color(0xFF00FF88)
val MaxRed = Color(0xFFFF4444)
val MaxOrange = Color(0xFFFF9500)
val MaxYellow = Color(0xFFFFD700)

val DarkBg = Color(0xFF0D1117)
val DarkSurface = Color(0xFF161B22)
val DarkCard = Color(0xFF1C2333)
val DarkBorder = Color(0xFF30363D)
val TextPrimary = Color(0xFFE6EDF3)
val TextSecondary = Color(0xFF8B949E)
val TextMuted = Color(0xFF6E7681)

private val MaxDarkColorScheme = darkColorScheme(
    primary = MaxBlue,
    onPrimary = DarkBg,
    primaryContainer = MaxBlueDark,
    onPrimaryContainer = MaxBlueLight,
    secondary = MaxGreen,
    onSecondary = DarkBg,
    tertiary = MaxOrange,
    background = DarkBg,
    onBackground = TextPrimary,
    surface = DarkSurface,
    onSurface = TextPrimary,
    surfaceVariant = DarkCard,
    onSurfaceVariant = TextSecondary,
    outline = DarkBorder,
    error = MaxRed,
    onError = Color.White,
)

@Composable
fun MaxTheme(content: @Composable () -> Unit) {
    val colorScheme = MaxDarkColorScheme
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = DarkBg.toArgb()
            window.navigationBarColor = DarkBg.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = MaxTypography,
        content = content,
    )
}

val MaxTypography = Typography(
    headlineLarge = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = 28.sp,
        letterSpacing = (-0.5).sp,
        color = TextPrimary,
    ),
    headlineMedium = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        color = TextPrimary,
    ),
    titleLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
        color = TextPrimary,
    ),
    titleMedium = TextStyle(
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        color = TextPrimary,
    ),
    bodyLarge = TextStyle(
        fontSize = 16.sp,
        color = TextPrimary,
        lineHeight = 24.sp,
    ),
    bodyMedium = TextStyle(
        fontSize = 14.sp,
        color = TextSecondary,
        lineHeight = 20.sp,
    ),
    labelLarge = TextStyle(
        fontWeight = FontWeight.SemiBold,
        fontSize = 14.sp,
        letterSpacing = 0.5.sp,
    ),
    labelSmall = TextStyle(
        fontSize = 11.sp,
        color = TextMuted,
        letterSpacing = 0.5.sp,
    ),
)
