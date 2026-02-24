# Max Android APK Audit — Release Readiness (Internal)

## Goals
- Produce fresh `app-debug.apk` and unsigned `app-release-unsigned.apk` from current main branch.
- Identify blockers for internal sideload on Samsung Galaxy S22 and Galaxy Tab A9 (ARM64).
- Deliver concise QA findings plus a punch list of fixes; note size/shrink status and key manifest/build config issues.

## Scope (In / Out)
- In scope: manifest & permissions, exported components, versioning, buildConfig URLs/API key, cleartext vs TLS, ProGuard/R8/shrink config, dependency surface, resource/dex/native footprints, Gradle/lint warnings, WorkManager/foreground service declarations.
- Out of scope: Play Store signing/integrity, full accessibility, deep functional/regression testing, device performance benchmarks.

## Artifacts & Commands
- Build debug: `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.
- Build unsigned release: `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release-unsigned.apk`.
- Inspection tools: `apkanalyzer files summary|list`, `aapt dump xmltree` (manifest), `apkanalyzer dex packages`, `zipinfo lib/`, `du -h app/build/outputs/apk`.
- Dependency surface: `./gradlew app:dependencies --configuration releaseRuntimeClasspath` (summarize only notable libs).
- Lint: `./gradlew lintDebug` (capture key warnings only).

## Checks & Heuristics
- Versioning: `versionCode`, `versionName`, `minSdk 26`, `targetSdk 34`, debug `applicationIdSuffix`. 
- Networking: `usesCleartextTraffic`, hardcoded `API_BASE_URL` / `WS_URL` / `API_KEY` in BuildConfig; ensure Tailscale endpoints intentional.
- Security/export rules: `android:exported` on activities/services/providers; `allowBackup`; notification permission target; media/file access perms; foreground-service types.
- Size & perf: shrink enabled for release; record APK sizes; largest native libs/assets; note dex package count.
- Crash/log risk: WorkManager initializer removal correctness; reflection-based libs (Gson, Room, Porcupine) keep rules.

## Devices in Scope
- Samsung Galaxy S22 (ARM64), Samsung Galaxy Tab A9 (ARM64) — targeting sideload; no x86 builds needed.

## Deliverables
- `app-debug.apk` and `app-release-unsigned.apk` in output dirs.
- QA report with findings + punch list (blockers vs nice-to-fix) in repo.
- Chat summary of results.

## Assumptions
- No release keystore provided; unsigned release build is acceptable for inspection.
- Ollama/Tailscale endpoints remain at `http://100.83.120.32:4000` for this audit.
- Internal distribution only; Play Store policies not applied.
