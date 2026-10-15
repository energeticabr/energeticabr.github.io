"""Build a drift-checked candidate that keeps product searches out of selection."""

import argparse
import hashlib
from pathlib import Path


BASELINE_SHA256 = "8c243b19bfc1bcc7752babee70d161b152c58d6e4df47034d755cf296b2e943d"


def replace_exact(source: str, before: str, after: str) -> str:
    if source.count(before) != 1:
        raise RuntimeError("Workflow source drift; expected exactly one reviewed anchor")
    return source.replace(before, after, 1)


def patch(source: str) -> str:
    start = source.index("    def _document_signing_filter_payment_options(")
    end = source.index("\n    @staticmethod", start)
    method = source[start:end]
    method = replace_exact(
        method,
        "        etag: str | None,\n    ) -> dict | None:",
        "        etag: str | None,\n        filter_only: bool = False,\n    ) -> dict | None:",
    )
    method = replace_exact(
        method,
        '''        matches = list(
            filter_options(str(raw_reply or ""), state.get("options") or [])
        )
        if not matches:
            return None
        if kind == "product":
            matches = self._document_signing_payment_options_with_finalize(
                state, matches
            )
        self._send_filtered_options(state, factories[kind](), matches)''',
        '''        options = state.get("options") or []
        # The shared filter intentionally rejects numeric-only input. In this
        # chooser, product IDs are searchable text, not a selection command.
        matches = (
            [option for option in options
             if command in normalize_text(str(option.get("title") or ""))]
            if command.isdigit()
            else list(filter_options(str(raw_reply or ""), options))
        )
        if not matches and not filter_only:
            return None
        step = factories[kind]()
        if not matches:
            step = {**step, "prompt": "📦 NENHUM PRODUTO ENCONTRADO. DIGITE OUTRO TEXTO PARA FILTRAR."}
        if kind == "product":
            matches = self._document_signing_payment_options_with_finalize(
                state, matches
            )
        self._send_filtered_options(state, step, matches)''',
    )
    source = source[:start] + method + source[end:]

    start = source.index('        if state.get("stage") == DOCUMENT_SIGNING_PAYMENT_PRODUCT_STAGE:')
    end = source.index('        if state.get("stage") == DOCUMENT_SIGNING_PAYMENT_QUANTITY_STAGE:', start)
    stage = source[start:end]
    stage = replace_exact(
        stage,
        '''            selected = resolve_option(
                raw_reply,''',
        '''            if event.get("reply_id") == "filter_query" or (
                state.get("phone_number_id") == "portal-admin"
                and event.get("kind") == "text" and not event.get("reply_id")
            ):
                return self._document_signing_filter_payment_options(
                    state, kind="product", raw_reply=raw_reply,
                    etag=etag, filter_only=True,
                )
            selected = resolve_option(
                raw_reply,''',
    )
    return source[:start] + stage + source[end:]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("candidate", type=Path)
    args = parser.parse_args()
    original = args.source.read_bytes()
    if hashlib.sha256(original).hexdigest() != BASELINE_SHA256:
        raise RuntimeError("Live workflow hash drift; refusing candidate build")
    candidate = patch(original.decode("utf-8")).encode("utf-8")
    compile(candidate, str(args.candidate), "exec")
    args.candidate.parent.mkdir(parents=True, exist_ok=True)
    args.candidate.write_bytes(candidate)
    print(hashlib.sha256(candidate).hexdigest())


if __name__ == "__main__":
    main()
