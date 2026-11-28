"""Read confirmed collector receipts and atomically publish their latest times."""
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path
import subprocess
from tempfile import NamedTemporaryFile

from financial_report_updates import RECEIPTS, STATE, confirmed_time, read_state


FISCAL_DATA = STATE.parent.parent / "fiscal-local" / "Energetica"
FISCAL_CONFIG = Path("/opt/energetica-whatsapp/fiscal-collector/config/energetica.json")
AUX_LOG_TAIL = 256 * 1024


def read_object(line):
    try:
        value = json.loads(line)
        return value if isinstance(value, dict) else {}
    except (ValueError, TypeError):
        return {}


def dda_completion(lines, now):
    latest = None
    for line in lines:
        entry = read_object(line)
        receipt = read_object(entry.get("MESSAGE"))
        if receipt.get("origin") not in ("Scheduled", "Manual") or receipt.get("status") != "succeeded":
            continue
        created, updated, verified = (receipt.get(key) for key in ("created", "updated", "verified"))
        if any(type(count) is not int or count < 0 for count in (created, updated, verified)):
            continue
        if receipt.get("failed") != 0 or verified != created + updated:
            continue
        try:
            stamp = datetime.fromtimestamp(int(entry["__REALTIME_TIMESTAMP"]) / 10**6, timezone.utc)
        except (KeyError, ValueError, TypeError, OverflowError, OSError):
            continue
        if stamp <= now and (latest is None or stamp > latest):
            latest = stamp
    return latest


def recent_events(path):
    try:
        with path.open("rb") as log:
            size = log.seek(0, os.SEEK_END)
            log.seek(max(0, size - AUX_LOG_TAIL))
            if size > AUX_LOG_TAIL:
                log.readline()
            entries = log.read(AUX_LOG_TAIL).splitlines()
    except OSError:
        return
    for line in entries:
        yield read_object(line)


def auxiliary_completions(path, source, now):
    for event in recent_events(path):
        if event.get("source") != source:
            continue
        code = event.get("code")
        count = event.get("documents")
        if code == "SLOT_COMPLETED" or (code == "DELIVERY_CONFIRMED" and type(count) is int and count > 0):
            stamp = confirmed_time(event.get("timestamp"), now)
            if stamp is not None:
                yield stamp


def nfe_deliveries(logs, now):
    # This directory is written by the production NF-e worker for this configuration.
    for path in sorted(logs.glob("worker-*.jsonl"), reverse=True)[:2]:
        for event in recent_events(path):
            count = event.get("documents")
            if event.get("status") in ("ACKNOWLEDGED", "OUTBOX_DRAINED") and type(count) is int and count > 0:
                stamp = confirmed_time(event.get("at"), now)
                if stamp is not None:
                    yield stamp


def fiscal_completion(root, now, config=FISCAL_CONFIG):
    settings = read_state(config)
    cnpj = settings.get("companyCnpj")
    if not isinstance(cnpj, str) or re.fullmatch(r"[0-9]{14}", cnpj) is None or str(settings.get("environment")) != "1":
        return None
    company = f"{cnpj}-1"
    stamps = list(nfe_deliveries(root / "SefazLive" / "logs", now))
    receipt = read_state(root / "SefazLive" / company / "completed-collection.json")
    if (receipt.get("version") == 2 and receipt.get("coverageVerified") is True
            and receipt.get("status") == "COMPLETED" and receipt.get("responseStatus") in ("137", "138")):
        stamp = confirmed_time(receipt.get("completedAt"), now)
        if stamp is not None:
            stamps.append(stamp)
    for source in ("CTE", "NFSE"):
        path = root / "SefazAuxLive" / company / source / "logs" / "worker.jsonl"
        stamps.extend(auxiliary_completions(path, source, now))
    return max(stamps, default=None)


def publish(path, updates, now):
    previous = read_state(path)
    next_state = {}
    for report in RECEIPTS:
        stamps = (confirmed_time(previous.get(report), now), updates.get(report))
        latest = max((stamp for stamp in stamps if stamp is not None), default=None)
        if latest is not None:
            next_state[report] = latest.isoformat()
    if next_state == previous:
        return

    candidate = None
    try:
        with NamedTemporaryFile(dir=path.parent, mode="w", encoding="utf-8", delete=False) as output:
            candidate = Path(output.name)
            json.dump(next_state, output)
            output.flush()
            os.fsync(output.fileno())
            candidate.chmod(0o644)
        os.replace(candidate, path)
    finally:
        if candidate is not None:
            candidate.unlink(missing_ok=True)


def main():
    now = datetime.now(timezone.utc)
    fiscal = fiscal_completion(FISCAL_DATA, now)
    try:
        journal = subprocess.run([
            "journalctl", "-u", "energetica-dda-collector.service", "-u", "energetica-dda-requests.service",
            "--since=-7days", "--no-pager", "-o", "json", "--output-fields=MESSAGE",
            "-n", "500", "_COMM=python3",
        ], check=True, stdout=subprocess.PIPE, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        publish(STATE, {"fiscal": fiscal}, now)
        raise
    publish(STATE, {"dda": dda_completion(journal.stdout.splitlines(), now), "fiscal": fiscal}, now)


if __name__ == "__main__":
    main()
