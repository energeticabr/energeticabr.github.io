# Trancid combined report publication

`file_sync.py` is the deployed monitor publisher. It adds the private file
`Documents/TRANCID/report_snapshot.json` with metadata and the complete
`positions`/`runs` arrays. The only omitted SQLite column is `sharepoint_id`.
Successful `runs.snapshot` values remain JSON strings; failures remain present.

A SQLite savepoint holds one read transaction across both tables, then releases
before PDF generation/database backup. The local combined JSON replaces its
previous version atomically and is uploaded as one complete file. The publisher
downloads every uploaded file and compares SHA256 hashes before reporting success.
The four existing publications, database meanings, login and daily timer are kept.

`test_file_sync.py` adds three standard-library tests. Copy it beside the existing
monitor modules and run `python -m unittest discover -v`: the complete monitor
suite contains 19 passing tests locally and on the VM. The concurrent-writer test
uses a real WAL-mode SQLite database and a second committed connection between
the two table reads. It first failed without the read transaction.

`deploy_snapshot.py` deployed only the publisher, under the collector lock, after
checking its known baseline SHA256 twice. It preserved owner/group/mode, created
a verified backup and atomically replaced the target. It intentionally refuses
an already changed baseline or existing backup/staging files; do not blindly
rerun it against an updated installation.

Publication used only `env_run.py run.py sync`, which performs no Trancid scrape.
`verify_snapshot.py`, run through the protected environment loader, performs only
SharePoint GETs and read-only SQLite checks; it prints counts and hashes only.
`verification.json` contains the sanitized deployment/publication evidence.

The timer remains enabled and active at 18:00 America/Sao_Paulo daily. No service,
credential, permission, or login configuration was changed.
