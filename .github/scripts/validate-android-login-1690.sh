#!/usr/bin/env bash
set -euo pipefail

adb logcat -b events -d -s am_anr
adb shell am force-stop com.google.android.apps.nexuslauncher
chmod +x ./gradlew
test_status=0
./gradlew :app:connectedDebugAndroidTest --no-daemon || test_status=$?
adb logcat -b events -d -s am_anr || true
exit "$test_status"
