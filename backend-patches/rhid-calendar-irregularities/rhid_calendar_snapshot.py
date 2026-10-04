"""Slim, read-only monthly RHID rows using authoritative SharePoint revisions."""
import re

FIELDS = ("Id", "ID_PESSOA_RHID", "NOME_COLABORADOR", "DATA_REFERENCIA", "BATIDAS_RHID", "STATUS_RHID")
SLOTS = {"entry1", "exit1", "entry2", "exit2"}
TIME = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")


def monthly_effective_rows(rows, store, first_day, next_month):
    start, end = first_day.isoformat(), next_month.isoformat()
    adjustments = {}
    if store is not None:
        revisions = store._items(f"DATA_REFERENCIA ge '{start}' and DATA_REFERENCIA lt '{end}'")
        for revision in sorted(revisions, key=lambda row: int(row.get("Id") or 0)):
            day = str(revision.get("DATA_REFERENCIA") or "")[:10]
            key = str(revision.get("ID_PESSOA_RHID") or "").strip()
            slot = str(revision.get("CAMPO") or "")
            time = str(revision.get("HORARIO_CORRIGIDO") or "")
            if start <= day < end and key and slot in SLOTS and TIME.fullmatch(time):
                adjustments.setdefault((day, key), {})[slot] = {
                    "time": time, "adjustedAt": str(revision.get("Created") or ""),
                }
    result = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = str(row.get("DATA_REFERENCIA") or "")[:10]
        if not start <= day < end:
            continue
        rhid_id = str(row.get("ID_PESSOA_RHID") or "").strip()
        item_id = row.get("Id", row.get("ID"))
        key = f"rhid:{rhid_id}" if rhid_id else f"id:{item_id}"
        item = {field: row.get(field) for field in FIELDS}
        item["Id"] = item_id
        if (day, key) in adjustments:
            item["ADMIN_AJUSTES"] = adjustments[(day, key)]
        result.append(item)
    return result
