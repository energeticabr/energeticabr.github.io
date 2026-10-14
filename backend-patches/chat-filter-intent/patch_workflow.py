"""Add an explicit filter-only intent to the live selection workflow.

Usage: python patch_workflow.py SOURCE CANDIDATE
The source is never modified by this script.
"""

from pathlib import Path
import sys


HOOK = '''        if not state.get("options"):
            state["options"] = self._selection_options(state, step)
'''

FILTER_INTENT = '''        # A typed search is never a choice, even when it exactly matches an ID.
        # Only an explicit option reply may advance the selection step.
        if event.get("kind") == "text" and event.get("reply_id") == "filter_query":
            query = str(event.get("text") or "").strip()
            if not query:
                self._send_options(state, step, state["options"])
                self._save(state, etag)
                return {"status": "filter_cleared", "field": step["key"],
                        "option_count": len(state["options"]), "batch_id": state["batch_id"]}
            matches = filter_options(query, state["options"])
            if matches:
                filtered = self._include_terminal_option(step, list(matches))
                if step.get("allow_blank") and not any(
                    item.get("value", item.get("title")) is None for item in filtered
                ):
                    blank = next((item for item in state["options"]
                                  if item.get("value", item.get("title")) is None), None)
                    if blank:
                        filtered.insert(0, blank)
                self._send_filtered_options(state, step, filtered)
                self._save(state, etag)
                return {"status": "filtered_options", "field": step["key"],
                        "option_count": len(filtered), "batch_id": state["batch_id"]}
            retry_step = {**step, "prompt": (
                "NENHUMA OPÇÃO CORRESPONDENTE FOI ENCONTRADA. "
                "ESCOLHA UMA OPÇÃO ABAIXO OU DIGITE OUTRO TEXTO PARA FILTRAR."
            )}
            self._send_filtered_options(state, retry_step, state["options"])
            self._save(state, etag)
            return {"status": "invalid_option", "field": step["key"]}
'''

LEGACY_CHOICE = '''        if not selected:
            selected = resolve_option(raw_reply, state["options"], step["key"])
'''
SAFE_CHOICE = '''        if not selected and (event.get("reply_id") or event.get("kind") != "text"):
            selected = resolve_option(raw_reply, state["options"], step["key"])
'''


def patch(source: str) -> str:
    start = source.index("    def _handle_selection_reply(")
    end = source.index("\n    def ", start + 1)
    method = source[start:end]
    if (method.count(HOOK) != 1 or method.count(LEGACY_CHOICE) != 1
            or 'event.get("reply_id") == "filter_query"' in method):
        raise ValueError("Selection hook differs from the reviewed source")
    updated = method.replace(HOOK, HOOK + FILTER_INTENT, 1)
    updated = updated.replace(LEGACY_CHOICE, SAFE_CHOICE, 1)
    return source[:start] + updated + source[end:]


if __name__ == "__main__":
    source_path, candidate_path = map(Path, sys.argv[1:3])
    candidate_path.write_text(patch(source_path.read_text(encoding="utf-8")), encoding="utf-8")
