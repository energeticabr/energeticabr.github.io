# iOS PDF selection implementation plan

**Goal:** Select individual words and payment digits inside the attachment PDF with the iPhone long-press gesture.

**Architecture:** Keep the shared PDF.js renderer and reproduce selection using a native WKWebView and XCTest touch input. Determine the smallest correction from the native result before changing production behavior.

**Tech stack:** PDF.js 6, Capacitor 8, WKWebView, XCTest, Vite.

**Constraints:** Synthetic documents only in source and CI; preserve signature gesture locks; preserve zoom, navigation, attachments and export; publish applicable changes to Windows web, internal Android and TestFlight.

- [ ] Reproduce the failure in an iPhone simulator with the actual attachment component and trusted long press; record the selected node and text.
- [ ] Add a regression and the narrowest correction supported by the reproduction.
- [ ] Run focused tests, signature guard, complete validation and independent review.
- [ ] Publish and verify web assets, Android internal release and TestFlight group availability.
