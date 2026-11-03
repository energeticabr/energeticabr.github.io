# Verification record

## Scope and provenance

- Production baseline `worker/workflow.py`: `34cbde67abb132f480df0c89a19246719c722342937f0106954d478d218f5250`.
- Candidate, reproduced from the baseline by the public patcher: `e653b998ee8c5c9281631ed5f55a9f1033c0fb900c76ee2984d1158e97f96da2`.
- Production configuration remains `e72f874a925a2155906009dddb549131ceeb91d26071d3977a44330b22a6b4a3`.
- Divergent mirror remains `b4d024e0ef0fb578df0c24198c516efd7f106ba7af5fb1852fa9e1c567985106`; it is deliberately read-only.
- No business records, attachments or conversation files were edited during verification. All submission tests use in-memory SharePoint fixtures.

## Behavioral and platform checks

- New question first reproduced as a failing test against the baseline; the baseline offered the old pending-provision warning immediately and had no separate order supplier.
- 14 feature tests pass on Windows and Linux, including real ChannelBridge replies, numeric/full-name filters, clearing and empty results, a supplier outside the visible page, old control rejection, Back, resume, scopes, summary, separate order/launch payloads, contractor eligibility and original-supplier IDFOLHA.
- 37 installer tests pass on Linux, zero skips. Windows: 33 pass, four Unix-specific tests skipped and subsequently covered on Linux.
- Actual app store and renderer receive synthetic real-channel packets. Six Chrome views pass: confirm/select at 320, 390 and 1200 pixels. No horizontal overflow, enabled filter input, correct reply commands and touch targets at least 44 pixels. The 320px confirmation and 390px selection screenshots were inspected visually.
- Signature guard before and after: 14 protected blocks intact. No app source or native project files are changed by this package.

## Existing full-suite failures

The private production snapshot plus build-mirror test fixtures was tested with the same full command before and after the patch:

```text
python -B -m unittest discover -s tests -v
Baseline:  2210 tests, 1267 failures, 140 errors, 3 skipped
Candidate: 2210 tests, 1267 failures, 140 errors, 3 skipped
New failing/error test names: 0
Resolved failing/error test names: 0
```

The full legacy suite is **not green**. Its 1407 failing/error test names are identical on both revisions. The historical menu-driving test `WorkflowTests.test_single_launch_warns_about_supplier_pending_provisions`, for example, already fails before the change at `pedido_lancamento` because its legacy navigation does not reach the current supplier question. The focused tests seed the real active workflow state and exercise the actual new path, including complete synthetic submission and portal replies. No unrelated production behavior was changed to satisfy obsolete fixture expectations.

Private complete logs, exact failure-name comparison, exported synthetic packets and screenshots are retained in the task's isolated working directory. They contain no production financial write operations.

## Publication

The shared backend release is intended for the existing Android, iOS and Windows/web clients. The independent installed-hash and health receipt is recorded here after installation; a successful local test or preflight alone is not a publication claim.
