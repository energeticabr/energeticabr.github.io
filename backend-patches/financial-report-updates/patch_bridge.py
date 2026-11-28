"""Attach report times to the existing permission-checked pending responses."""
import argparse
from pathlib import Path


def patch_bridge(source):
    routes = (
        ("dda_refresh", "handle_portal", "dda"),
        ("sefaz_refresh", "handle_fiscal_refresh", "fiscal"),
    )
    for action, handler, report in routes:
        anchor = (
            f'                if action in {{"{action}", "{action}_status"}}:\n'
            f'                    from {action.split("_")[0]}_sync import handle_portal'
            + (f" as {handler}" if handler != "handle_portal" else "")
            + f"\n                    return self._send_json(200, {handler}(identity, body), cors_origin=origin)"
        )
        replacement = anchor.rsplit("\n", 1)[0] + (
            "\n                    from financial_report_updates import add_report_update"
            f"\n                    result = {handler}(identity, body)"
            f'\n                    return self._send_json(200, add_report_update(result, "{report}"), cors_origin=origin)'
        )
        if source.count(replacement) == 1 and anchor not in source:
            continue
        if source.count(anchor) != 1:
            raise ValueError(f"Unexpected channel bridge source for {action}")
        source = source.replace(anchor, replacement, 1)
    compile(source, "channel_bridge.py", "exec")
    return source


def patch_auxiliary_clock(source):
    before = "Write-AuxLog $DataPath $Source 'DELIVERY_CONFIRMED' $Now $outbox.Count"
    after = "Write-AuxLog $DataPath $Source 'DELIVERY_CONFIRMED' ([DateTimeOffset](& $Clock)) $outbox.Count"
    if source.count(after) == 1 and before not in source:
        return source
    if source.count(before) != 1:
        raise ValueError("Unexpected fiscal auxiliary worker source")
    return source.replace(before, after, 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--auxiliary", action="store_true")
    args = parser.parse_args()
    edit = patch_auxiliary_clock if args.auxiliary else patch_bridge
    content = args.source.read_bytes().decode("utf-8")
    args.output.write_bytes(edit(content).encode("utf-8"))
