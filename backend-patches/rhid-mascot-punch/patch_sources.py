"""Build the RHID mascot patch from the live bridge and adjustment sources."""
from pathlib import Path
import sys
from textwrap import indent


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Expected one source anchor: {old[:120]!r}")
    return source.replace(old, new, 1)


def patch_bridge(source):
    source = replace_once(source, "        self.rhid_refresh_lock = threading.Lock()\n",
                          "        self.rhid_refresh_lock = threading.Lock()\n"
                          "        self.rhid_adjustment_lock = threading.Lock()\n")
    start = source.index("    def portal_rhid_attendance_adjust(\n")
    end = source.index("\n    def ", start + 1)
    method = source[start:end]
    method = replace_once(method, "*, allowed_emails: set[str],",
                          "*, allowed_emails: set[str], fill_missing: bool = False,")
    method = replace_once(method,
        "        if on_date > now.date() or (on_date == now.date() and (now.hour, now.minute) < (17, 15)):\n"
        "            raise ValueError(\"O dia do relatório ainda não foi encerrado.\")\n",
        "        if on_date > now.date() or (on_date == now.date() and not fill_missing\n"
        "                                    and (now.hour, now.minute) < (17, 15)):\n"
        "            raise ValueError(\"O dia do relatório ainda não foi encerrado.\")\n")
    lookup = method.index("        source_rows = ")
    finish = method.index("        return {\"status\": \"processed\"")
    write = replace_once(method[lookup:finish],
        "        validate_adjustment_against_rhid(on_date, selected_rows, existing, str(slot or \"\"), str(time_value or \"\"))\n",
        "        proposed_time = str(time_value or \"\")\n"
        "        validate_adjustment_against_rhid(on_date, selected_rows, existing, str(slot or \"\"),\n"
        "                                         proposed_time, only_missing=fill_missing)\n"
        "        if fill_missing and on_date == now.date() and proposed_time > now.strftime(\"%H:%M\"):\n"
        "            raise ValueError(\"Informe um horário já decorrido. Não é possível lançar ponto futuro.\")\n")
    source = source[:start] + method[:lookup] + "        with self.rhid_adjustment_lock:\n" + indent(write, "    ") + method[finish:] + source[end:]
    source = replace_once(source, 'elif action == "rhid_attendance_adjust":',
                          'elif action in ("rhid_attendance_adjust", "rhid_attendance_fill_missing"):')
    return replace_once(source,
        '                            body.get("slot"), body.get("time"), body.get("reason"),\n'
        '                            allowed_emails=self.portal_authenticator.allowed_emails,\n',
        '                            body.get("slot"), body.get("time"), body.get("reason"),\n'
        '                            allowed_emails=self.portal_authenticator.allowed_emails,\n'
        '                            fill_missing=action == "rhid_attendance_fill_missing",\n')


