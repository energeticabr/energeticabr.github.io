"""Build a drift-checked workflow candidate for payment-receipt products."""

import argparse
import hashlib
from pathlib import Path

BASELINE_SHA256 = "91aacea66a8d9aa494275348751d4f5feab9fcadbda58cff9a06d5f2a5cf9b09"

PRODUCT_SOURCE_BEFORE = '''            "source": {
                "type": "sharepoint_list",
                "list": "CADASTROPRODUTO",
                "id_field": "Id",
                "label_field": "PRODUTO",
                "value_field": "PRODUTO",
                "fields": ["PRODUTO", "UNIDADE", "SATUS"],
                "filters": [{"field": "SATUS", "equals": "ATIVO"}],
                "sort_field": "PRODUTO",
                "sort_direction": "asc",
                "top": 5000,
            },'''

PRODUCT_SOURCE_AFTER = '''            "source": {
                "type": "sharepoint_list",
                "list": "CADASTROPRODUTO",
                "id_field": "Id",
                "label_field": "PRODUTO",
                "value_field": "PRODUTO",
                "fields": ["PRODUTO", "UNIDADE", "SATUS"],
                "filters": [{"field": "SATUS", "equals": "ATIVO"}],
                "sort_field": "Id",
                "sort_direction": "desc",
                "top": 5000,
            },'''

FILTER_METHOD_ANCHOR = '''    def _document_signing_filter_payment_options(
'''
FILTER_REPLY_METHOD = '''    @staticmethod
    def _document_signing_payment_reply(event: dict) -> str:
        reply_id = str(event.get("reply_id") or "")
        # Portal typing sends filter_query as the reply ID and the actual
        # search phrase in text. Keep choice IDs and filter_clear unchanged.
        if reply_id == "filter_query":
            return str(event.get("text") or "")
        return reply_id or str(event.get("text") or "")

'''

PAYMENT_REPLY_STAGES = (
    "DOCUMENT_SIGNING_PAYMENT_METHOD_STAGE",
    "DOCUMENT_SIGNING_PAYMENT_SUPPLIER_STAGE",
    "DOCUMENT_SIGNING_PAYMENT_PRODUCT_STAGE",
    "DOCUMENT_SIGNING_PAYMENT_UNIT_STAGE",
)


def replace_exact(source: str, before: str, after: str, expected: int) -> str:
    actual = source.count(before)
    if actual != expected:
        raise RuntimeError(f"Source drift: expected {expected} anchors, found {actual}")
    return source.replace(before, after)


def patch(source: str) -> str:
    source = replace_exact(source, PRODUCT_SOURCE_BEFORE, PRODUCT_SOURCE_AFTER, 1)
    source = replace_exact(source, FILTER_METHOD_ANCHOR,
                           FILTER_REPLY_METHOD + FILTER_METHOD_ANCHOR, 1)
    for stage in PAYMENT_REPLY_STAGES:
        source = replace_exact(
            source,
            f'''        if state.get("stage") == {stage}:\n            raw_reply = str(event.get("reply_id") or event.get("text") or "")''',
            f'''        if state.get("stage") == {stage}:\n            raw_reply = self._document_signing_payment_reply(event)''',
            1,
        )
    return source


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
