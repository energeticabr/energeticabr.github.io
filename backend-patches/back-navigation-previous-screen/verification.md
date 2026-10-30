# Verification — 2026-10-30

Final scope: **worker/workflow.py only, three removed lines, two hunks**.
The first hunk removes Back's abandonment interception. The second preserves
the restored parent's embedded ancestor. No client or configuration changes
are included in this backend package.

## Test evidence

- Unchanged baseline: **14 tests, 10 expected failures**, no test errors.
- Two-line candidate: 13 focused navigation regressions passed; the added
  nested child -> parent -> ancestor regression failed because the ancestor
  return was removed. This justified the third removed line.
- Final candidate: **26 passed in 2.71s** (14 workflow and 12 installer tests).
- Final source parses; the private tar has exactly one regular member,
  `worker/workflow.py`, whose hash equals the candidate and manifest.
- `git diff --check` passed. No full frontend suite was run by this backend task.

Commands, with private test dependencies available to the interpreter:

```sh
# Baseline: unset BACK_NAVIGATION_WORKFLOW; expected failing regression run.
python -B backend-patches/back-navigation-previous-screen/tests/test_previous_screen.py -v

# Candidate: BACK_NAVIGATION_SOURCE is the code-only runtime; set
# BACK_NAVIGATION_WORKFLOW to private candidate/worker/workflow.py.
python -B -m pytest -q -p no:cacheprovider backend-patches/back-navigation-previous-screen/tests
```

Read the explicit fixture limitation in README.md: two freight helpers absent
from the copied baseline are replaced only for non-provision test flows.
Navigation and state-restoration mechanisms are unmodified in the harness.
There is no claim of full-runtime validation or an independently dispatched
review. The package/installer contract was separately inspected in this session.

## Reviewed installer contract

Exact file allowlist in builder and installer; fixed stage path; manifest,
patch, private tar and shared-runner pins; independent production/mirror source
pins; archive path/type/hash restrictions; source compilation; deployment lock;
verified per-root backups; atomic replacement; health checks; rollback retaining
concurrent foreign changes. Fake-root tests cover successful and failed install,
drift, malformed manifest/bundle, cached assembly, and check-only behavior.

No remote --check/--deploy, upload, service restart or real record/state write
was performed. Read-only SSH confirmed the baseline SHA in both source roots.
No commit was made; concurrent frontend changes belong to the other workers.

## Package hashes (SHA256)

| Artifact | SHA256 |
| --- | --- |
| Production and mirror before | `9d208eda2c53e05f6f5e098b911320d5fe9f98b0de85cc2831ef1a8a993403c1` |
| workflow.py after | `34b86edb93cbfe553fbf60e6931ef2f27abe4a97b9f4db475125ceeb8a0ada12` |
| source.patch | `cf9e1aa150901ab5de8d70d0241e17ee51e768a9c39b3d2cf85478573c6b3cbb` |
| Private source-files.tar | `63795c38b0939697f3b704767dd33dcd835902373f6184a268a0054772659bea` |
| deploy-manifest.json | `9a2f8ad9b4344e988e6988a0f77ec5f7daf3593090a285762db22b07e2107738` |
| deploy.py | `25f4f3d7c108617cee4c2da718db89b9ad31a759298ab094aa9cfd128f3d3acc` |
| shared-deploy.py | `01d979e4e9d525d35ab522e017d3454be75514f4fc42a1274cc89e7b0a21bbe2` |

Private package directory:
`work/back-navigation-20261030/package` under the abr workspace. Deploy stage:
`/home/opc/back-navigation-20261030/package`.

The final remote verification/deployment commands for the release owner are:

```sh
sudo python3 deploy.py --check 9a2f8ad9b4344e988e6988a0f77ec5f7daf3593090a285762db22b07e2107738
sudo python3 deploy.py --deploy 9a2f8ad9b4344e988e6988a0f77ec5f7daf3593090a285762db22b07e2107738
```

## Deployment confirmation

The release owner ran `--check`, then deployed on 2026-10-30 at 03:34:09 UTC.
Both runtime roots returned the reviewed after hash
`34b86edb93cbfe553fbf60e6931ef2f27abe4a97b9f4db475125ceeb8a0ada12`.
Both bridge/channel services were active and the health endpoint returned `ok`.
The verified backup is
`/var/backups/energetica-whatsapp/back-navigation-previous-screen-20261030T033409203163Z`.
The main release owner independently reran all 26 isolated tests successfully.
No production conversation, SharePoint item or document was used for testing.
