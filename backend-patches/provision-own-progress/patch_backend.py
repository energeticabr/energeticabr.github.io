"""Apply the settlement race correction without replacing unrelated source changes."""


def replace(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError('Unexpected source layout: ' + old[:90])
    return text.replace(old, new)


def update_workflow(text):
    text = replace(text, '            propagation = propagate_payroll_row_attachments(\n', '''            prepared_record = {"item_id": provision_id, "related_item": pending_item,
                "launch_item": launch_item, "attachment_names": attachment_names}
            source_snapshot = state.get("_description_child_source") if launch_item and pending_item else None
            if state.get("_description_child_commit") and on_prepared:
                on_prepared(required_update, prepared_record)
            propagation = propagate_payroll_row_attachments(
''')
    text = replace(text, '                parent=state.get("_description_parent_id"),\n', '''                parent=state.get("_description_parent_id"),
                source_snapshot=source_snapshot,
                source_refresh=(lambda before, after: self._description_owned_progress(
                    before, after, prepared_record, provision_id)) if source_snapshot else None,
''')
    text = replace(text, '                self.sharepoint.update_item_with_etag(provision_id, required_update,\n                    state["_description_child_etag"], target_list=flow["target_list"])', '''                if source_snapshot:
                    current, current_etag = self.sharepoint.get_item_fields_with_etag(
                        provision_id, tuple(source_snapshot), target_list=flow["target_list"])
                    if not self._description_owned_progress(source_snapshot, current, prepared_record, provision_id):
                        raise RuntimeError("A provisão mudou antes da confirmação do pagamento.")
                    state["_description_child_etag"] = current_etag
                self.sharepoint.update_item_with_etag(provision_id, required_update,
                    state["_description_child_etag"], target_list=flow["target_list"])''')
    return text


def update_fanout(text):
    if 'def propagate(client, child, expected, record, parent=None):' in text:
        text = replace(text, 'def propagate(client, child, expected, record, parent=None):',
            'def propagate(client, child, expected, record, parent=None, *, source_snapshot=None, source_refresh=None):')
        text = replace(text, "    source_fields = ['FORNECEDOR', 'FILIAL', 'IDPEDIDO', 'IDLANCAMENTOS', 'DESCRITIVOPROVISAO']",
            "    source_fields = tuple(source_snapshot) if source_snapshot else ['FORNECEDOR', 'FILIAL', 'IDPEDIDO', 'IDLANCAMENTOS', 'DESCRITIVOPROVISAO']")
        text = replace(text, "    old_links = tuple(_text(expected.get(key)) for key in ('IDPEDIDO', 'IDLANCAMENTOS'))", """    if source_snapshot and (not source_refresh or not source_refresh(source_snapshot, source)):
        raise RuntimeError('A provisão mudou antes da cópia dos anexos.')
    old_links = tuple(_text(expected.get(key)) for key in ('IDPEDIDO', 'IDLANCAMENTOS'))""")
        text = replace(text, '    def guard():\n        if parent_owner is not None:',
            '    def guard():\n        nonlocal source, version\n        if parent_owner is not None:')
        return replace(text, """        if current != source or current_version != version:
            raise RuntimeError('Provisão alterada durante a cópia de anexos.')""", """        if current != source or current_version != version:
            if not (source != current and source_refresh and source_refresh(source, current)):
                raise RuntimeError('Provisão alterada durante a cópia de anexos.')
            source, version = current, current_version""")
    text = replace(text, 'def propagate(client, child, expected, record, parent=None, *, paid_source_fields=()):',
        'def propagate(client, child, expected, record, parent=None, *, paid_source_fields=(),\n              source_snapshot=None, source_refresh=None):')
    text = replace(text, '    source_fields = paid_source_fields or (',
        '    source_fields = tuple(source_snapshot) if source_snapshot else paid_source_fields or (')
    text = replace(text, '    old_links = tuple(_text(expected.get(key)) for key in (\'IDPEDIDO\', \'IDLANCAMENTOS\'))', '''    if source_snapshot and (not source_refresh or not source_refresh(source_snapshot, source)):
        raise RuntimeError('A provisão mudou antes da cópia dos anexos.')
    old_links = tuple(_text(expected.get(key)) for key in ('IDPEDIDO', 'IDLANCAMENTOS'))''')
    text = replace(text, '''            if not paid_source_fields or not paid_status_refreshed(source, version, current, current_version):
                raise RuntimeError('Provisão alterada durante a cópia de anexos.')''', '''            owned = (source != current and source_refresh and source_refresh(source, current))
            refreshed = paid_source_fields and paid_status_refreshed(source, version, current, current_version)
            if not owned and not refreshed:
                raise RuntimeError('Provisão alterada durante a cópia de anexos.')''')
    return text


def update_settlement(text):
    text = replace(text, '    def _description_preflight(self, state):', '''    def _description_owned_progress(self, before, after, record, child_id):
        try:
            from .settlement_own_progress import owned_progress
        except ImportError:
            from settlement_own_progress import owned_progress
        if not owned_progress(before, after, record, child_id, _same):
            return False
        for ref in ('related_item', 'launch_item'):
            target = record[ref]
            if not _verified(self.sharepoint.verify_item(target['item_id'],
                    target['expected_fields'], [], target_list=target['target_list'])):
                return False
        return True

    def _description_preflight(self, state):''')
    text = replace(text, '''            for key in CHILD_FIELDS:
                if not _same(key, original.get(key), current.get(key)):''', '''            if (in_flight.get('id') == item_id and in_flight.get('record')
                    and self._description_owned_progress(
                        {key: original.get(key) for key in CHILD_FIELDS}, current,
                        in_flight['record'], item_id)):
                continue
            for key in CHILD_FIELDS:
                if not _same(key, original.get(key), current.get(key)):''')
    text = replace(text, '''                    if any(not _same(key, live.get(key), original.get(key)) for key in CHILD_FIELDS):
                        raise RuntimeError(f'A provisão {item_id} mudou durante a baixa. A retomada foi preservada.')''', '''                    in_flight = journal.get('in_flight') or {}
                    unchanged = all(_same(key, live.get(key), original.get(key)) for key in CHILD_FIELDS)
                    if not unchanged and not (in_flight.get('id') == item_id and in_flight.get('record')
                            and self._description_owned_progress(
                                {key: original.get(key) for key in CHILD_FIELDS}, live,
                                in_flight['record'], item_id)):
                        raise RuntimeError(f'A provisão {item_id} mudou durante a baixa. A retomada foi preservada.')''')
    text = replace(text, "                    child_state['_description_child_etag'] = child_etag\n", "                    child_state['_description_child_etag'] = child_etag\n                    child_state['_description_child_source'] = copy.deepcopy(live)\n")
    return text


PATCHES = {'workflow.py': update_workflow, 'payroll_row_attachments.py': update_fanout,
           'provision_description_settlement.py': update_settlement}
