# Document scanner

Add an explicit Escanear choice when the existing camera button is pressed. Ordinary photo capture remains available. iOS uses VisionKit's document camera; Android uses Google's ML Kit scanner with editable crop/preview. Windows/web (and unsupported native scanners) use a local four-corner editor, with perspective correction before confirmation. No cloud recognition, no upload before confirmation, no changes to signature gesture locks.

Confirmed pages become ordinary JPEG attachments through the existing ingestion queue. Cancellation creates no attachment. Native sessions are single-flight, bounded to 20 pages/60 MB, and release only scanner-owned temporary files after JS has read them. Unsupported scanners fall back to photo plus manual corner editing; permission and other errors remain visible. Web image processing is bounded to 2400 pixels on the longest edge. Corners support touch, mouse and keyboard, reject crossed/degenerate polygons, and offer reset/cancel/confirm plus corrected-image review.

The mode chooser belongs to the app, since system camera screens cannot accept an app-defined button. Native scan SDKs own detection and crop controls; the browser offers a best-effort light-page boundary suggestion and always permits manual adjustment. This is not OCR.

Verification: geometry/pixel fixtures, DOM interaction/cancellation/focus, real browser canvas export, controller queue and account guards, native output/lifecycle tests where executable, native compilations, existing full suites, unchanged signature guard, visible browser UI, and actual Pages/Play internal/TestFlight publication.
