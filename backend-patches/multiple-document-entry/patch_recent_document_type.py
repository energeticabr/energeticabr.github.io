"""Prioritize the last submitted type before the workflow builds a page."""


def patch_workflow(data):
    text = data.decode('utf-8')
    newline = '\r\n' if '\r\n' in text else '\n'
    if newline == '\r\n' and text.count('\n') != text.count('\r\n'):
        raise RuntimeError('Mixed source newlines require review')
    text = text.replace('\r\n', '\n')
    marker = '    def _emit_option_page(self, state: dict) -> None:\n'
    before, separator, method = text.partition(marker)
    anchor = '        options = copy.deepcopy(pagination.get("options") or [])\n'
    addition = '        options = document_batch.order_document_type_options(self, state, step, options)\n'
    if not separator or method.split('\n    def ', 1)[0].count(anchor) != 1 or addition in method:
        raise RuntimeError('Unexpected option pagination source')
    updated = before + marker + method.replace(anchor, anchor + addition, 1)
    compile(updated, 'workflow.py', 'exec')
    return updated.replace('\n', newline).encode('utf-8')
