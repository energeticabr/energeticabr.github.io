"""Scoped presentation changes; exact anchors reject drift."""
CHANGES = {'channel_bridge.py': [('            and (detail_table.get("kind") == "presence" or (\n',
                        '            and (detail_table.get("kind") == "presence" or (\n'
                        '                detail_table.get("kind") == "payroll_assignment"\n'
                        '                and state.get("flow") in {"launch", '
                        '"payment_settlement"}\n'
                        '                and state.get("stage") in '
                        '{"selecting_launch_payroll_sheet", "selecting_launch_payroll_type"}\n'
                        '                and isinstance(state.get("pending_launch_payroll"), '
                        'dict)\n'
                        '            ) or (\n')],
 'worker/workflow.py': [('    def _prompt_launch_payroll_assignment_mode(self, state, etag, '
                         'kind):\n',
                         '    def _launch_payroll_assignment_prompt(self, state, prompt, '
                         'entries):\n'
                         "        rows = [{'id': str(entry.get('provision_id') or "
                         "entry['item_id']),\n"
                         "                 'supplier': str(entry.get('supplier') or "
                         "(entry.get('fields') or {}).get('FORNECEDOR') or ''),\n"
                         "                 'totalDisplay': "
                         "_currency_display(self._launch_payroll_total(entry.get('fields') or "
                         '{}))}\n'
                         "                for entry in entries if not entry.get('FOLHAPGTO_ID')]\n"
                         '        if not rows:\n'
                         '            return prompt\n'
                         "        state['_outbound_detail_table'] = {'kind': 'payroll_assignment', "
                         "'rows': rows}\n"
                         '        # A complete readable fallback remains available to older '
                         'clients/channels.\n'
                         "        return prompt + '\\n\\nID | FORNECEDOR | VALOR TOTAL\\n' + "
                         "'\\n'.join(\n"
                         '            f"{row[\'id\']} | {\' \'.join(row[\'supplier\'].split())} | '
                         '{row[\'totalDisplay\']}" for row in rows)\n'
                         '\n'
                         '    def _prompt_launch_payroll_assignment_mode(self, state, etag, '
                         'kind):\n'),
                        ("        self._send_actions(state, f'COMO DESEJA INDICAR O {label} DOS "
                         "PAGAMENTOS?', [\n",
                         "        affected = [entry for entry in pending.get('selected_entries') "
                         'or []\n'
                         "                    if not entry.get('FOLHAPGTO_ID') and (kind == 'type' "
                         "or not entry.get('IDFOLHA'))]\n"
                         '        prompt = self._launch_payroll_assignment_prompt(state,\n'
                         "            f'COMO DESEJA INDICAR O {label} DOS PAGAMENTOS?', affected)\n"
                         '        self._send_actions(state, prompt, [\n'),
                        ("            'QUAL MÊS DESEJA APLICAR A TODOS? CADA PAGAMENTO SERÁ "
                         "VINCULADO À FOLHA DO SEU FORNECEDOR.',\n",
                         '            self._launch_payroll_assignment_prompt(state,\n'
                         "                'QUAL MÊS DESEJA APLICAR A TODOS? CADA PAGAMENTO SERÁ "
                         "VINCULADO À FOLHA DO SEU FORNECEDOR.',\n"
                         "                [entry for entry in pending.get('selected_entries') or "
                         "[] if not entry.get('IDFOLHA')]),\n"),
                        ('                        f"PAGAMENTO {index + 1} DE '
                         "{len(selected_entries)} — {'PROVISÃO' if entry.get('provision_id') else "
                         '\'LANÇAMENTO\'} ID {launch_id} "\n'
                         '                        f"— {supplier} — VALOR TOTAL {total}. "\n'
                         '                        "A QUAL FOLHA DESEJA VINCULAR ESTE PAGAMENTO?"\n',
                         '                        f"PAGAMENTO {index + 1} DE '
                         '{len(selected_entries)} — "\n'
                         '                        "A QUAL FOLHA DESEJA VINCULAR ESTE '
                         'PAGAMENTO?"\n'),
                        ('        """Resolve o valor automático exibido em perguntas de '
                         'confirmação."""\n',
                         '        """Resolve o valor automático exibido em perguntas de '
                         'confirmação."""\n'
                         "        pending = state.get('pending_launch_payroll') or {}\n"
                         "        if (state.get('flow') in {'launch', 'payment_settlement'}\n"
                         "                and state.get('stage') == LAUNCH_PAYROLL_SHEET_STAGE\n"
                         "                and step.get('key') == "
                         "pending.get('current_sheet_option_key')\n"
                         "                and str(step.get('key') or "
                         "'').startswith('launch_payroll_sheet_')):\n"
                         "            entries = pending.get('selected_entries') or []\n"
                         "            index = int(pending.get('sheet_entry_index', 0))\n"
                         '            if 0 <= index < len(entries):\n'
                         "                prompt = str(step.get('prompt') or '').split('\\n\\nID | "
                         "FORNECEDOR | VALOR TOTAL')[0]\n"
                         "                step = {**step, 'prompt': "
                         'self._launch_payroll_assignment_prompt(state, prompt, '
                         '[entries[index]])}\n'),
                        ('            self._send_actions(state, f"TENTAR NOVAMENTE OS PAGAMENTOS '
                         'RESTANTES COM O TIPO {pending[\'shared_type\']}?", [\n',
                         '            retry_prompt = '
                         'self._launch_payroll_assignment_prompt(state,\n'
                         '                f"TENTAR NOVAMENTE OS PAGAMENTOS RESTANTES COM O TIPO '
                         '{pending[\'shared_type\']}?", remaining)\n'
                         '            self._send_actions(state, retry_prompt, [\n'),
                        ("        prompt = 'QUAL TIPO DE PAGAMENTO DESEJA ATRIBUIR A TODOS?' if "
                         'shared else (\n'
                         '            f"PARA {\'A PROVISÃO\' if entry.get(\'provision_id\') else '
                         '\'O LANÇAMENTO\'} DE ID {entry[\'item_id\']}, COM VALOR TOTAL "\n'
                         '            f"{_currency_display(total)}, QUAL O TIPO GASTO?"\n'
                         '        )\n',
                         "        prompt = 'QUAL TIPO DE PAGAMENTO DESEJA ATRIBUIR A TODOS?' if "
                         "shared else 'QUAL O TIPO DE PAGAMENTO?'\n"
                         '        prompt = self._launch_payroll_assignment_prompt(state, prompt, '
                         'remaining if shared else [entry])\n')]}

def change(relative, data):
    text=data.decode('utf-8')
    newline='\r\n' if '\r\n' in text else '\n'
    if newline=='\r\n' and text.count('\n')!=text.count('\r\n'):
        raise RuntimeError('Mixed source line endings')
    for before,after in CHANGES[relative]:
        before=before.replace('\n',newline)
        after=after.replace('\n',newline)
        if text.count(before)!=1:
            raise RuntimeError('Expected presentation anchor exactly once: '+relative)
        text=text.replace(before,after)
    compile(text,relative,'exec')
    return text.encode('utf-8')
