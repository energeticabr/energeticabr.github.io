"""Accept a healthy source installed by another verified shared deployment."""

import json
import os
from pathlib import Path
import re
import stat
import sys


BACKUPS = Path("/var/backups/energetica-whatsapp")
TARGET = "/opt/energetica-whatsapp/worker/workflow.py"


def trusted_directory(path):
    try:
        info = path.lstat()
    except OSError:
        return None
    if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
            or stat.S_IMODE(info.st_mode) & 0o022):
        return False
    return True


def trusted_json(path):
    try:
        relative = path.relative_to(BACKUPS)
    except ValueError:
        return None
    if not trusted_directory(BACKUPS):
        return None
    parent = BACKUPS
    for part in relative.parts[:-1]:
        parent = parent / part
        if not trusted_directory(parent):
            return None
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(descriptor)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) & 0o022):
            return None
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = None
            return json.loads(stream.read().decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def main(expected):
    if not trusted_directory(BACKUPS):
        return 1
    for receipt_path in BACKUPS.rglob("receipt.json"):
        if receipt_path.is_symlink():
            continue
        receipt = trusted_json(receipt_path)
        if not isinstance(receipt, dict):
            continue
        after = receipt.get("after")
        health = receipt.get("health")
        if (receipt.get("status") == "deployed" and isinstance(after, dict)
                and after.get(TARGET) == expected and isinstance(health, dict)
                and health.get("status") == "ok"):
            return 0
        if receipt.get("status") == "rolled_back" and receipt.get("errors") == []:
            before = trusted_json(receipt_path.parent / "before.json")
            if isinstance(before, dict) and before.get(TARGET) == expected:
                return 0
    return 1


if __name__ == "__main__":
    if len(sys.argv) != 2 or not re.fullmatch(r"[0-9a-f]{64}", sys.argv[1]):
        raise SystemExit("Usage: verify_successor.py live_source_sha256")
    raise SystemExit(main(sys.argv[1]))
