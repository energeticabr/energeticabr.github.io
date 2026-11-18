# Stable report orientation implementation plan

> Execute inline using superpowers:executing-plans. The user requested execution and publication without another approval round.

**Goal:** Open reports and their native keyboard in landscape without the spinning transitions; keep HOME in portrait.

**Architecture:** Retain the shared native report lease and CSS browser fallback. Return explicitly to portrait instead of unlocking to the device sensor. Default native hosts to portrait. Wrap iOS supported-orientation updates in UIKit's documented nonanimated update; request Android jump-cut window rotations.

**Tech stack:** Capacitor 8, UIKit/iOS 16+, Android, Node tests and browser fixtures.

**Constraints:** Preserve all signature gesture lock blocks. Preserve native landscape keyboard, overlapping reports and navigation holds. No production Play/App Store release: publish web, Android internal and TestFlight.

**Review focus:** Rapid open/close during pending bridge calls; nested reports; portrait restoration while physically sideways; reentry from background without new locks; iPad/multitasking may deny native geometry and must retain CSS fallback.

### Task 1: Native report lifecycle and host transitions

- [ ] Update lifecycle regressions to expect explicit portrait restoration and verify they fail against the current unlock.
- [ ] Change `src/native/report-orientation.js` to lock portrait when the final report closes; preserve its serialization and transition holds.
- [ ] In `ios/App/App/EnergeticoBridgeViewController.swift`, start in portrait and override supported-orientation updates using `UIView.performWithoutAnimation`.
- [ ] In Android `MainActivity.java`, set `rotationAnimation` to `ROTATION_ANIMATION_JUMPCUT`; set initial `screenOrientation="portrait"` in the manifest.
- [ ] Run native orientation, report layout/navigation and typing regressions; run signature guard, iOS project verification and native/PWA builds. CI compiles native hosts and runs full app tests.
- [ ] Review diff, commit, create/merge PR and verify web plus internal Android and TestFlight publication for the merged revision.

Pre-flight: one task, no shared task interfaces. Native OS keyboard requires native landscape; portrait-only CSS would regress the user's explicit typing requirement. Nonanimated native updates preserve that requirement.
