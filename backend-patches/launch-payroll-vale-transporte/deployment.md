# Verified deployment pins

- Original `worker/workflow.py` in both VM roots: `c4fd1a32cce1da04f2c03f838f7a2d053a6a966f672ba9e5b15058e8435b82c2`.
- Candidate in both VM staged roots: `c064da3e06afece45e8ea16b4d1aa05d7ed506b5572b7208dc9be9987c7daf54`.
- Staging directory: `/home/opc/launch-payroll-transport-20261004-2108`.
- The supplied fixture explicitly prioritizes `worker/` imports, preventing an older build-root compatibility module from being tested accidentally.
- Backups for both roots are preserved under the staging directory's `backup/` after apply.
