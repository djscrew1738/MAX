# 📱 Max Android APK Build Guide

## Download Pre-built APK

Once you push to GitHub, the GitHub Actions workflow will automatically build APKs and attach them to releases.

### Latest Release
Visit: `https://github.com/YOUR_USERNAME/max/releases`

### From GitHub Actions Artifacts
1. Go to **Actions** tab in your GitHub repository
2. Click on the latest **Build Android APK** workflow run
3. Download `app-debug` or `app-release` artifact

---

## Build Locally

### Prerequisites
- Android Studio Hedgehog (2023.1.1) or newer
- Android SDK 34
- JDK 17

### Build Debug APK
```bash
./gradlew assembleDebug
```
APK location: `app/build/outputs/apk/debug/app-debug.apk`

### Build Release APK
```bash
./gradlew assembleRelease
```
APK location: `app/build/outputs/apk/release/app-release-unsigned.apk`

### Install to Device
```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

---

## Pre-Configured Settings

The APK is pre-configured for your Tailscale network:

| Setting | Value |
|---------|-------|
| API Base URL | `http://100.83.120.32:4000` |
| WebSocket URL | `ws://100.83.120.32:4000/ws` |
| API Key | `max-secret-key-change-me` |

To change these, edit `app/build.gradle.kts` and rebuild.

---

## Troubleshooting

### Build fails with "Cannot find KSP plugin"
Make sure you have the KSP plugin version matching your Kotlin version in `build.gradle.kts`:
```kotlin
id("com.google.devtools.ksp") version "1.9.22-1.0.17" apply false
```

### Out of memory during build
Add to `gradle.properties`:
```properties
org.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=512m
org.gradle.parallel=true
org.gradle.caching=true
```

### APK won't install
- Enable "Install from Unknown Sources" in Android Settings
- Uninstall any existing version first
- Check that minSdk (26) matches your device
