# 🔨 Max — Android App

**Voice-activated field assistant APK for CTL Plumbing LLC**

## Setup

### 1. Prerequisites
- Android Studio Hedgehog (2023.1.1) or later
- Android SDK 34
- A device running Android 8.0+ (API 26+)
- Max server running (see `max/` server project)

### 2. Configure Server Connection

Open `app/build.gradle.kts` and update these lines with your server IP:

```kotlin
buildConfigField("String", "API_BASE_URL", "\"http://YOUR_SERVER_IP:3210\"")
buildConfigField("String", "API_KEY", "\"your-api-key-here\"")
```

Or configure them later in the app's Settings screen.

### 3. Build APK

```bash
# Open project in Android Studio, or from command line:
./gradlew assembleDebug

# APK will be at:
# app/build/outputs/apk/debug/app-debug.apk
```

### 4. Install on Phone

```bash
adb install app/build/outputs/apk/debug/app-debug.apk
```

Or transfer the APK to your phone and install directly.

### 5. Wake Word Setup (Optional)

To enable "Hey Max" wake word detection:

1. Sign up for a free Picovoice account at https://picovoice.ai
2. Get your Access Key from the dashboard
3. Enter it in Max Settings → Picovoice Access Key

The free tier includes 3 custom wake words and unlimited on-device processing.

---

## App Structure

```
Home Screen
├── Big record button (tap or say "Hey Max")
├── Quick action buttons during recording:
│   ├── 📄 Attach Plans (file picker)
│   ├── 📸 Take Photo (camera)
│   ├── 🚩 Flag Moment (bookmark)
│   └── 🚪 New Room (section marker)
├── Server connection status
└── Upload queue status

Chat Screen
├── Talk to Max about any job walk
├── Full RAG-powered responses
└── Conversation history

Jobs Screen
├── All jobs from server
├── Session count, attachment count, open items
└── Phase badges

Settings Screen
├── Server URL + API Key
├── Wake word on/off + Picovoice key
├── Auto-upload toggle
└── Haptic feedback toggle
```

## Voice Commands (During Recording)

| Command | Action |
|---------|--------|
| "Hey Max" | Start recording |
| "Max, here are the plans" | Open file picker for PDF |
| "Max, take a photo" | Open camera |
| "Max, new room — [name]" | Section marker |
| "Max, flag that" | Bookmark last 30 sec |
| "Max, this is [builder/job/lot]" | Tag session |
| "Max, stop" | End recording + upload |

---

## Architecture

- **Kotlin + Jetpack Compose** — Modern Android UI
- **Foreground Service** — Recording never gets killed by Android
- **OkHttp** — File uploads with retry
- **DataStore** — Persistent settings
- **Picovoice Porcupine** — On-device wake word (no cloud)
- **Upload Queue** — Queues locally, syncs when connected

---

## Tech Notes

- Audio is recorded as OGG/Opus at 16kHz mono — small files, great for speech
- All uploads go through your Cloudflare Tunnel to your home server
- Wake word runs 100% on-device, zero cloud dependency
- Dark theme with high contrast — designed for direct Texas sunlight
- `usesCleartextTraffic=true` for local HTTP connections

## License

Private — CTL Plumbing LLC