def patch_validator(source):
    helpers = r'''
def _rhid_missing_times(value):
    if isinstance(value, list):
        return [time for item in value for time in _rhid_missing_times(item)]
    if isinstance(value, dict):
        for field in ("dataHora", "DataHora", "timestamp", "hora", "value"):
            if value.get(field) is not None:
                return _rhid_missing_times(value[field])
        return []
    raw = str(value or "").strip()
    if raw.startswith("["):
        try:
            return _rhid_missing_times(json.loads(raw))
        except ValueError:
            pass
    raw = re.sub(r"[+-](?:[01]?\d|2[0-3]):[0-5]\d\b", "", raw)
    return [time.zfill(5) for time in re.findall(r"(?<!\d)((?:[01]?\d|2[0-3]):[0-5]\d)(?::[0-5]\d)?(?!\d)", raw)]


def _rhid_missing_groups(times, adjustments):
    # Match the effective slot assignments in rhid-attendance-table.js.
    bands = dict(zip(SLOT_ORDER, ((300, 480), (660, 749), (750, 810), (930, 1439))))

    def minutes(time):
        return int(time[:2]) * 60 + int(time[3:])

    def distance(slot, time):
        start, end = bands[slot]
        minute = minutes(time)
        return max(start - minute, minute - end, 0)

    groups = {slot: [] for slot in SLOT_ORDER}
    outside = []
    for time in times:
        slot = next((slot for slot in SLOT_ORDER if distance(slot, time) == 0), None)
        (groups[slot] if slot else outside).append(time)

    if not (groups["exit1"] and groups["entry2"]) and all(1 <= len(groups[slot]) <= 2 for slot in ("entry1", "exit2")):
        midday = sorted(groups["exit1"] + groups["entry2"] + [time for time in outside if "11:00" <= time <= "14:30"])
        if len(midday) == 2:
            departure, arrival = midday
            if departure <= "13:30" and 45 <= minutes(arrival) - minutes(departure) <= 90:
                groups["exit1"], groups["entry2"] = [departure], [arrival]
                outside = [time for time in outside if time not in midday]

    def anchors(slots):
        return [time for slot in slots for time in ([adjustments[slot]] if slot in adjustments else groups[slot])]

    def compatible(time):
        return [slot for index, slot in enumerate(SLOT_ORDER) if not groups[slot]
                and all(anchor < time for anchor in anchors(SLOT_ORDER[:index]))
                and all(anchor > time for anchor in anchors(SLOT_ORDER[index + 1:]))]

    forced = {time: slots[0] for time in outside if len(slots := compatible(time)) == 1}
    for time, slot in forced.items():
        groups[slot].append(time)
    for time in outside:
        if time in forced:
            continue
        slots = compatible(time)
        if slots:
            groups[min(slots, key=lambda slot: distance(slot, time))].append(time)
    raw = {}
    for slot, candidates in groups.items():
        if len(candidates) == 1:
            raw[slot] = candidates[0]
        elif len(candidates) == 2 and all(distance(slot, time) == 0 for time in candidates):
            raw[slot] = candidates[1 if slot.startswith("entry") else 0]
    return groups, raw


def _rhid_missing_validate(rows, existing, slot, proposed_time):
    times = sorted({time for row in rows for time in _rhid_missing_times(row.get("BATIDAS_RHID"))})
    adjustments = {name: item["time"] for name, item in existing.items()
                   if name in SLOTS and TIME_PATTERN.fullmatch(str(item.get("time") or ""))}
    if not times and not adjustments:
        raise ValueError("Não há batidas que confirmem a presença desta pessoa no dia.")
    groups, raw = _rhid_missing_groups(times, adjustments)
    if groups[slot] or slot in adjustments:
        raise ValueError("Este horário já está preenchido. Atualize o relatório RHID.")
    adjustments[slot] = proposed_time

    def validate_order(clock):
        effective = clock | adjustments
        ordered = [effective[name] for name in SLOT_ORDER if name in effective]
        if any(left >= right for left, right in zip(ordered, ordered[1:])):
            raise ValueError("Os horários ficariam fora da ordem cronológica.")

    validate_order(raw)
    updated_groups, updated_raw = _rhid_missing_groups(times, adjustments)
    if updated_groups[slot]:
        raise ValueError("Este horário já está preenchido. Atualize o relatório RHID.")
    validate_order(updated_raw)


'''
    source = replace_once(source, "def validate_adjustment_against_rhid(", helpers.lstrip("\n") + "def validate_adjustment_against_rhid(")
    source = replace_once(source, "slot: str, proposed_time: str) -> None:",
                          "slot: str, proposed_time: str, *, only_missing: bool = False) -> None:")
    return replace_once(source,
        "    candidates = {name: [] for name in SLOT_ORDER}\n",
        "    if only_missing:\n"
        "        return _rhid_missing_validate(rows, existing, slot, proposed_time)\n"
        "    candidates = {name: [] for name in SLOT_ORDER}\n")


if __name__ == "__main__":
    original, target = map(Path, sys.argv[1:])
    target.mkdir(parents=True, exist_ok=True)
    for name, patch in (("channel_bridge.py", patch_bridge), ("rhid_attendance_adjustments.py", patch_validator)):
        source = patch((original / name).read_text(encoding="utf-8"))
        compile(source, name, "exec")
        (target / name).write_text(source, encoding="utf-8")
