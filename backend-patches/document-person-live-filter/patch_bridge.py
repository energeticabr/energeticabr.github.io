"""Bound document related-person live filtering to the selected database source."""
from __future__ import annotations

import argparse
import os
from pathlib import Path


IMPORT_OLD = "from logic import (\n    conversation_key,\n"
IMPORT_NEW = "from logic import (\n    condition_matches,\n    conversation_key,\n"
SOURCE_OLD = '''        source = step.get("source") or {}
        if (
            source.get("type") == "sharepoint_list"
            and not step.get("accepts_direct_text")
            and self.messages
        ):
            self.messages[-1]["databaseFilter"] = True
            self.messages[-1]["databaseFilterKey"] = str(step["key"])
'''
SOURCE_NEW = '''        source = step.get("source") or {}
        database_source = source.get("type") == "sharepoint_list"
        if (
            state.get("flow") == "document"
            and step.get("key") == "pessoa_relacionada"
            and not step.get("accepts_direct_text")
        ):
            context = {**state.get("fields", {}), **state.get("answers", {})}

            def selected_database_source(candidate):
                candidate = candidate or {}
                if candidate.get("type") == "conditional":
                    for branch in candidate.get("branches", []):
                        if condition_matches(branch.get("when"), context):
                            return selected_database_source(branch["source"])
                    return selected_database_source(candidate.get("default"))
                if candidate.get("type") == "union":
                    children = candidate.get("sources", [])
                    return bool(children) and all(selected_database_source(child) for child in children)
                return candidate.get("type") == "sharepoint_list"

            database_source = selected_database_source(source)
        if (
            database_source
            and not step.get("accepts_direct_text")
            and self.messages
        ):
            self.messages[-1]["databaseFilter"] = True
            self.messages[-1]["databaseFilterKey"] = str(step["key"])
'''
REPLACEMENTS = ((IMPORT_OLD, IMPORT_NEW), (SOURCE_OLD, SOURCE_NEW))


def patch_bridge(source):
    """Return a compile-checked candidate; reject drift and partial application."""
    old_counts = [source.count(old) for old, _ in REPLACEMENTS]
    new_counts = [source.count(new) for _, new in REPLACEMENTS]
    if old_counts == [0, 0] and new_counts == [1, 1]:
        compile(source, "channel_bridge.py", "exec")
        return source
    if old_counts != [1, 1] or new_counts != [0, 0]:
        raise ValueError("Backend source changed; refusing ambiguous or partial patch.")
    for old, new in REPLACEMENTS:
        source = source.replace(old, new, 1)
    compile(source, "channel_bridge.py", "exec")
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.target.resolve() or (
        args.target.exists() and os.path.samefile(args.source, args.target)
    ):
        raise ValueError("Bridge source is read-only; choose a separate candidate path.")
    candidate = patch_bridge(args.source.read_bytes().decode("utf-8")).encode("utf-8")
    with args.target.open("xb") as output:
        output.write(candidate)


if __name__ == "__main__":
    main()
