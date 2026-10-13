"""Apply exact, narrow hooks to a hash-verified live workflow snapshot."""
import difflib
import hashlib
from pathlib import Path
import sys

EXPECTED = '9ffad321d43a978924b6df80c3023ccaf891ab1a644132f051af966cd2e5912b'
base, candidate = map(Path, sys.argv[1:3])
assert hashlib.sha256(base.read_bytes()).hexdigest() == EXPECTED, 'Workflow source drift'
original = base.read_text(encoding='utf-8')
code = original


def replace_once(before, after):
    global code
    assert code.count(before) == 1, 'Ambiguous hook: ' + before[:100]
    code = code.replace(before, after)


replace_once('from calendar import monthrange',
             'try:\n    from . import financial_catalog_registration as financial_catalog\n'
             'except ImportError:\n    import financial_catalog_registration as financial_catalog\n'
             'from calendar import monthrange')
replace_once('        provision_lock = self._handle_frozen_provision(event,state,etag)',
             '''        if (((state or {}).get("embedded_return") or {}).get("type") == financial_catalog.RETURN_TYPE
                and event.get("kind") == "text" and event.get("reply_id")
                and self._is_option_next(event["reply_id"]) and not state.get("option_pagination")):
            self._mark_processed(state, event.get("message_id"))
            return self._resend_current_prompt(state, etag)
        provision_lock = self._handle_frozen_provision(event,state,etag)''')
replace_once('            step = steps[state["step_index"]]',
             '            step = financial_catalog.step_with_create(self, state, steps[state["step_index"]])')
replace_once('        if selected.get("action") == "start_embedded_product_registration":',
             '        if selected.get("action") == financial_catalog.CREATE_ACTION:\n'
             '            return financial_catalog.start(self, state, etag)\n'
             '        if selected.get("action") == "start_embedded_product_registration":')
method_start = code.index('    def _handle_selection_reply(')
method_end = code.index('\n    def ', method_start + 1)
selection_method = code[method_start:method_end]
before_refresh = '''        if control in {"filter_clear", "limpar filtro", "refresh_options"}:
            self._send_options(state, step, state["options"])'''
after_refresh = '''        if control in {"filter_clear", "limpar filtro", "refresh_options"}:
            if control == "refresh_options" and financial_catalog.catalog(self, state, step):
                state["options"] = self._selection_options(state, step)
            self._send_options(state, step, state["options"])'''
assert selection_method.count(before_refresh) == 1, 'Ambiguous selection refresh hook'
code = code[:method_start] + selection_method.replace(before_refresh, after_refresh) + code[method_end:]
replace_once('''            "construction_stage_demonstrative_create",
        }:
            raise RuntimeError(
                "O cadastro incorporado não está disponível para este fluxo"''',
             '''            "construction_stage_demonstrative_create",
        } | financial_catalog.FINANCIAL_FLOWS:
            raise RuntimeError(
                "O cadastro incorporado não está disponível para este fluxo"''')
replace_once('''        if return_type == "demonstrative_activity_registration":
            parent_keys = (*parent_keys, "idempotency_token")''',
             '''        if return_type in {"demonstrative_activity_registration", financial_catalog.RETURN_TYPE}:
            parent_keys = (*parent_keys, "idempotency_token")''')
replace_once('        if embedded_type == "launch_product_registration":',
             '        if embedded_type == financial_catalog.RETURN_TYPE:\n'
             '            return financial_catalog.complete(self, state, etag, item_id)\n'
             '        if embedded_type == "launch_product_registration":')
replace_once('''    def _cancel(self, state: dict, etag: str | None, event: dict) -> dict:
        if cash_checkpoint_pending(state):''',
             '''    def _cancel(self, state: dict, etag: str | None, event: dict) -> dict:
        if (state.get("embedded_return") or {}).get("type") == financial_catalog.RETURN_TYPE:
            return financial_catalog.cancel(self, state, etag)
        if cash_checkpoint_pending(state):''')
candidate.parent.mkdir(parents=True, exist_ok=True)
candidate.write_text(code, encoding='utf-8', newline='\n')
patch = ''.join(difflib.unified_diff(original.splitlines(keepends=True), code.splitlines(keepends=True),
                                  fromfile='a/worker/workflow.py', tofile='b/worker/workflow.py'))
Path(__file__).with_name('workflow.patch').write_text(patch, encoding='utf-8', newline='\n')
print(hashlib.sha256(candidate.read_bytes()).hexdigest())
