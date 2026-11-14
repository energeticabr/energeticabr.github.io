"""Publish NF-e gaps that remain open for more than 12 hours."""

import json
import re
from datetime import datetime, timedelta
from hashlib import sha256
from zoneinfo import ZoneInfo

PREFIX = "NFE-LACUNA-"
BOUNDS = re.compile(r"(\d{15})-(\d{15})")
BRASILIA = ZoneInfo("America/Sao_Paulo")
MINIMUM_AGE = timedelta(hours=12)


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def settled_points(company):
    settled = set()
    for path in (company / "history-gap-receipts").glob("*.json"):
        nsu = path.stem
        if not re.fullmatch(r"\d{15}", nsu):
            continue
        point = read(path)
        if point.get("nsu") != nsu:
            continue
        raw_file = point.get("rawFile", "")
        if not re.fullmatch(nsu + r"-[a-f0-9]{32}\.xml", raw_file):
            continue
        raw = company / "history-gap-raw" / raw_file
        if not raw.is_file() or sha256(raw.read_bytes()).hexdigest() != point.get("sha256"):
            continue
        if point.get("status") == "137":
            settled.add(int(nsu))
        document = point.get("documentId", "")
        if (point.get("status") == "138" and re.fullmatch(nsu + r"-[a-f0-9]{16}", document)
                and any((company / folder / f"{document}.json").is_file()
                        for folder in ("archive", "scope-excluded"))):
            settled.add(int(nsu))
    return settled


def pending_description(start, end, settled):
    intervals = []
    cursor = start + 1
    for number in sorted(n for n in settled if start < n <= end):
        if number > cursor:
            intervals.append((cursor, number - 1))
        cursor = number + 1
    if cursor <= end:
        intervals.append((cursor, end))
    return ", ".join(f"NSU {first}" if first == last else f"NSUs {first} a {last}"
                     for first, last in intervals)


def observations(company, initial_resume, now):
    points = settled_points(company)
    records = []
    for path in sorted((company / "history-gaps").glob("*.json")):
        match = BOUNDS.fullmatch(path.stem)
        if not match:
            continue
        start_text, end_text = match.groups()
        gap = read(path)
        start, end = int(start_text), int(end_text)
        if (gap.get("source") != "SEFAZ" or gap.get("fromExclusive") != start_text
                or gap.get("throughInclusive") != end_text or start >= end):
            raise ValueError(f"Invalid fiscal gap {path.stem}")
        if (gap.get("bootstrap") is True
                or ("bootstrap" not in gap and start == 0 and end_text == initial_resume)):
            continue
        timestamp = re.sub(r"(\.\d{6})\d+", r"\1", gap["recordedAt"])
        recorded = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if recorded.tzinfo is None:
            raise ValueError(f"Fiscal gap timestamp has no timezone: {path.stem}")
        if now - recorded <= MINIMUM_AGE:
            continue
        status = gap["status"]
        if status not in {"RECOVERED", "HISTORICAL_RECOVERY_REQUIRED", "CAPTURED"}:
            raise ValueError(f"Invalid fiscal gap status: {path.stem}")
        pending = pending_description(start, end, points) if status != "RECOVERED" else ""
        details = (f"{pending} — pendência registrada em "
                   f"{recorded.astimezone(BRASILIA):%d/%m/%Y às %H:%M} (Brasília)."
                   if pending else "")
        stamp = recorded.isoformat(timespec="seconds")
        records.append({
            "Title": PREFIX + path.stem, "TIPO": "Lacuna NF-e",
            "STATUS": "Pending" if pending else "Completed",
            "INICIADO_EM": stamp, "ULTIMO_PROGRESSO_EM": stamp,
            "FONTES_PENDENTES": "NF-e" if pending else "", "DETALHES": details,
            "progress": {"recovered": not pending},
        })
    return records


def publish(repository, records, now):
    active = {}
    after = 0
    while True:
        page = repository.req("GET", repository.endpoint + "/items", params={
            "$filter": f"startswith(Title,'{PREFIX}') and STATUS eq 'Pending' and Id gt {after}",
            "$select": "Id,Title,STATUS,DETALHES,ALERTA_ENVIADO_EM",
            "$orderby": "Id asc", "$top": 100,
        })["value"]
        for row in page:
            if row["Id"] <= after or row["Title"] in active:
                raise ValueError("Invalid fiscal gap alert pagination")
            after = row["Id"]
            active[row["Title"]] = row
        if len(page) < 100:
            break

    pending = 0
    for record in records:
        current = active.get(record["Title"])
        if record["STATUS"] == "Pending":
            pending += 1
            if current and (current.get("ALERTA_ENVIADO_EM")
                            or current.get("DETALHES") == record["DETALHES"]):
                continue
        elif not current:
            continue
        repository.upsert(record, now)
    return pending


def update(repository, company, initial_resume, now):
    return publish(repository, observations(company, initial_resume, now), now)
