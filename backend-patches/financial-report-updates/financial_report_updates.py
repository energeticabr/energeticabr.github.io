"""Publish only the confirmed time to each already-authorized report."""
from datetime import datetime, timezone
import json
import re
from pathlib import Path


STATE = Path("/var/lib/energetica-whatsapp/financial-report-updates/latest.json")
RECEIPTS = {"dda": "ddaRefresh", "fiscal": "sefazRefresh"}


def read_state(path):
    try:
        with path.open(encoding="utf-8-sig") as source:
            state = json.load(source)
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def confirmed_time(value, now):
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})", value)
    if not match:
        return None
    seconds, fraction, offset = match.groups()
    # PowerShell receipts have seven fractional digits. Python 3.9 accepts six.
    microseconds = (fraction or "").ljust(6, "0")[:6]
    try:
        stamp = datetime.fromisoformat(f"{seconds}.{microseconds}{'+00:00' if offset == 'Z' else offset}")
        if stamp <= now:
            return stamp.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        pass
    return None


def add_report_update(result, report, path=STATE):
    receipt = result.get(RECEIPTS[report])
    if isinstance(receipt, dict) and receipt.get("status") == "pending":
        stamp = confirmed_time(read_state(path).get(report), datetime.now(timezone.utc))
        if stamp is not None:
            receipt["lastReportUpdateUtc"] = stamp.isoformat()
    return result
