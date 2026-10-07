# Pending Supplier Payments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Add and publish the supplied pink supplier-payment report above pending diaries.
**Architecture:** Strict three-list readonly source, focused pure financial model, standalone report view integrated with existing controller/nav/print/auth. Disjoint model/data and view workers can operate alongside main controller integration.
**Tech Stack:** JavaScript, Graph SharePoint, Decimal.js, node:test/JSDOM, Vite/Capacitor.
**Spec:** docs/superpowers/specs/2026-10-07-pending-supplier-payments-design.md

## Global Constraints

Sites.Read.All; no business mutations; 14 signature blocks untouched; same revision releases to web/Windows, Play internal and TestFlight. Existing keyboard-aware searchable filters. Both content side margins reserved.

## Review Focus

- Cross-branch duplicate supplier names must not double-count debts.
- Missing or malformed money must not look like zero; decimal totals remain exact.
- Old unpaid dates remain visible when the period changes; detail still filters inclusively.
- Broken pagination/schema/auth must not leak partial or stale report/PDF.
- Landscape mobile keyboard, arrows and PDF return must preserve readable data.

### Task 1: Complete financial report

**Files:** new src/chat/pending-supplier-payments-report-{data,model}.js; src/ui/pending-supplier-payments-report-{view.js,css}; corresponding tests. Integrate src/app-controller.js, ui/chat-view.js, ui/report-navigation.js, ui/report-print.js, web/browser-auth.js, both main.js entries, styles.css; assets/report-mascots/pending-supplier-payments.png.

**Interfaces:** createPendingSupplierPaymentsReportData({tokenProvider,repository}) returns loadSnapshot({signal}) → {complete:true,suppliers,presences,launches}; normalized fields follow rh-reports-model.js. buildPendingSupplierPaymentsReport(snapshot,filters={},today=localDate) → {pending,details,approvedTotal,validationTotal,total}; rows follow existing buildRhReport5 contract but add pendingValidationValue/pendingTotalValue distinct from general validationValue/totalValue. createPendingSupplierPaymentsReportView({document,data,onClose,now}) → {element,open,close,destroy}.

- [ ] Write model/data tests for formula semantics, malformed amounts, ambiguity, >2000 rows, cursor/partial/auth cancellation; run and observe RED.
- [ ] Implement strict source and Decimal model; run tests GREEN.
- [ ] Write view/integration tests for defaults, searchable options, safe DOM, filtered detail, both navigation arrows, full PDF tables and cancellation; observe RED.
- [ ] Implement report + mascot + lifecycle/action integration and responsive margins; focused tests GREEN.
- [ ] Run pnpm test, root node --test tests/*.test.*, native/PWA builds and all guards. Expected: no failures.
- [ ] Fresh review whole branch; Important/Critical findings one TDD fix pass, full suite green; commit explicit task files.
- [ ] Push/PR/attach/checks/merge exact head; monitor all three automatic release workflows. Expected: Pages deployed, Play edit committed internal, TestFlight VALID and ATTACHED.
- [ ] Open published report; verify current-month/ATIVO defaults, dates and amounts, filter detail, previous/next, PDF forwarding control and close-return. Save live screenshot; no business writes.
