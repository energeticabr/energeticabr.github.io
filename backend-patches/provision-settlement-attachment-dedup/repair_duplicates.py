"""Back up and remove only confirmed generated duplicates in one linked payment.

Dry-run by default. Applying requires the exact live plan hash and a new private
backup directory. Originals, source provision and financial fields are retained.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path


def duplicate_plan(files, source, child):
    result = []
    for name, digest in sorted(files.items()):
        match = re.match(r'^PROV-([1-9][0-9]*)-([a-f0-9]{64})-', name)
        if not match or int(match[1]) != child or match[2] != digest or digest not in source.values():
            continue
        retained = next((n for n, d in sorted(files.items())
                         if d == digest and not n.startswith('PROV-')), None)
        if retained is not None:
            result.append({'remove': name, 'retain': retained, 'sha256': digest})
    return result


def run(client, launch, order, child, parent, backup=None, apply_hash=None):
    from provision_attachment_sync import SharePointStore
    store = SharePointStore(client)
    child_kind, launch_kind, order_kind = 'PROVISÃO PGTOS', 'LANCAMENTOS', 'NOTASPENDENTES'
    fields = {
        (child_kind, child): ('FORNECEDOR','FILIAL','DESCRITIVOPROVISAO','IDPEDIDO','IDLANCAMENTOS','PGTOAGENDADO'),
        (launch_kind, launch): ('FORNECEDOR','FILIAL','IDPGTOAGENDADO','AGRUPAR'),
        (order_kind, order): ('FORNECEDOR','FILIAL'),
        ('DESCRITIVOPROVISAO', parent): ('FORNECEDOR','FILIAL'),
    }
    def owners():
        rows = {key: client.get_item_fields_with_etag(key[1], names, target_list=key[0])[0]
                for key, names in fields.items()}
        c, l, o, p = (rows[key] for key in fields)
        text = lambda value: str(value or '').strip()
        if (text(c['IDLANCAMENTOS']) != str(launch) or text(c['IDPEDIDO']) != str(order)
                or text(c['DESCRITIVOPROVISAO']) != str(parent) or text(c['PGTOAGENDADO']) != 'PAGO'
                or text(l['IDPGTOAGENDADO']) != str(child) or text(l['AGRUPAR']) != str(order)
                or not all(text(c[k]) and text(c[k]) == text(l[k]) for k in ('FORNECEDOR','FILIAL'))
                or text(o['FILIAL']) != text(c['FILIAL']) or text(p['FILIAL']) != text(c['FILIAL'])
                or not (text(o['FORNECEDOR']) == text(c['FORNECEDOR']) or
                        text(o['FORNECEDOR']).casefold() == text(p['FORNECEDOR']).casefold() == 'diversos')):
            raise RuntimeError('Linked paid payment/owners differ; no duplicate removed')
        return rows
    ownership = owners()
    def inventory(kind, ident):
        return {n: store.digest(kind, ident, n) for n in sorted(store.names(kind, ident))}
    source = inventory(child_kind, child)
    targets = [(launch_kind, launch), (order_kind, order)]
    files = {key: inventory(*key) for key in targets}
    plans = [{'list': kind, 'id': ident, 'files': files[kind, ident],
              'duplicates': duplicate_plan(files[kind, ident], source, child)} for kind, ident in targets]
    evidence = {'launch': launch, 'order': order, 'child': child, 'parent': parent,
                'owners': [[kind, ident, row] for (kind, ident), row in ownership.items()],
                'source': source, 'targets': plans}
    encoded = json.dumps(evidence, ensure_ascii=False, sort_keys=True).encode()
    plan_hash = hashlib.sha256(encoded).hexdigest()
    report = {'status': 'planned', 'planHash': plan_hash,
              'targets': [{'list': p['list'], 'id': p['id'], 'before': len(p['files']),
                           'after': len(p['files'])-len(p['duplicates'])} for p in plans]}
    if apply_hash is None:
        return report
    if apply_hash != plan_hash or backup is None:
        raise RuntimeError('Live duplicate plan changed or private backup missing')
    backup = Path(backup)
    backup.mkdir(mode=0o700, parents=True, exist_ok=False)
    # Save all target bytes and the exact pre-mutation evidence before deleting.
    for (kind, ident), entries in files.items():
        for name, digest in entries.items():
            content = store.content(kind, ident, name)
            if hashlib.sha256(content).hexdigest() != digest:
                raise RuntimeError('Attachment changed before backup')
            path = backup / (digest + '.bin')
            path.write_bytes(content)
            path.chmod(0o600)
            if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
                raise RuntimeError('Private attachment backup verification failed')
    manifest = backup/'manifest.json'
    manifest.write_bytes(encoded)
    manifest.chmod(0o600)
    removed = []
    for p in plans:
        kind, ident = p['list'], p['id']
        expected = dict(p['files'])
        for pair in p['duplicates']:
            if (owners() != ownership or inventory(child_kind, child) != source
                    or inventory(kind, ident) != expected):
                raise RuntimeError('Attachment/link changed before removal; backup retained')
            if store.digest(kind, ident, pair['retain']) != pair['sha256']:
                raise RuntimeError('Retained original differs; duplicate preserved')
            client.delete_attachment(ident, pair['remove'], target_list=kind)
            expected.pop(pair['remove'])
            if inventory(kind, ident) != expected:
                raise RuntimeError('Duplicate removal did not verify; backup retained')
            removed.append({'list':kind,'id':ident,**pair})
            (backup/'removed.json').write_text(json.dumps(removed),encoding='utf-8')
        if set(expected.values()) != set(p['files'].values()):
            raise RuntimeError('Distinct content changed')
    if owners() != ownership or inventory(child_kind, child) != source:
        raise RuntimeError('Source/financial linkage changed during repair')
    for p in plans:
        expected = {n:d for n,d in p['files'].items()
                    if n not in {pair['remove'] for pair in p['duplicates']}}
        if inventory(p['list'], p['id']) != expected:
            raise RuntimeError('Final target inventories changed after repair')
    return {**report, 'status':'repaired', 'backup':str(backup), 'removed':len(removed)}


if __name__ == '__main__':
    import os, sys
    sys.path[:0] = ['/opt/energetica-whatsapp','/opt/energetica-whatsapp/worker']
    from local_app import load_env
    from clients import SharePointClient
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('launch','order','child','parent'):
        parser.add_argument('--'+key,type=int,required=True)
    parser.add_argument('--apply-hash')
    parser.add_argument('--backup',type=Path)
    args = parser.parse_args()
    load_env(Path('/etc/energetica-whatsapp.env'))
    client = SharePointClient(os.environ['SHAREPOINT_HOST'],os.environ['SHAREPOINT_SITE_PATH'],
        os.environ['ENTRA_TENANT_ID'],os.environ['ENTRA_CLIENT_ID'],
        Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
        Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(),'DOCUMENTOS')
    print(json.dumps(run(client,args.launch,args.order,args.child,args.parent,args.backup,args.apply_hash)))
