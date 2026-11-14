"""Install the NF-e alert on the existing fiscal monitor."""

import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/opt/energetica-whatsapp/fiscal-collector")


def atomic(path, content, mode):
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as file:
            os.fchmod(file.fileno(), mode)
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, path)
        if shutil.which("restorecon"):
            subprocess.run(["restorecon", str(path)], check=True)
    finally:
        temporary.unlink(missing_ok=True)


def main():
    monitor = ROOT / "fiscal_monitor.py"
    module = ROOT / "nfe_gap_alert.py"
    payload = Path(sys.argv[1]).read_bytes()
    original = monitor.read_bytes()
    updated = original.decode()
    if "from nfe_gap_alert import update as update_nfe_gap_alert" not in updated:
        anchor = "    failed = publish_observations(monitor, observations, observation, now)\n"
        if updated.count(anchor) != 1:
            raise ValueError("Unexpected fiscal monitor layout")
        updated = updated.replace(anchor, anchor + """
    try:
        from nfe_gap_alert import update as update_nfe_gap_alert
        open_gaps = update_nfe_gap_alert(monitor, cursor_path.parent, config.get('initialResumeNsu', ''), now)
    except (RequestException, ValueError, OSError, KeyError, TypeError):
        failed.append('NFE-GAP-ALERT')
        open_gaps = None
    print(json.dumps({'nfeGapsOver12Hours': open_gaps, 'alertStatus': 'PUBLISHED' if open_gaps is not None else 'RETRY'}))
""")
    compile(updated, str(monitor), "exec")
    compile(payload, str(module), "exec")
    old_module = module.read_bytes() if module.is_file() else None
    backup = ROOT.parent / "backups" / ("nfe-gap-alert-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    backup.mkdir(mode=0o700)
    (backup / monitor.name).write_bytes(original)
    if old_module is not None:
        (backup / module.name).write_bytes(old_module)
    mode = stat.S_IMODE(monitor.stat().st_mode)
    try:
        atomic(module, payload, 0o644)
        atomic(monitor, updated.encode(), mode)
    except BaseException:
        atomic(monitor, original, mode)
        if old_module is None:
            module.unlink(missing_ok=True)
        else:
            atomic(module, old_module, 0o644)
        raise
    print(json.dumps({"installed": True, "backup": str(backup)}))


if __name__ == "__main__":
    main()
