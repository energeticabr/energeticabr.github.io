"""Build a private candidate from exact anchors; never touch running services."""
import argparse
from pathlib import Path
import shutil


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise RuntimeError('Absent or ambiguous workflow anchor: ' + before[:90])
    return source.replace(before, after, 1)


def apply(source, candidate):
    workflow = (source / 'worker/workflow.py').read_text(encoding='utf-8')
    workflow = replace_once(workflow, 'from diary_progress import emit_progress',
        'from diary_progress import emit_progress\n\ntry:\n    from . import document_batch\nexcept ImportError:\n    import document_batch')
    workflow = replace_once(workflow, 'ACTIVE_STAGES = {',
        'ACTIVE_STAGES = {\n    *document_batch.STAGES,')
    workflow = replace_once(workflow, '        state["flow"] = selected["flow"]\n',
        '        state["flow"] = selected["flow"]\n        state.pop("document_batch", None)\n')
    workflow = replace_once(workflow,
        '        if state["flow"] == "payment" and not start_step_key:',
        '        if state["flow"] == "document" and not start_step_key:\n            return document_batch.start(self, state, etag)\n        if state["flow"] == "payment" and not start_step_key:')
    workflow = replace_once(workflow,
        '    def _handle_text_impl(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n',
        '    def _handle_text_impl(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n        document_result = document_batch.handle_text(self, event, state, etag)\n        if document_result is not None:\n            return document_result\n')
    workflow = replace_once(workflow,
        '    def _prompt_next_or_summary(self, state: dict, etag: str | None) -> dict:\n        step = self._current_step(state)\n        flow = self._flow_config(state)\n',
        '    def _prompt_next_or_summary(self, state: dict, etag: str | None) -> dict:\n        step = self._current_step(state)\n        flow = self._flow_config(state)\n        if not step:\n            document_result = document_batch.after_fields(self, state, etag)\n            if document_result is not None:\n                return document_result\n')
    workflow = replace_once(workflow,
        '    def _handle_confirmation_reply(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n',
        '    def _handle_confirmation_reply(\n        self, event: dict, state: dict, etag: str | None\n    ) -> dict:\n        document_result = document_batch.confirmation(self, event, state, etag)\n        if document_result is not None:\n            return document_result\n')
    workflow = replace_once(workflow,
        '    def _send_confirmation_actions(self, state: dict) -> None:\n',
        '    def _send_confirmation_actions(self, state: dict) -> None:\n        if document_batch.send_confirmation(self, state):\n            return\n')
    workflow = replace_once(workflow,
        '            target_list = flow["target_list"]\n            idempotency_field = flow.get("idempotency_field", "Title")\n            related_item = self._ensure_related_item(state, flow)\n',
        '            if document_batch.active(state):\n                return document_batch.commit(self, state, etag, flow)\n            target_list = flow["target_list"]\n            idempotency_field = flow.get("idempotency_field", "Title")\n            related_item = self._ensure_related_item(state, flow)\n')
    workflow = replace_once(workflow,
        '    def _resend_current_prompt(self, state: dict, etag: str | None) -> dict:\n        stage = state.get("stage")\n',
        '    def _resend_current_prompt(self, state: dict, etag: str | None) -> dict:\n        document_result = document_batch.resend(self, state, etag)\n        if document_result is not None:\n            return document_result\n        stage = state.get("stage")\n')
    helper = Path(__file__).with_name('document_batch.py').read_text(encoding='utf-8')
    compile(workflow, 'workflow.py', 'exec')
    compile(helper, 'document_batch.py', 'exec')
    if candidate.exists():
        raise RuntimeError('Candidate already exists; preserve it and choose another directory')
    shutil.copytree(source, candidate, ignore=shutil.ignore_patterns('__pycache__'))
    (candidate / 'worker/workflow.py').write_text(workflow, encoding='utf-8', newline='\n')
    (candidate / 'worker/document_batch.py').write_text(helper, encoding='utf-8', newline='\n')
    return candidate


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('candidate', type=Path)
    args = parser.parse_args()
    print(apply(args.source, args.candidate))
