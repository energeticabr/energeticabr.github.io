# SWILE RH weekly provisions — production verification

Verified 26 October 2026, 19:42 UTC. Existing native Power Automate flow
`4f9e855e-e603-46c5-bcef-82ec4b14ebe4` was updated in place. It is `Started`,
with a daily 06:00 Brasília recurrence beginning 27 October. Its original
SharePoint connection mapping is unchanged. The service added its normal
`evaluatedRecurrence` and removed the unused OneDrive reference; after those
normalizations, the complete live definition matches the reviewed definition.
No duplicate flow or VM/Codex schedule was created.

Canonical definition SHA256:
`1ed6cf48707c194f9900c8a0e555bd1b7cc2a3e2fa8d4c1ec64290d1d3e5e1e4`.

## Actual executions and coverage

- First native run `08584085635220118886508998227CU28`: **Succeeded**;
  source FUNCIONARIOSRH, six eligible suppliers, twelve children created.
- Second native run `08584085633300923300844220905CU28`: **Succeeded**;
  the same group and child IDs, zero children created.
- Complete independent SharePoint snapshots before and after the second run
  confirm zero changes to row contents or ETags in either financial list.

| Wednesday | SWILE descritivo | Individual provision IDs | Amount per supplier | Group total |
|---|---:|---|---:|---:|
| 28/10/2026 | 46 | 380–385 | R$225 | R$1,350 |
| 04/11/2026 | 47 | 386–391 | R$225 | R$1,350 |

All twelve child supplier names, branches, properties, date keys and parent
links were independently reread and compared with RH. Each stores QTD5,
unit45 and freight0. The user-configured exception is excluded by its origin
identity. Actual employee details and exception configuration remain private.
The native trigger maintains the inclusive rolling fourteen-day horizon;
future scheduled runs have not yet occurred at this receipt's timestamp.

## Legacy migration and preservation

The replacement was verified before legacy recurrence36 was conditionally set
to INATIVO. Exact unpaid children removed:336,339,341,348,353,379. Their six
exclusive, empty groups without attachments were removed:22,25,27,31,36,45.
There were no paid children from this recurrence in the initial snapshot.

The final independent diff confirms all 187 other pre-existing provisions,
all 38 other pre-existing parent groups and all 7 RH rows are unchanged. The
recurrence changed only STATUS and the expected editor/version timestamps.
No remaining unpaid source36 children were found. Final underlying counts:
199 child provisions and 40 parent groups.

The atomic private backup was persisted before inactivation/deletion and
retained on the backend server. SHA256:
`a2e5c23de73be8477ea4b32a833661a1a1639aafaa38660c7b994bb3017f74d5`.
No employee snapshots, journal, authentication material or attachment bytes
were committed. None of the six removed children had attachments.

## Validation and delivery

47 SWILE tests, 96 monthly regression tests and 23 previous weekly tests passed
locally. New regression cases cover strict backup versions, interrupted
cleanup, scheduling dates, manual account/OBS edits and real REST collection
versus singleton ETag formats. Independent branch and final adapter reviews
reported zero remaining actionable findings. The PR's automation contract
and signature-gesture checks passed on implementation commit4dea7916.

This change writes the existing shared sources used by Android, iOS and
Windows/PWA. It contains no mobile application or signature-gesture changes
and requires no additional native binary. The preceding report UI release
is separately published as Android1502, TestFlight1801 and Windows/PWA in
PR602. Main-branch publication checks are recorded in the final PR receipt.
