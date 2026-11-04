"""Exact anchored changes; preserve each root's own line endings."""
CHANGES = {'worker/workflow.py': [('    from .payroll_row_attachments import propagate as '
                         'propagate_payroll_row_attachments\n',
                         '    from .payroll_row_attachments import propagate as '
                         'propagate_payroll_row_attachments, copy_launch_to_payroll\n'),
                        ('    from payroll_row_attachments import propagate as '
                         'propagate_payroll_row_attachments\n',
                         '    from payroll_row_attachments import propagate as '
                         'propagate_payroll_row_attachments, copy_launch_to_payroll\n'),
                        ('        )\n'
                         '        if not (verification is True or (\n'
                         '                isinstance(verification, dict) and '
                         'verification.get("fields") is True\n'
                         '                and verification.get("attachments") is True)):\n'
                         '            raise RuntimeError("O vínculo à folha ainda não foi '
                         'confirmado")\n'
                         '        entry["TIPOPGTO"] = selected_type\n'
                         '        entry["FOLHAPGTO_ID"] = payroll_item_id\n'
                         '        state.setdefault("sharepoint", {}).setdefault("folhapgto_rows", '
                         '[]).append(\n'
                         '            {\n'
                         '                "item_id": payroll_item_id,\n'
                         '                "launch_item_id": launch_id,\n'
                         '                "fields": copy.deepcopy(payroll_fields),\n'
                         '                "verified": verification,\n'
                         '            }\n'
                         '        )\n'
                         '\n'
                         '    def _continue_launch_after_payroll(\n'
                         '        self, state: dict, etag: str | None\n',
                         '        )\n'
                         '        if not (verification is True or (\n'
                         '                isinstance(verification, dict) and '
                         'verification.get("fields") is True\n'
                         '                and verification.get("attachments") is True)):\n'
                         '            raise RuntimeError("O vínculo à folha ainda não foi '
                         'confirmado")\n'
                         '        payroll_attachments = []\n'
                         '        if payroll_fields.get("IDLANCAMENTO"):\n'
                         '            payroll_attachments = copy_launch_to_payroll(\n'
                         '                self.sharepoint, payroll_fields["IDLANCAMENTO"], '
                         'payroll_item_id,\n'
                         '                payroll_fields, fields,\n'
                         '            )\n'
                         '        entry["TIPOPGTO"] = selected_type\n'
                         '        entry["FOLHAPGTO_ID"] = payroll_item_id\n'
                         '        state.setdefault("sharepoint", {}).setdefault("folhapgto_rows", '
                         '[]).append(\n'
                         '            {\n'
                         '                "item_id": payroll_item_id,\n'
                         '                "launch_item_id": launch_id,\n'
                         '                "fields": copy.deepcopy(payroll_fields),\n'
                         '                "verified": verification,\n'
                         '                "attachments": payroll_attachments,\n'
                         '            }\n'
                         '        )\n'
                         '\n'
                         '    def _continue_launch_after_payroll(\n'
                         '        self, state: dict, etag: str | None\n')],
 'worker/payroll_row_attachments.py': [('"""Settlement-only child -> own launch + shared order '
                                        'attachment propagation.\n'
                                        '\n'
                                        'No financial creation, parent enumeration, scheduler or '
                                        'persistent sync state.\n'
                                        '"""\n'
                                        'try:\n'
                                        '    from .provision_attachment_sync import '
                                        'SharePointStore, copy_name, item_id, sha\n',
                                        '"""Verified attachment propagation between individual '
                                        'financial records.\n'
                                        '\n'
                                        'No financial creation, parent enumeration, scheduler or '
                                        'persistent sync state.\n'
                                        '"""\n'
                                        'try:\n'
                                        '    from .provision_attachment_sync import '
                                        'SharePointStore, copy_name, item_id, sha\n'),
                                       ('\n'
                                        '\n'
                                        'def _verified(value):\n'
                                        '    return value is True or (isinstance(value, dict) and '
                                        "value.get('fields') is True\n"
                                        "                             and value.get('attachments') "
                                        'is True)\n'
                                        '\n'
                                        '\n'
                                        'def propagate(client, child, expected, record, '
                                        'parent=None):\n'
                                        '    """Use confirmed generated IDs or freshly verified '
                                        'existing financial links.\n'
                                        '\n',
                                        '\n'
                                        '\n'
                                        'def _verified(value):\n'
                                        '    return value is True or (isinstance(value, dict) and '
                                        "value.get('fields') is True\n"
                                        "                             and value.get('attachments') "
                                        'is True)\n'
                                        '\n'
                                        '\n'
                                        'def copy_launch_to_payroll(client, launch, payroll, '
                                        'expected, source_expected):\n'
                                        '    """One destination file per source filename, '
                                        'including identical contents.\n'
                                        '\n'
                                        '    Success is a read-back checkpoint, never just a '
                                        'successful upload response.\n'
                                        "    The financial row is created by the caller's existing "
                                        'idempotent token.\n'
                                        '    """\n'
                                        '    launch, payroll = item_id(launch), item_id(payroll)\n'
                                        "    if item_id(expected.get('IDLANCAMENTO')) != launch:\n"
                                        "        raise RuntimeError('O lançamento não corresponde "
                                        "ao item da folha.')\n"
                                        "    ownership = {'FORNECEDOR': "
                                        "expected.get('FORNECEDOR')}\n"
                                        "    if _text(source_expected.get('FILIAL')):\n"
                                        "        ownership['FILIAL'] = source_expected['FILIAL']\n"
                                        "    if not _text(ownership['FORNECEDOR']):\n"
                                        "        raise RuntimeError('Fornecedor ausente na origem "
                                        "dos anexos.')\n"
                                        '    source, version = '
                                        'client.get_item_fields_with_etag(launch, list(ownership), '
                                        'target_list=LAUNCH)\n'
                                        '    if any(_text(source.get(key)) != _text(value) for '
                                        'key, value in ownership.items()):\n'
                                        "        raise RuntimeError('O fornecedor ou a filial do "
                                        "lançamento mudou antes da cópia.')\n"
                                        '\n'
                                        '    def guard():\n'
                                        '        current, current_version = '
                                        'client.get_item_fields_with_etag(launch, list(ownership), '
                                        'target_list=LAUNCH)\n'
                                        '        if current != source or current_version != '
                                        'version:\n'
                                        "            raise RuntimeError('Lançamento alterado "
                                        "durante a cópia dos anexos à folha.')\n"
                                        '        if not _verified(client.verify_item(payroll, '
                                        "expected, [], target_list='FOLHAPGTO')):\n"
                                        "            raise RuntimeError('O vínculo do item da "
                                        "folha mudou durante a cópia dos anexos.')\n"
                                        '\n'
                                        '    guard()\n'
                                        '    store = SharePointStore(client)\n'
                                        '    names = store.names(LAUNCH, launch)\n'
                                        '    source_names = {name.casefold() for name in names}\n'
                                        '    if len(source_names) != len(names):\n'
                                        "        raise RuntimeError('A origem contém nomes de "
                                        "anexo equivalentes no SharePoint.')\n"
                                        '    sources = []\n'
                                        '    for original in sorted(names):\n'
                                        '        content = store.content(LAUNCH, launch, '
                                        'original)\n'
                                        '        digest = sha(content)\n'
                                        '        # Filename identity matters: two source files '
                                        'with equal bytes are two\n'
                                        '        # attachments. Reserve a stable name only for a '
                                        'genuine target conflict.\n'
                                        '        suffix = copy_name(launch, digest, '
                                        "original).split('-', 3)[-1]\n"
                                        '        reserved = '
                                        'f\'LANC-{launch}-{sha(original.encode("utf-8"))[:16]}-{digest}-{suffix}\'\n'
                                        '        sources.append((original, reserved, content, '
                                        'digest))\n'
                                        "    existing = {name: store.digest('FOLHAPGTO', payroll, "
                                        'name)\n'
                                        '                for name in '
                                        "sorted(store.names('FOLHAPGTO', payroll))}\n"
                                        '    folded = {name.casefold(): name for name in '
                                        'existing}\n'
                                        '    plans = []\n'
                                        '    claimed = set()\n'
                                        '    for original, reserved, content, digest in sources:\n'
                                        '        matched = folded.get(original.casefold())\n'
                                        '        name = matched if matched is not None and '
                                        'existing[matched] == digest else original\n'
                                        '        if matched is not None and existing[matched] != '
                                        'digest:\n'
                                        '            # Another source may itself be named like our '
                                        'reserved fallback.\n'
                                        '            # Reserve the full source namespace before '
                                        'assigning any copy.\n'
                                        '            candidate, counter = reserved, 0\n'
                                        '            while candidate.casefold() in source_names or '
                                        'candidate.casefold() in claimed:\n'
                                        '                counter += 1\n'
                                        '                candidate = '
                                        "reserved.replace(f'-{digest}-', f'-{digest}-{counter}-', "
                                        '1)\n'
                                        '            reserved = candidate\n'
                                        '            name = folded.get(reserved.casefold(), '
                                        'reserved)\n'
                                        '        if name.casefold() in claimed:\n'
                                        "            raise RuntimeError('Dois anexos de origem não "
                                        "podem compartilhar um arquivo na folha.')\n"
                                        '        if name in existing and existing[name] != '
                                        'digest:\n'
                                        "            raise RuntimeError('Conflito de conteúdo no "
                                        "anexo da folha; nenhum arquivo foi substituído.')\n"
                                        '        plans.append((original, name, content, digest, '
                                        'name in existing))\n'
                                        '        claimed.add(name.casefold())\n'
                                        '        existing[name] = digest\n'
                                        '        folded[name.casefold()] = name\n'
                                        '    guard()\n'
                                        '    for original, name, content, digest, reused in '
                                        'plans:\n'
                                        '        guard()\n'
                                        '        if not reused:\n'
                                        '            try:\n'
                                        '                client._ensure_attachment_local(payroll, '
                                        "name, content, target_list='FOLHAPGTO')\n"
                                        '            except Exception:\n'
                                        "                if name not in store.names('FOLHAPGTO', "
                                        "payroll) or store.digest('FOLHAPGTO', payroll, name) != "
                                        'digest:\n'
                                        '                    raise\n'
                                        "        if store.digest('FOLHAPGTO', payroll, name) != "
                                        'digest:\n'
                                        "            raise RuntimeError('Cópia do anexo à folha "
                                        "não confirmada por SHA-256.')\n"
                                        '    guard()\n'
                                        '    if store.names(LAUNCH, launch) != names:\n'
                                        "        raise RuntimeError('A coleção de anexos do "
                                        "lançamento mudou durante a cópia à folha.')\n"
                                        '    for original, name, content, digest, reused in '
                                        'plans:\n'
                                        '        if (store.digest(LAUNCH, launch, original) != '
                                        'digest\n'
                                        "                or store.digest('FOLHAPGTO', payroll, "
                                        'name) != digest):\n'
                                        "            raise RuntimeError('O conteúdo de origem ou "
                                        "destino mudou durante a cópia à folha.')\n"
                                        '    guard()\n'
                                        "    return [{'source': original, 'name': name, 'sha256': "
                                        'digest}\n'
                                        '            for original, name, content, digest, reused '
                                        'in plans]\n'
                                        '\n'
                                        '\n'
                                        'def propagate(client, child, expected, record, '
                                        'parent=None):\n'
                                        '    """Use confirmed generated IDs or freshly verified '
                                        'existing financial links.\n'
                                        '\n')]}


def change(relative, data):
    newline = b'\r\n' if b'\r\n' in data else b'\n'
    if newline == b'\r\n' and data.count(b'\n') != data.count(b'\r\n'):
        raise RuntimeError('Mixed source line endings')
    text = data.replace(b'\r\n', b'\n').decode('utf-8')
    for before, after in CHANGES[relative]:
        if text.count(before) != 1:
            raise RuntimeError('Expected attachment anchor exactly once: ' + relative)
        text = text.replace(before, after, 1)
    return text.encode('utf-8').replace(b'\n', newline)
