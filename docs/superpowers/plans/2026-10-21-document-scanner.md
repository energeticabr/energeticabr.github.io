# Document scanner implementation plan

Spec: docs/superpowers/specs/2026-10-21-document-scanner.md
Execution: inline, using executing-plans and TDD; user has already authorized implementation and publication.

## Global constraints

Use the already-isolated clean worktree and feat/document-scanner-20261021 (base bb086066). Preserve the dirty main checkout and all 14 signature locks. No fiscal/personal sample uploads. Synthetic fixtures only. JPEG pages use existing attachment policies; no server deployment needed. Publish web/Windows, Android internal and iOS TestFlight, never production store review.

## Task 1: Local scanner and camera choice

Interfaces: createCameraChooser(documentRef) -> {choose,destroy}; editDocumentScan(File,options) -> File|null; rectifyDocument(ImageData,corners) -> ImageData-like pixels. Corners normalized clockwise TL,TR,BR,BL.

1. Add failing behavioral tests for convex-corner validation, synthetic perspective pixels, light-page suggestions, chooser cancellation/focus, editor confirmation/cancel/review.
2. Run focused tests; Expected: new contracts absent/failing.
3. Implement bounded pure geometry, local canvas editor, accessible dialog and styles.
4. Run focused tests; Expected: all pass. Commit task.

## Task 2: Native scanners and ports

Interfaces: DocumentScanner.scan() -> {id,items:[{id,uri,name,size,type}]}; release({id}) -> scanner-owned session cleanup. Native/browser scanDocument() -> File[]. Reuse existing capturePhoto().

1. Add failing native/browser port tests for cancellation, output validation, cleanup on errors, unsupported fallback and permissions.
2. Run tests; Expected: scanDocument absent/failing.
3. Add VisionKit plugin + project membership/registration. Add ML Kit 16.0.0 (current official release) plugin with AndroidX result launcher registered during load, JPEG-only output, bounded cache, lifecycle cleanup and registration. Check dependency AAR for native libs rather than assuming a closed third-party issue is true.
4. Add port methods and cleanup. Run focused tests and ios:verify/secrets:verify; Expected: pass. Native compile in CI. Commit task.

## Task 3: App integration and publication

Interfaces: view.chooseCaptureMode() -> photo|scan|null; controller camera action selects port once, guards duplicate launches, queueSelectedFiles preserves account guard.

1. Add failing real view/controller tests: camera opens choices; Escanear routes scan, ordinary photo unchanged, cancel no upload, double clicks single operation, errors visible.
2. Implement integration outside locked signature blocks. Run focused tests; Expected: pass.
3. Run full root/app suite, signature guard, builds and native CI; Expected: no regressions.
4. Browser QA with synthetic page; independent fresh whole-branch reviewer. Fix important findings RED/GREEN then full suite. PR, merge, verify all three releases and visible deployed app. Commit task.

## Review focus

Confirm no upload before scan confirmation; cancellation/session changes cannot upload stale files. No accidental source-file deletion. Camera permission failure, unavailable Play services, simulator unsupported, activity recreation, repeated clicks, oversized/native invalid result, image decode failure, crossed corners, device rotation and touch/keyboard accessibility. Native SDK compile and source membership. Real canvas export and corrected preview, no source-grep-only substitute for executable tests.
