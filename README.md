# Frustration Assistant (Android)

An Android app that watches the apps **you** allow, detects signs of frustration
and glitches, and pops a floating suggestion over any app recommending
alternatives with similar content.

## What it does

1. **Asks for an access list** — `AllowListActivity` lists your installed apps;
   you tick the ones to monitor. Nothing outside that list is ever observed.
2. **Home-screen icon** — a normal launcher icon, plus a **draggable floating
   bubble** you can reach from inside any app.
3. **Detects frustration & problems** via an `AccessibilityService`:
   - rapid repeated tapping ("rage taps")
   - very fast scrolling
   - frantic up/down scroll reversals
   - rapid app-switching
   - a screen that freezes / stops responding while you keep interacting
     (glitch, stuck, overload)
4. **Remembers problems per app** (rolling log) so repeat issues are surfaced
   ("happened 4x recently in YouTube").
5. **Pops up over any app** with the reason + alternative app suggestions
   (`SuggestionEngine`).

## Hard platform limits (please read)

- **Cannot read other apps' history or content.** Android's sandbox forbids it.
  The Accessibility API only reports *events* (scrolled, clicked, window
  changed) — not screen text, and never other apps' browsing history. This is a
  security boundary, not a missing feature.
- **No true "tap pressure" / raw swipe velocity of other apps.** Android does
  not expose another app's touch pressure or gesture velocity. We infer the
  equivalents: rapid repeated clicks (harsh tapping) and fast/large scroll
  deltas (harsh swiping).
- **You must grant 3 permissions** for it to work: Display over other apps,
  the Accessibility service, and Usage access.

## Build & run

This is a Gradle/Android project. **VS Code can edit it, but you need the
Android SDK + Gradle to build it.** Android Studio is the smooth path.

### Option A — Android Studio (recommended)
1. Install Android Studio.
2. `File > Open` and select this `FrustrationBot` folder.
3. Let it sync Gradle (it will offer to add the missing `gradlew` wrapper — accept).
4. Plug in a device (USB debugging on) or start an emulator, then press Run.

### Option B — Command line
```bash
cd FrustrationBot
gradle wrapper --gradle-version 8.7   # generates gradlew (one time)
./gradlew assembleDebug               # Windows: gradlew.bat assembleDebug
# APK output: app/build/outputs/apk/debug/app-debug.apk
```
Requires `ANDROID_HOME` set to your Android SDK and JDK 17.

## First-run setup on the device
1. Open **Frustration Assistant** from the home screen.
2. Tap the three permission buttons and grant each one.
3. Tap **Choose apps to monitor** and tick the apps you want watched.
4. Tap **Start assistant**. The floating icon appears; use your apps normally.
   When frustration/glitch is detected, the suggestion card pops up.

## Key files
| File | Role |
|---|---|
| `MainActivity.kt` | Onboarding, permission checks, start/stop |
| `AllowListActivity.kt` | Pick which apps to monitor |
| `FrustrationAccessibilityService.kt` | Core detection (scroll/tap/switch/stuck) |
| `OverlayService.kt` | Floating icon + suggestion card over any app |
| `SuggestionEngine.kt` | App -> alternative-app mapping |
| `Prefs.kt` | Allow-list, toggles, rolling problem log |
| `res/xml/accessibility_service_config.xml` | Which events the service subscribes to |

## Tuning
- Sensitivity: thresholds in `FrustrationAccessibilityService` (`THRESHOLD`,
  the `bump(...)` amounts, velocity/reversal counts).
- Add more app alternatives in `SuggestionEngine.PACKAGE_ALTS`.
- Pop-up cooldown: `nudge()` uses a 20s guard so it never spams.

## Privacy
Everything stays on-device. No network calls, no analytics, no data leaves the
phone. The problem log is local and clearable from the main screen.
