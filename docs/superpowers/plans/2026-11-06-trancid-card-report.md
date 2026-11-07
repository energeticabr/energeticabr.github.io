# Trancid Card Report Implementation Plan

> **For agentic workers:** Use independent scoped agents for UI, data/model, and VM snapshot publication; root integrates controller and release. User explicitly requested execution without intermediate approval.

**Goal:** Add the Energético mascot with a bus below the supplier payroll mascot, opening a card balance report with monthly daily history and an automatic warning below R$ 40.

**Architecture:** The OCI daily collector remains the only Trancid scraper. It atomically publishes one authenticated SharePoint JSON snapshot containing positions and execution records. The app reads it with its existing Microsoft session, derives recorded daily balances, and displays a responsive dialog. No Trancid credentials enter the app or repository.

**Tech Stack:** Existing Vite/Capacitor JavaScript app, Microsoft Graph authenticated file access, existing Python/SQLite OCI monitor.

## Global Constraints

- Preserve all 14 protected signature gesture blocks. Guard before/after.
- DATA selects month and year; history contains at most the chosen month.
- Display supplier/card holder name from the Trancid employee field, all 14 card digits and current balance.
- Low threshold is strict `< 4000` cents; 4000 is not low. Apply red to low balances, including zero.
- Daily history comes from successful run snapshots, including unchanged days. A gap is not a zero or a zero variation. Compare with the previous calendar day only when it was observed, even across month boundaries.
- Current balance/low alert are independent of selected historical month.
- Auto-open once per app foreground/launch, defer while editing, drafts, uploads or another dialog are active; logout/account changes cancel stale requests.
- Keep the official lightning silhouette: continuous straight left head edge, canonical notch only on the right.
- Validate fictional data at 320/390 px. Publish web/Windows, Google Play internal and iOS TestFlight for the same reviewed revision.

## Interfaces and tasks

- [x] VM: publish `Documents/TRANCID/report_snapshot.json` as `{schema_version:1,currency:'BRL',money_unit:'centavos',positions:[...],runs:[...]}`. Existing SQLite fields retain their names. Never include credentials. Verify the uploaded bytes.
- [x] Data/model: `createTrancidReportData({tokenProvider,fetchImpl?}).loadSnapshot({signal?})` returns a validated snapshot. `buildTrancidReport(snapshot,{month:'YYYY-MM',now?})` returns `{month,months,lastCheckedAt,lastError,cards,totalCents,lowCount}`; each card is `{card,supplier,balanceCents,low,observedAt,history:[{date,balanceCents,variationCents,status,checkedAt}]}`. Missing comparison is `null`; failures/absent days use unavailable balance and status.
- [x] UI: `createTrancidReportView({document:doc,loadReport,onClose?})` returns `{element,open({initialSnapshot?,automatic?}={}),close,destroy}`. It uses `loadReport({month,signal,refresh})` returning the report above. Month/year selectors and card details preserve open state and do not navigate the chat.
- [x] Root: wire lazy factories, authenticated loading, cancellation, mascot navigation and foreground/session alert lifecycle. Reuse existing report guards and overlay behavior.
- [ ] Validation: focused tests, source guard, narrow screenshots, native/PWA builds, full suite and independent review; deploy the VM snapshot publisher, merge and verify each published target separately.

## Review Focus

- Missing or malformed financial data must never become zero or trigger a false low balance.
- Prior-calendar-day gaps and month boundaries must not invent variations.
- Authentication changes and aborts must not display prior-account data.
- Manual dismissal must not cause an immediate auto-open loop.
- Background low balance checks must not replace an editor or another report.

## Validation ledger

- Corrected the bus mascot from the canonical reference: continuous left head edge, right-side notch retained; transparent project asset `assets/report-mascots/trancid-cards.png`.
- Native/PWA builds passed; actual PWA bundle includes the report CSS and enabled foreground warning. Signature guard: 14 intact; iOS project and staged-files secret scan passed.
- Independent review found and fixed repeated failed daily slots, missing web entry integration, AUTH_REQUIRED redirect resume and a dropped warning after typing during loading. Added regressions for all paths; review after fixes found no remaining Critical/Important issue.
- Additional controller regressions: double tap coalescing, late factory cancellation, and deferred warning resumes after another dialog closes.
- VM publisher: 19 tests passed again locally. Live private download returned HTTP200 without redirect, Access-Control-Allow-Origin:* for web, Android and iOS origins; URL stayed in authorized personal SharePoint site. Real six-run export validated with four current cards.
- Windows full suite encountered unrelated existing attachment browser page-load timeouts while a separate workspace was also testing. Scoped browser and non-browser checks are being verified separately; full Linux CI remains a release gate.
- Publication is authorized to web/Windows, Google Play internal and iOS TestFlight. No production Play or App Store review.

## Final mascot edit prompt

Built-in image generation tool, transparent background. Edit target: bus mascot; reference: canonical Energético mascot. Final asset: `assets/report-mascots/trancid-cards.png`.

Use case: precise-object-edit. Image 1 is the EDIT TARGET: the Energético mascot holding a transport card, bus behind him, transparent canvas. Image 2 is the OFFICIAL CHARACTER SHAPE REFERENCE ONLY. The user says the yellow lightning bolt has been deformed and must NOT have zigzag breaks on its LEFT side. Correct ONLY the outline and shape of the yellow lightning-bolt head in Image 1 to match the official yellow head silhouette in Image 2. In particular, the VIEWER'S LEFT edge of the yellow head must be ONE straight, continuous slanted edge from immediately below the helmet brim down to the lower-left shoulder point, exactly like Image 2: NO notches, NO stair steps, NO teeth, NO extra lightning bends on the left edge. Retain the canonical lightning notch ONLY on the VIEWER'S RIGHT edge. Make the official asymmetrical lightning shape unmistakable, not a symmetric thunderbolt. Keep the rest of Image 1 unchanged: same face expression and placement, orange helmet, body, clothes, arms, hands, card, pose, bus size and position, colors, outlines and overall composition. Keep actual transparency. Do not add text, watermark, tile or background.
