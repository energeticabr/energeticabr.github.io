# Scanner publication reliability follow-up

The scanner app is implemented, reviewed, merged (PR564, e158fd7b) and live on Windows/web. Android publication failed in an unchanged legacy browser test: launch-gallery-total-layout.test.mjs reads DevToolsActivePort as soon as the file exists and constructs a WebSocket before both lines exist. iOS Intel simulator boot repeatedly times out in LaunchServicesMigrator. This follow-up changes test/CI infrastructure only; app, native scanner and signature source stay byte-identical.

## Task 1: Correct browser endpoint readiness

1. RED: tests for port-only/partial/invalid endpoints, real temporary file completed asynchronously, and process exit/timeout.
2. Extract shared strict endpoint parser and bounded waiter; reuse the parser in the existing browser runner, use the waiter in the failing legacy layout test. Do not remove layout assertions or skip browser tests.
3. GREEN: new tests, existing browser runner tests and the actual launch layout test. Then full root suite and signature guard.

## Task 2: Verify and use a supported simulator runner if needed

The diagnostic branch executes the unchanged18-case verify-native-share-preview.mjs on macos-26 ARM. Require real PASS evidence before changing native-share-tests from Intel to ARM; the script already supports this architecture. Remove the temporary diagnostic workflow from the final diff, retaining its run/artifact evidence. Do not modify native guards or cases.

## Task 3: Review and integrate infrastructure fix, complete publication

Fresh read-only review of this follow-up diff only (base e158fd7b). Verify full root suite, real Chrome layout and ARM18-case execution. App/native SDK compilation evidence from PR564 remains valid for unchanged payload; automated main pipeline still compiles everything before upload. Respect required branch checks; do not bypass policy or upload twice. Merge through GitHub API, verify app payload unchanged and follow Windows/web, Android internal and TestFlight to actual completion.

Review focus: partial file readiness, bounded polling/process exit, no loose endpoint acceptance, unchanged layout assertions, no weakening of native guard, same app payload, and safe retry before any store upload.
