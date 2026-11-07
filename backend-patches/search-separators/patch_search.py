"""Create candidates from the active worker modules, leaving the originals intact."""
from pathlib import Path
import sys


OPTION_FILTER = '''def filter_options(query: str, options: list[dict]) -> list[dict]:
    normalized = normalize_text(query)
    if not normalized or normalized.isdigit():
        return []
    terms = normalized.split()
    return [
        option
        for option in options
        if all(term in normalize_text(str(option["title"])) for term in terms)
    ]
'''

TOLERANT_OPTION_FILTER = r'''def normalize_search_text(value: str) -> str:
    text = normalize_text(value).replace(",", ".")
    text = re.sub(r"(\d) *\. *(?=\d)", r"\1.", text)
    return re.sub(r"(\d) (?=(?:mm|cm|m|km|kg|g|mg|ml|l|kva|kv|v|kw|w|hz|pol)(?![^\W_]))",
                  r"\1", text)


def compact_search_text(text: str) -> str:
    return re.sub(r"(\d) +(?=\d)| +", lambda gap: gap[0] if gap[1] else "", text)


def matches_search_terms(text: str, terms: list[str]) -> bool:
    if all(term in text for term in terms):
        return True
    compact = compact_search_text(text)
    return all(
        term in text or (len(term) >= 3 and any(char.isalpha() for char in term)
                         and compact_search_text(term) in compact)
        for term in terms
    )


def filter_options(query: str, options: list[dict]) -> list[dict]:
    normalized = normalize_search_text(query)
    if not normalized or normalized.isdigit():
        return []
    terms = normalized.split()
    return [
        option
        for option in options
        if matches_search_terms(normalize_search_text(str(option["title"])), terms)
    ]
'''


def replace(source, before, after):
    if source.count(before) != 1:
        raise ValueError(f"Unexpected baseline near {before.splitlines()[0]!r}")
    return source.replace(before, after, 1)


def patch_gallery(source):
    source = replace(source, "from PIL import Image\n", """from PIL import Image

if __package__:
    from .logic import matches_search_terms, normalize_search_text
else:
    from logic import matches_search_terms, normalize_search_text
""")
    source = replace(source, "    return _norm(value).split()\n",
                     "    return normalize_search_text(value).split()\n")
    source = replace(source, '        return _norm(" ".join(values))\n',
                     '        return normalize_search_text("\\0".join(values))\n')
    return replace(source, "                if not all(term in text for term in terms):\n",
                   "                if not matches_search_terms(text, terms):\n")


def patch_workflow(source):
    import_line = "        filter_options,\n"
    if source.count(import_line) != 2:
        raise ValueError("Unexpected workflow imports")
    source = source.replace(import_line, import_line +
                            "        matches_search_terms,\n        normalize_search_text,\n")
    source = replace(source,
                     'term = normalize_text(str(state.get("document_retrieval_search_term") or ""))',
                     'term = normalize_search_text(str(state.get("document_retrieval_search_term") or ""))')
    source = replace(source,
                     '            if any(term in normalize_text(str(values.get(field) or "")) for field in fields):',
                     '            if any(matches_search_terms(normalize_search_text(str(values.get(field) or "")), [term])\n'
                     '                   for field in fields):')
    return replace(source, '''        terms = normalize_text(query).split()
        matches = [option for option in options if not option.get("terminal_option") and all(term in normalize_text(
            str(option.get("title", "")) + " " + str(option.get("catalog_id", ""))) for term in terms)]''',
                   '''        terms = normalize_search_text(query).split()
        matches = [
            option for option in options
            if not option.get("terminal_option") and matches_search_terms(
                normalize_search_text(str(option.get("title", "")) + chr(0) + str(option.get("catalog_id", ""))),
                terms,
            )
        ]''')


def main(source, candidate):
    updated = {
        "logic.py": replace((source / "logic.py").read_text(encoding="utf-8"),
                            OPTION_FILTER, TOLERANT_OPTION_FILTER),
        "launch_gallery.py": patch_gallery((source / "launch_gallery.py").read_text(encoding="utf-8")),
        "workflow.py": patch_workflow((source / "workflow.py").read_text(encoding="utf-8")),
    }
    candidate.mkdir(parents=True, exist_ok=True)
    for name, code in updated.items():
        compile(code, name, "exec")
        (candidate / name).write_text(code, encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main(*map(Path, sys.argv[1:]))
