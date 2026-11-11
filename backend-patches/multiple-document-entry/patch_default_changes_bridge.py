"""Expose document draft changes on the defaults picker and its filtered pages."""


def patch_bridge(data):
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    if newline == '\r\n' and text.count('\n') != text.count('\r\n'):
        raise RuntimeError('Mixed source newlines require review')
    text = text.replace('\r\n', '\n')
    marker = '    def _send_option_poll(self, state, step, visible):\n'
    before, separator, method = text.partition(marker)
    anchor = '        source = step.get("source") or {}\n'
    addition = '''        if (
            state.get("flow") == "document"
            and state.get("stage") == "document_batch_defaults"
            and step.get("key") == "edit_field"
        ):
            changes = (state.get("document_batch") or {}).get("default_changes")
            if changes:
                self.messages[-1]["change_table"] = {"kind": "document_default_changes", "rows": changes}
'''
    if not separator or not method.split('\n    def ', 1)[0].count(anchor) == 1 or addition in method:
        raise RuntimeError('Unexpected document defaults bridge source')
    updated = before + marker + method.replace(anchor, addition + anchor, 1)
    compile(updated, 'channel_bridge.py', 'exec')
    return updated.replace('\n', newline).encode('utf-8')
