"""Exact reviewed replacements; preserve unrelated source and reject drift."""
CHANGES = [('    def _prompt_launch_payroll_sheet_for_current_supplier(\n',
  '    def _prompt_launch_payroll_assignment_mode(self, state, etag, kind):\n'
  "        pending = state['pending_launch_payroll']\n"
  "        pending['awaiting_' + kind + '_mode'] = True\n"
  "        state['stage'] = LAUNCH_PAYROLL_SHEET_STAGE if kind == 'sheet' else "
  'LAUNCH_PAYROLL_TYPE_STAGE\n'
  "        state['options'] = []\n"
  "        state.pop('option_pagination', None)\n"
  "        label = 'IDFOLHA' if kind == 'sheet' else 'TIPO DE PAGAMENTO'\n"
  "        self._send_actions(state, f'COMO DESEJA INDICAR O {label} DOS PAGAMENTOS?', [\n"
  "            {'id': f'launch_payroll_{kind}_mode_individual', 'title': 'INDICAR "
  "INDIVIDUALMENTE',\n"
  "             'reply': f'launch_payroll_{kind}_mode_individual'},\n"
  "            {'id': f'launch_payroll_{kind}_mode_shared', 'title': 'ATRIBUIR O MESMO VALOR PARA "
  "TODOS',\n"
  "             'reply': f'launch_payroll_{kind}_mode_shared'},\n"
  '        ], allow_back=False)\n'
  '        etag = self._save(state, etag)\n'
  "        return {'status': f'awaiting_launch_payroll_{kind}_mode', 'batch_id': "
  "state['batch_id'], 'etag': etag}\n"
  '\n'
  '    def _handle_launch_payroll_assignment_mode(self, event, state, etag, kind):\n'
  "        pending = state['pending_launch_payroll']\n"
  "        raw = _control_command(event.get('reply_id') or event.get('text') or '')\n"
  "        self._mark_processed(state, event.get('message_id'))\n"
  "        modes = {normalize_text(f'launch_payroll_{kind}_mode_{mode}'): mode\n"
  "                 for mode in ('individual', 'shared')}\n"
  '        if raw not in modes:\n'
  '            return self._prompt_launch_payroll_assignment_mode(state, etag, kind)\n'
  "        pending[kind + '_assignment_mode'] = modes[raw]\n"
  "        pending.pop('awaiting_' + kind + '_mode', None)\n"
  "        if kind == 'sheet':\n"
  '            return self._prompt_launch_payroll_sheet_for_current_supplier(state, etag)\n'
  '        return self._prompt_launch_payroll_type(state, etag)\n'
  '\n'
  '    def _prompt_launch_payroll_shared_month(self, state, etag):\n'
  "        pending = state['pending_launch_payroll']\n"
  '        # Freeze absolute months with the displayed question, including year rollover.\n'
  "        if not pending.get('shared_month_options'):\n"
  "            today = datetime.now(ZoneInfo('America/Sao_Paulo')).date()\n"
  '            current = (today.year, today.month)\n'
  "            pending['shared_month_options'] = [\n"
  "                {'id': offset, 'value': str(offset),\n"
  "                 'title': "
  "f'{self._launch_payroll_month_label(self._shift_launch_payroll_month(current, offset))} — "
  "{label}',\n"
  "                 'month': list(self._shift_launch_payroll_month(current, offset))}\n"
  "                for offset, label in ((0, '⭐ MÊS VIGENTE'), (-1, 'MÊS ANTERIOR'), (1, 'PRÓXIMO "
  "MÊS'))]\n"
  "        pending['awaiting_shared_month'] = True\n"
  "        pending['current_sheet_option_key'] = 'launch_payroll_shared_month'\n"
  "        state['stage'] = LAUNCH_PAYROLL_SHEET_STAGE\n"
  "        state['options'] = copy.deepcopy(pending['shared_month_options'])\n"
  "        state.pop('option_pagination', None)\n"
  '        self._send_actions(state,\n'
  "            'QUAL MÊS DESEJA APLICAR A TODOS? CADA PAGAMENTO SERÁ VINCULADO À FOLHA DO SEU "
  "FORNECEDOR.',\n"
  '            [{\'id\': f"choice:launch_payroll_shared_month:{option[\'id\']}", \'title\': '
  "option['title'],\n"
  '              \'reply\': f"choice:launch_payroll_shared_month:{option[\'id\']}"} for option in '
  "state['options']],\n"
  '            allow_back=False)\n'
  '        etag = self._save(state, etag)\n'
  "        return {'status': 'awaiting_launch_payroll_shared_month', 'batch_id': "
  "state['batch_id'], 'etag': etag}\n"
  '\n'
  '    def _handle_launch_payroll_shared_month(self, event, state, etag):\n'
  "        pending = state['pending_launch_payroll']\n"
  "        selected = resolve_option(event.get('reply_id') or event.get('text') or '',\n"
  "                                  pending.get('shared_month_options') or [], "
  "'launch_payroll_shared_month')\n"
  "        self._mark_processed(state, event.get('message_id'))\n"
  '        if not selected:\n'
  '            return self._prompt_launch_payroll_shared_month(state, etag)\n'
  "        target = tuple(selected['month'])\n"
  '        assignments = []\n'
  '        cache = {}\n'
  '        try:\n'
  "            for entry in pending.get('selected_entries') or []:\n"
  "                if entry.get('FOLHAPGTO_ID') or entry.get('IDFOLHA'):\n"
  '                    continue\n'
  "                supplier = str(entry.get('supplier') or '').strip()\n"
  '                if supplier not in cache:\n'
  '                    options = self._launch_payroll_sheets_for_supplier(supplier, '
  'month_key=target)\n'
  "                    cache[supplier] = {int(option['id']) for option in options\n"
  "                        if self._launch_payroll_month_key((option.get('source_values') or "
  "{}).get('MESREFERENCIA')) == target}\n"
  '                matches = cache[supplier]\n'
  '                if len(matches) == 1:\n'
  '                    assignments.append((entry, next(iter(matches))))\n'
  '        except Exception:\n'
  "            self._send_text(state, '❌ NÃO FOI POSSÍVEL CONSULTAR TODAS AS FOLHAS. TENTE "
  "NOVAMENTE O MESMO MÊS.')\n"
  '            result = self._prompt_launch_payroll_shared_month(state, etag)\n'
  "            return {**result, 'status': 'launch_payroll_shared_month_load_failed'}\n"
  '        # Resolve every supplier before changing the draft; failures cannot partly apply.\n'
  '        for entry, sheet_id in assignments:\n'
  "            entry['IDFOLHA'] = sheet_id\n"
  "        pending.pop('awaiting_shared_month', None)\n"
  "        pending['shared_month_applied'] = list(target)\n"
  "        if any(not entry.get('IDFOLHA') and not entry.get('FOLHAPGTO_ID')\n"
  "               for entry in pending.get('selected_entries') or []):\n"
  "            self._send_text(state, '⚠️ ALGUMAS LINHAS NÃO TÊM UMA ÚNICA FOLHA NO MÊS ESCOLHIDO. "
  "'\n"
  "                            'INDIQUE A FOLHA DESSAS LINHAS INDIVIDUALMENTE.')\n"
  '        return self._prompt_launch_payroll_sheet_for_current_supplier(state, etag)\n'
  '\n'
  '    def _prompt_launch_payroll_sheet_for_current_supplier(\n'),
 ('        # The historic method name remains compatible with persisted stages.\n',
  '        remaining = [entry for entry in selected_entries\n'
  "                     if not entry.get('IDFOLHA') and not entry.get('FOLHAPGTO_ID')]\n"
  "        if len(remaining) > 1 and not pending.get('sheet_assignment_mode'):\n"
  "            return self._prompt_launch_payroll_assignment_mode(state, etag, 'sheet')\n"
  "        if (remaining and pending.get('sheet_assignment_mode') == 'shared'\n"
  "                and not pending.get('shared_month_applied')):\n"
  '            return self._prompt_launch_payroll_shared_month(state, etag)\n'
  '        # The historic method name remains compatible with persisted stages.\n'),
 ('            if entry.get("FOLHAPGTO_ID"):\n'
  '                index += 1\n'
  '                pending["sheet_entry_index"] = index\n',
  '            if entry.get("FOLHAPGTO_ID") or entry.get("IDFOLHA"):\n'
  '                index += 1\n'
  '                pending["sheet_entry_index"] = index\n'),
 ('        raw = event.get("reply_id") or event.get("text") or ""\n'
  '        selected = resolve_option(raw, state.get("options", []), '
  'pending.get("current_sheet_option_key"))\n',
  "        if pending.get('awaiting_sheet_mode'):\n"
  "            return self._handle_launch_payroll_assignment_mode(event, state, etag, 'sheet')\n"
  "        if pending.get('awaiting_shared_month'):\n"
  '            return self._handle_launch_payroll_shared_month(event, state, etag)\n'
  "        remaining = [entry for entry in pending.get('selected_entries') or []\n"
  "                     if not entry.get('IDFOLHA') and not entry.get('FOLHAPGTO_ID')]\n"
  "        if len(remaining) > 1 and not pending.get('sheet_assignment_mode'):\n"
  '            self._mark_processed(state, message_id)\n'
  '            return self._prompt_launch_payroll_sheet_for_current_supplier(state, etag)\n'
  '        raw = event.get("reply_id") or event.get("text") or ""\n'
  '        selected = resolve_option(raw, state.get("options", []), '
  'pending.get("current_sheet_option_key"))\n'),
 ('        entry = entries[index]\n'
  '        fields = entry.get("fields") or {}\n'
  '        total = self._launch_payroll_total(fields)\n'
  '        prompt = (\n',
  "        remaining = [entry for entry in entries if not entry.get('FOLHAPGTO_ID')]\n"
  "        if len(remaining) > 1 and not pending.get('type_assignment_mode'):\n"
  "            return self._prompt_launch_payroll_assignment_mode(state, etag, 'type')\n"
  "        shared = pending.get('type_assignment_mode') == 'shared'\n"
  '        entry = entries[index]\n'
  '        fields = entry.get("fields") or {}\n'
  '        total = self._launch_payroll_total(fields)\n'
  "        if pending.get('shared_type'):\n"
  '            self._send_actions(state, f"TENTAR NOVAMENTE OS PAGAMENTOS RESTANTES COM O TIPO '
  '{pending[\'shared_type\']}?", [\n'
  "                {'id': 'launch_payroll_type_retry', 'title': 'TENTAR NOVAMENTE', 'reply': "
  "'launch_payroll_type_retry'}\n"
  '            ], allow_back=False)\n'
  "            state['stage'] = LAUNCH_PAYROLL_TYPE_STAGE\n"
  '            etag = self._save(state, etag)\n'
  "            return {'status': 'awaiting_launch_payroll_type_retry', 'batch_id': "
  "state['batch_id'], 'etag': etag}\n"
  "        prompt = 'QUAL TIPO DE PAGAMENTO DESEJA ATRIBUIR A TODOS?' if shared else (\n"),
 ('        raw = _control_command(event.get("reply_id") or event.get("text") or "")\n'
  '        selected_type = next(\n'
  '            (\n'
  '                title\n'
  '                for option_id, title in LAUNCH_PAYROLL_TYPE_OPTIONS\n',
  "        if pending.get('awaiting_type_mode'):\n"
  "            return self._handle_launch_payroll_assignment_mode(event, state, etag, 'type')\n"
  "        if (len([entry for entry in pending.get('selected_entries') or [] if not "
  "entry.get('FOLHAPGTO_ID')]) > 1\n"
  "                and not pending.get('type_assignment_mode')):\n"
  '            self._mark_processed(state, message_id)\n'
  '            return self._prompt_launch_payroll_type(state, etag)\n'
  '        raw = _control_command(event.get("reply_id") or event.get("text") or "")\n'
  "        if pending.get('shared_type'):\n"
  '            self._mark_processed(state, message_id)\n'
  "            if raw != normalize_text('launch_payroll_type_retry'):\n"
  '                return self._prompt_launch_payroll_type(state, etag)\n'
  "            return self._apply_launch_payroll_type(state, etag, pending['shared_type'])\n"
  '        selected_type = next(\n'
  '            (\n'
  '                title\n'
  '                for option_id, title in LAUNCH_PAYROLL_TYPE_OPTIONS\n'),
 ('        entry = entries[index]\n'
  '        fields = entry.get("fields") or {}\n'
  '        try:\n'
  '            launch_id = int(str(entry.get("item_id")).strip())\n'
  '            sheet_id = int(str(entry.get("IDFOLHA")).strip())\n'
  '            unit_value = _parse_decimal(fields.get("VALOR UNITÁRIO"), allow_zero=True)\n'
  '            quantity = _parse_decimal(fields.get("QUANTIDADE"), allow_zero=True)\n'
  '            if launch_id <= 0 or sheet_id <= 0 or unit_value is None or quantity is None:\n'
  '                raise ValueError("Dados obrigatórios do lançamento estão ausentes")\n'
  '            payroll_fields = {\n'
  '                "FORNECEDOR": str(fields.get("FORNECEDOR") or entry.get("supplier") or '
  '"").strip(),\n'
  '                "TIPOPGTO": selected_type,\n'
  '                "VALORUNITARIO": _decimal_storage(unit_value),\n'
  '                "QTD": _decimal_storage(quantity),\n'
  '                "DATA": str(fields.get("DATA") or "")[:10],\n'
  '                "IDFOLHA": sheet_id,\n'
  '                "IDLANCAMENTO": launch_id,\n'
  '            }\n'
  '            if not payroll_fields["FORNECEDOR"] or not payroll_fields["DATA"]:\n'
  '                raise ValueError("Fornecedor ou data do lançamento estão ausentes")\n'
  '            token = (\n'
  '                f"WA-launch-payroll-{state[\'batch_id\']}-{launch_id}"\n'
  '            )\n'
  '            if entry.get("provision_id"):\n'
  '                payroll_fields["IDPROVISAO"] = int(entry["provision_id"])\n'
  '                if entry.get("launch_id"):\n'
  '                    payroll_fields["IDLANCAMENTO"] = int(entry["launch_id"])\n'
  '                else:\n'
  '                    payroll_fields.pop("IDLANCAMENTO", None)\n'
  '                token = f"WA-provision-payroll-{entry[\'provision_id\']}"\n'
  '            payroll_item_id = self.sharepoint.ensure_item(\n'
  '                token,\n'
  '                payroll_fields,\n'
  '                target_list="FOLHAPGTO",\n'
  '                idempotency_field="Title",\n'
  '                merge_existing=False,\n'
  '            )\n'
  '            verification = self.sharepoint.verify_item(\n'
  '                payroll_item_id,\n'
  '                payroll_fields,\n'
  '                [],\n'
  '                target_list="FOLHAPGTO",\n'
  '            )\n'
  '            if entry.get("provision_id") and not (verification is True or (\n'
  '                    isinstance(verification, dict) and verification.get("fields") is True\n'
  '                    and verification.get("attachments") is True)):\n'
  '                raise RuntimeError("O vínculo à folha ainda não foi confirmado")\n'
  '        except Exception:\n'
  '            self._send_text(\n'
  '                state,\n'
  '                f"❌ NÃO FOI POSSÍVEL GRAVAR A LINHA DO LANÇAMENTO {entry.get(\'item_id\')} "\n'
  '                "EM FOLHAPGTO. A MESMA PERGUNTA SERÁ MANTIDA PARA NOVA TENTATIVA.",\n'
  '            )\n'
  '            return self._prompt_launch_payroll_type(state, etag)\n'
  '\n'
  '        entry["TIPOPGTO"] = selected_type\n'
  '        entry["FOLHAPGTO_ID"] = payroll_item_id\n'
  '        state.setdefault("sharepoint", {}).setdefault("folhapgto_rows", []).append(\n'
  '            {\n'
  '                "item_id": payroll_item_id,\n'
  '                "launch_item_id": launch_id,\n'
  '                "fields": copy.deepcopy(payroll_fields),\n'
  '                "verified": verification,\n'
  '            }\n'
  '        )\n'
  '        pending["type_index"] = index + 1\n'
  '        if pending["type_index"] < len(entries):\n'
  '            self._send_text(state, f"✅ LANÇAMENTO {launch_id} ADICIONADO À FOLHAPGTO.")\n'
  '            return self._prompt_launch_payroll_type(state, etag)\n'
  '        self._send_text(\n'
  '            state,\n'
  '            f"✅ {len(entries)} LANÇAMENTO(S) ADICIONADO(S) À FOLHAPGTO.",\n'
  '        )\n'
  '        return self._continue_launch_after_payroll(state, etag)\n'
  '\n',
  "        if pending.get('type_assignment_mode') == 'shared':\n"
  "            pending['shared_type'] = selected_type\n"
  '            # Freeze the collective choice before any remote write can succeed.\n'
  '            etag = self._save(state, etag)\n'
  '        return self._apply_launch_payroll_type(state, etag, selected_type)\n'
  '\n'
  '    def _apply_launch_payroll_type(self, state, etag, selected_type):\n'
  "        pending = state['pending_launch_payroll']\n"
  "        entries = pending.get('selected_entries') or []\n"
  "        index = int(pending.get('type_index', 0))\n"
  "        shared = pending.get('type_assignment_mode') == 'shared'\n"
  '        while index < len(entries):\n'
  '            entry = entries[index]\n'
  "            if not entry.get('FOLHAPGTO_ID'):\n"
  '                try:\n'
  '                    self._record_launch_payroll_type(state, entry, selected_type)\n'
  '                except Exception:\n'
  '                    self._send_text(state, f"❌ NÃO FOI POSSÍVEL CONFIRMAR O PAGAMENTO '
  '{entry.get(\'item_id\')}. TENTE NOVAMENTE.")\n'
  '                    return self._prompt_launch_payroll_type(state, etag)\n'
  '            index += 1\n'
  "            pending['type_index'] = index\n"
  '            # Each verified line becomes a durable checkpoint before the next write.\n'
  '            etag = self._save(state, etag)\n'
  '            if not shared and index < len(entries):\n'
  '                return self._prompt_launch_payroll_type(state, etag)\n'
  "        self._send_text(state, f'✅ {len(entries)} PAGAMENTO(S) ADICIONADO(S) À FOLHAPGTO.')\n"
  '        return self._continue_launch_after_payroll(state, etag)\n'
  '\n'
  '    def _record_launch_payroll_type(self, state, entry, selected_type):\n'
  "        fields = entry.get('fields') or {}\n"
  '        launch_id = int(str(entry.get("item_id")).strip())\n'
  '        sheet_id = int(str(entry.get("IDFOLHA")).strip())\n'
  '        unit_value = _parse_decimal(fields.get("VALOR UNITÁRIO"), allow_zero=True)\n'
  '        quantity = _parse_decimal(fields.get("QUANTIDADE"), allow_zero=True)\n'
  '        if launch_id <= 0 or sheet_id <= 0 or unit_value is None or quantity is None:\n'
  '            raise ValueError("Dados obrigatórios do lançamento estão ausentes")\n'
  '        payroll_fields = {\n'
  '            "FORNECEDOR": str(fields.get("FORNECEDOR") or entry.get("supplier") or '
  '"").strip(),\n'
  '            "TIPOPGTO": selected_type,\n'
  '            "VALORUNITARIO": _decimal_storage(unit_value),\n'
  '            "QTD": _decimal_storage(quantity),\n'
  '            "DATA": str(fields.get("DATA") or "")[:10],\n'
  '            "IDFOLHA": sheet_id,\n'
  '            "IDLANCAMENTO": launch_id,\n'
  '        }\n'
  '        if not payroll_fields["FORNECEDOR"] or not payroll_fields["DATA"]:\n'
  '            raise ValueError("Fornecedor ou data do lançamento estão ausentes")\n'
  '        token = (\n'
  '            f"WA-launch-payroll-{state[\'batch_id\']}-{launch_id}"\n'
  '        )\n'
  '        if entry.get("provision_id"):\n'
  '            payroll_fields["IDPROVISAO"] = int(entry["provision_id"])\n'
  '            if entry.get("launch_id"):\n'
  '                payroll_fields["IDLANCAMENTO"] = int(entry["launch_id"])\n'
  '            else:\n'
  '                payroll_fields.pop("IDLANCAMENTO", None)\n'
  '            token = f"WA-provision-payroll-{entry[\'provision_id\']}"\n'
  '        payroll_item_id = self.sharepoint.ensure_item(\n'
  '            token,\n'
  '            payroll_fields,\n'
  '            target_list="FOLHAPGTO",\n'
  '            idempotency_field="Title",\n'
  '            merge_existing=False,\n'
  '        )\n'
  '        verification = self.sharepoint.verify_item(\n'
  '            payroll_item_id,\n'
  '            payroll_fields,\n'
  '            [],\n'
  '            target_list="FOLHAPGTO",\n'
  '        )\n'
  '        if entry.get("provision_id") and not (verification is True or (\n'
  '                isinstance(verification, dict) and verification.get("fields") is True\n'
  '                and verification.get("attachments") is True)):\n'
  '            raise RuntimeError("O vínculo à folha ainda não foi confirmado")\n'
  '        entry["TIPOPGTO"] = selected_type\n'
  '        entry["FOLHAPGTO_ID"] = payroll_item_id\n'
  '        state.setdefault("sharepoint", {}).setdefault("folhapgto_rows", []).append(\n'
  '            {\n'
  '                "item_id": payroll_item_id,\n'
  '                "launch_item_id": launch_id,\n'
  '                "fields": copy.deepcopy(payroll_fields),\n'
  '                "verified": verification,\n'
  '            }\n'
  '        )\n'
  '\n'),
 ('    def _launch_payroll_sheets_for_supplier(self, supplier: str) -> list[dict]:\n',
  '    def _launch_payroll_sheets_for_supplier(self, supplier: str, *, month_key=None) -> '
  'list[dict]:\n'),
 ('        valid_rows = []\n'
  '        for option in rows:\n'
  '            source = option.get("source_values") or {}\n'
  '            row_supplier = source.get("FORNECEDOR")\n',
  '        if month_key is not None:\n'
  "            month_order = [(tuple(month_key), 'MÊS ESCOLHIDO', False)]\n"
  '        valid_rows = []\n'
  '        for option in rows:\n'
  '            source = option.get("source_values") or {}\n'
  '            row_supplier = source.get("FORNECEDOR")\n'),
 ('                {"id": option_id, "title": title, "reply": option_id}\n'
  '                for option_id, title in LAUNCH_PAYROLL_TYPE_OPTIONS\n',
  '                {"id": (f"launch_payroll_type_for_{entry[\'item_id\']}:{option_id}"\n'
  "                         if pending.get('type_assignment_mode') == 'individual' else "
  'option_id),\n'
  '                 "title": title,\n'
  '                 "reply": (f"launch_payroll_type_for_{entry[\'item_id\']}:{option_id}"\n'
  "                            if pending.get('type_assignment_mode') == 'individual' else "
  'option_id)}\n'
  '                for option_id, title in LAUNCH_PAYROLL_TYPE_OPTIONS\n'),
 ('        selected_type = next(\n'
  '            (\n'
  '                title\n'
  '                for option_id, title in LAUNCH_PAYROLL_TYPE_OPTIONS\n',
  "        scoped = re.fullmatch(r'launch_payroll_type_for_(\\d+):(launch_payroll_type_\\w+)',\n"
  "                              str(event.get('reply_id') or event.get('text') or ''), "
  'flags=re.IGNORECASE)\n'
  '        if scoped:\n'
  "            entries = pending.get('selected_entries') or []\n"
  "            index = int(pending.get('type_index', 0))\n"
  "            if index >= len(entries) or str(entries[index]['item_id']) != scoped.group(1):\n"
  '                self._mark_processed(state, message_id)\n'
  '                return self._prompt_launch_payroll_type(state, etag)\n'
  '            raw = _control_command(scoped.group(2))\n'
  '        selected_type = next(\n'
  '            (\n'
  '                title\n'
  '                for option_id, title in LAUNCH_PAYROLL_TYPE_OPTIONS\n'),
 ('        if entry.get("provision_id") and not (verification is True or (\n'
  '                isinstance(verification, dict) and verification.get("fields") is True\n'
  '                and verification.get("attachments") is True)):\n',
  '        if not (verification is True or (\n'
  '                isinstance(verification, dict) and verification.get("fields") is True\n'
  '                and verification.get("attachments") is True)):\n'),
 ('        elif stage == LAUNCH_PAYROLL_SHEET_STAGE:\n'
  '            self._prompt_launch_payroll_sheet_for_current_supplier(\n'
  '                state, etag\n'
  '            )\n'
  '        elif stage == LAUNCH_PAYROLL_TYPE_STAGE:\n'
  '            self._prompt_launch_payroll_type(state, etag)\n',
  '        elif stage == LAUNCH_PAYROLL_SHEET_STAGE:\n'
  '            return self._prompt_launch_payroll_sheet_for_current_supplier(\n'
  '                state, etag\n'
  '            )\n'
  '        elif stage == LAUNCH_PAYROLL_TYPE_STAGE:\n'
  '            return self._prompt_launch_payroll_type(state, etag)\n')]

def change(data):
    text = data.decode('utf-8')
    for before, after in CHANGES:
        if text.count(before) != 1:
            raise RuntimeError('Expected workflow anchor exactly once')
        text = text.replace(before, after)
    compile(text, 'workflow.py', 'exec')
    return text.encode('utf-8')
