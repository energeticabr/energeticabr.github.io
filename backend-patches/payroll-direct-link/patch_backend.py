"""Change only reviewed workflow anchors; reject unrelated source drift."""
CHANGES = [
    ('''        state["stage"] = LAUNCH_PAYROLL_DECISION_STAGE
        state["options"] = []
        state.pop("option_pagination", None)
        etag = self._save(state, etag)
        self._send_launch_payroll_decision_prompt(state)
        return {
            "status": "awaiting_launch_payroll_decision",
            "launch_ids": [item["item_id"] for item in entries],
            "eligible_launch_ids": [int(item) for item in eligible_ids],
            "batch_id": state["batch_id"],
            "etag": etag,
        }
''', '''        return self._begin_launch_payroll_linking(state, etag)
'''),
    ('''        pending["decision"] = "sim"
        if len(pending.get("entries") or []) > 1:
''', '''        return self._begin_launch_payroll_linking(state, etag)

    def _begin_launch_payroll_linking(self, state, etag):
        pending = state.get("pending_launch_payroll") or {}
        pending["decision"] = "sim"
        if len(pending.get("entries") or []) > 1:
'''),
    ('''            self._send_launch_payroll_decision_prompt(state)
            etag = self._save(state, etag)
            return {"status": "invalid_launch_payroll_decision", "batch_id": state["batch_id"], "etag": etag}
''', '''            self._mark_processed(state, message_id)
            return self._begin_launch_payroll_linking(state, etag)
'''),
    ('''                self._send_launch_payroll_decision_prompt(state)
            elif stage == LAUNCH_PAYROLL_SELECTION_STAGE:
''', '''                return self._begin_launch_payroll_linking(state, etag)
            elif stage == LAUNCH_PAYROLL_SELECTION_STAGE:
'''),
    ('''                    "button_label": "ESCOLHER FOLHA",
                    "source": {"type": "static"},
''', '''                    "button_label": "ESCOLHER FOLHA",
                    "terminal_options": [{"id": LAUNCH_PAYROLL_NO_ID,
                        "title": "❌ NÃO ADICIONAR A FOLHA DE PAGAMENTO"}],
                    "source": {"type": "static"},
'''),
    ('''              'reply': f"choice:launch_payroll_shared_month:{option['id']}"} for option in state['options']],
''', '''              'reply': f"choice:launch_payroll_shared_month:{option['id']}"} for option in state['options']] +
            [{'id': LAUNCH_PAYROLL_NO_ID, 'reply': LAUNCH_PAYROLL_NO_ID,
              'title': '❌ NÃO ADICIONAR A FOLHA DE PAGAMENTO'}],
'''),
    ('''        if "sheet_entry_index" not in pending:
            self._mark_processed(state, message_id)
''', '''        if _control_command(event.get("reply_id") or event.get("text") or "") in {
                normalize_text(LAUNCH_PAYROLL_NO_ID), "nao", "não"}:
            self._mark_processed(state, message_id)
            pending["decision"] = "nao"
            return self._continue_launch_after_payroll(state, etag)
        if "sheet_entry_index" not in pending:
            self._mark_processed(state, message_id)
'''),
]


def change(data):
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    text = text.replace('\r\n', '\n')
    for before, after in CHANGES:
        if text.count(before) != 1:
            raise RuntimeError('Expected workflow anchor exactly once: ' + before[:90])
        text = text.replace(before, after)
    compile(text, 'workflow.py', 'exec')
    return text.replace('\n', newline).encode('utf-8')
