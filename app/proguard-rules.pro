# Max - ProGuard Rules

# Keep Gson models
-keep class com.ctlplumbing.max.data.models.** { *; }
-keepclassmembers class com.ctlplumbing.max.data.models.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Porcupine
-keep class ai.picovoice.** { *; }
