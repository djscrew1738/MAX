# Max Android APK Audit — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build fresh debug and unsigned release APKs and produce a release-readiness QA report for internal sideload on Samsung Galaxy S22 and Galaxy Tab A9.

**Architecture:** Use Gradle to build debug and release variants, run lint, and inspect APKs with apkanalyzer/aapt/zipinfo. Summarize findings into a QA report with clear blockers/nice-to-fix items; no code changes unless required by findings.

**Tech Stack:** Android Gradle Plugin, Kotlin, apkanalyzer/aapt from Android SDK, zipinfo/du, bash.

---

### Task 1: Prep & Context Snapshot

**Files:**
- Report: `docs/plans/2026-02-24-apk-audit-report.md`

**Step 1:** Check repo status.
- Run: `git status --short`
- Expected: clean or only plan/report files untracked.

**Step 2:** Note existing version/config.
- Run: `rg "version(Name|Code)|minSdk|targetSdk|applicationIdSuffix" app/build.gradle.kts`
- Append key values to report under "Config snapshot".

### Task 2: Build Debug APK

**Files:**
- Artifact: `app/build/outputs/apk/debug/app-debug.apk`

**Step 1:** Build.
- Run: `./gradlew assembleDebug`
- Expected: BUILD SUCCESSFUL.

**Step 2:** Record artifact path/size.
- Run: `du -h app/build/outputs/apk/debug/app-debug.apk`
- Append size/path to report.

### Task 3: Build Unsigned Release APK

**Files:**
- Artifact: `app/build/outputs/apk/release/app-release-unsigned.apk`

**Step 1:** Build.
- Run: `./gradlew assembleRelease`
- Expected: BUILD SUCCESSFUL; unsigned APK produced (no keystore required).

**Step 2:** Record artifact path/size.
- Run: `du -h app/build/outputs/apk/release/app-release-unsigned.apk`
- Append size/path to report.

### Task 4: Lint Pass (Debug)

**Files:**
- Report section: Lint findings in `docs/plans/2026-02-24-apk-audit-report.md`

**Step 1:** Run lint.
- Run: `./gradlew lintDebug`
- Expected: BUILD SUCCESSFUL; lint results under `app/build/reports/lint-results-debug.html`.

**Step 2:** Summarize top warnings.
- Open or grep HTML/text output; append brief bullet list of significant warnings to report.

### Task 5: Dependency Surface Snapshot

**Files:**
- Report section: Dependencies

**Step 1:** List runtime deps for release.
- Run: `./gradlew app:dependencies --configuration releaseRuntimeClasspath > /tmp/releaseRuntimeDeps.txt`
- Expected: command completes; file created.

**Step 2:** Summarize notable deps (networking, AI, analytics, heavy libs).
- Manually skim `/tmp/releaseRuntimeDeps.txt`; append concise bullets to report (no full tree dump).

### Task 6: APK Static Analysis (Debug & Release)

**Files:**
- Report section: APK analysis

**Step 1:** File summaries.
- Run: `apkanalyzer files summary app/build/outputs/apk/debug/app-debug.apk`
- Run: `apkanalyzer files summary app/build/outputs/apk/release/app-release-unsigned.apk`
- Append sizes/asset breakdown to report.

**Step 2:** Manifest inspection.
- Run: `aapt dump xmltree app/build/outputs/apk/release/app-release-unsigned.apk AndroidManifest.xml | head -n 200`
- Note permissions, exported components, allowBackup, usesCleartextTraffic, foreground service types; record findings.

**Step 3:** Dex/package counts.
- Run: `apkanalyzer dex packages app/build/outputs/apk/release/app-release-unsigned.apk | head -n 50`
- Record total package count and any large namespaces.

**Step 4:** Native libs.
- Run: `zipinfo app/build/outputs/apk/release/app-release-unsigned.apk "lib/*"`
- Record ABIs present (should be arm64-v8a, maybe armeabi-v7a) and largest libs.

### Task 7: ProGuard/R8 & Shrink Verification

**Files:**
- Report section: Shrink status

**Step 1:** Confirm shrink/minify settings.
- Inspect `app/build.gradle.kts` buildTypes (release: minifyEnabled true, shrinkResources true).
- Append confirmation to report.

**Step 2:** Check mapping/resources shrink outputs.
- Run: `ls -lh app/build/outputs/mapping/release || true`
- Run: `ls -lh app/build/outputs/apk/release/` to ensure `*-unsigned.apk` exists; note if `*-optimized` size looks reasonable.
- Append observations to report.

### Task 8: QA Report & Punch List

**Files:**
- `docs/plans/2026-02-24-apk-audit-report.md`

**Step 1:** Draft report.
- Structure: Summary (pass/fail), Blockers, Warnings, Observations, Artifacts, Next Steps.
- Include device scope (S22, Tab A9), artifact paths/sizes, key findings from manifest, lint, deps, shrink, native libs.

**Step 2:** Finalize punch list.
- Classify items: Blocker / Should / Nice-to-fix.
- Add any follow-up actions (e.g., cleartext allowance review, API key handling, backup flag).

### Task 9: Commit Plan & Report

**Files:**
- `docs/plans/2026-02-24-apk-audit-plan.md`
- `docs/plans/2026-02-24-apk-audit-report.md`

**Step 1:** Stage and commit.
- Run: `git add docs/plans/2026-02-24-apk-audit-plan.md docs/plans/2026-02-24-apk-audit-report.md`
- Run: `git commit -m "Add APK audit plan and report"`
- Expected: commit succeeds (only docs included).

### Task 10: Handoff

**Step 1:** Present summary + ask for execution mode.
- Offer: 1) Subagent-driven execution in this session (use subagent-driven-development). 2) Parallel session using executing-plans.
- Proceed based on user choice.
