# DDA report PDF readiness

Reproduced the user's 99% overlay with the real DDA report, PDF generator and viewer in Chrome and WebKit (iPhone emulation). A brief initial canvas check passed, but waiting for settled rendering showed the loader reappear permanently. Initial rendering starts an unawaited viewport refit, clears canvases and resolves readiness too early. The attachment viewer sees no rendered pages; the subsequent progress callback restores the loader with no remaining completion observer.

Fix: chain refit completion into the initial readiness promise, including the windowed page path. Preserve cancellation, page errors and existing resize behavior. Add an end-to-end printer regression that checks the settled preview, rotation and returning to the report. Validate PDF/attachment suites, browser rendering, signature guard, PWA build and independent review. Publish web, Android internal and TestFlight.
