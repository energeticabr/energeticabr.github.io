"""Original description files -> one provision and existing financial records.

Never creates/updates/deletes financial records. Child-origin mirror files remain
row-scoped. Callers share the existing description attachment lock.
"""
from pathlib import Path
import re
import time

try:
    from . import provision_attachment_sync as mirror
except ImportError:
    import provision_attachment_sync as mirror

CHILD, PARENT = mirror.CHILD, mirror.PARENT
LAUNCH, ORDER = 'LANCAMENTOS', 'NOTASPENDENTES'
OWNER = ('FORNECEDOR', 'FILIAL')
FIELDS = (*OWNER, 'DESCRITIVOPROVISAO', 'IDPEDIDO', 'IDLANCAMENTOS')


def text(value):
    return '' if value is None else str(value).strip()


def children(store, parent):
    field = store.client._internal_field(CHILD, 'DESCRITIVOPROVISAO')
    rows = store.collection(store.client._list_endpoint(CHILD) + '/items',
        {'$select': 'Id', '$filter': f"{field} eq '{mirror.item_id(parent)}'", '$top': '5000'})
    ids = [mirror.item_id(row.get('Id')) for row in rows]
    if len(ids) != len(set(ids)):
        raise ValueError('Provisão duplicada na consulta de vínculos.')
    return sorted(ids)


def snapshot(client, store, parent):
    owner, version = client.get_item_fields_with_etag(parent, OWNER, target_list=PARENT)
    if any(not text(owner.get(k)) for k in OWNER):
        raise RuntimeError('Fornecedor/filial ausente no descritivo.')
    ids = children(store, parent)
    if not ids:
        raise mirror.MissingLink('Anexo preservado no descritivo; aguardando provisão vinculada.')
    rows, targets = {}, {}
    for ident in ids:
        row, _ = client.get_item_fields_with_etag(ident, FIELDS, target_list=CHILD)
        if any(text(row.get(k)) != text(owner[k]) for k in OWNER) or text(row.get('DESCRITIVOPROVISAO')) != str(parent):
            raise RuntimeError('Vínculo/fornecedor/filial da provisão divergente.')
        rows[ident] = row
        links = tuple(text(row.get(k)) for k in ('IDPEDIDO', 'IDLANCAMENTOS'))
        if links == ('', ''):
            continue
        if not all(links):
            raise RuntimeError('Vínculos financeiros incompletos; anexo original preservado.')
        order, launch = map(mirror.item_id, links)
        # One launch per existing order is sufficient for group-wide documents.
        if order not in targets:
            targets[order] = (ident, launch)
        expected = {**owner, 'IDPGTOAGENDADO': str(ident), 'AGRUPAR': str(order)}
        for kind, target, fields in ((LAUNCH, launch, expected), (ORDER, order, owner)):
            live, _ = client.get_item_fields_with_etag(target, tuple(fields), target_list=kind)
            if any(text(live.get(k)) != text(v) for k, v in fields.items()):
                raise RuntimeError('Vínculo financeiro divergente antes da cópia de anexos.')
    return {'owner': owner, 'version': version, 'rows': rows, 'targets': targets}


def sync(client, parent, filenames=None, dry_run=False, directory=None):
    parent = mirror.item_id(parent)
    directory = Path(directory) if directory is not None else mirror.STATE_DIR
    store = mirror.SharePointStore(client)
    with mirror.parent_lock(directory / 'locks', parent):
        before = snapshot(client, store, parent)
        names = store.names(PARENT, parent)
        selected = names if filenames is None else set(filenames)
        if not selected <= names:
            raise RuntimeError('Anexo original não confirmado no descritivo.')
        carrier = min(before['rows'])
        destinations = [(CHILD, carrier)]
        for order, (ident, launch) in sorted(before['targets'].items()):
            destinations.extend(((LAUNCH, launch), (ORDER, order)))

        def guard():
            if snapshot(client, store, parent) != before or store.names(PARENT, parent) != names:
                raise RuntimeError('Vínculo ou coleção de anexos alterado durante a cópia.')

        target_children = {(CHILD, carrier): carrier}
        for order, (ident, launch) in before['targets'].items():
            target_children.update({(LAUNCH, launch): ident, (ORDER, order): ident})

        def guard_target(kind, ident):
            # Full group checks bracket each file. Between them, revalidate only
            # the source and exact destination edge, keeping REST traffic linear.
            owner, version = client.get_item_fields_with_etag(parent, OWNER, target_list=PARENT)
            if owner != before['owner'] or version != before['version'] or store.names(PARENT, parent) != names:
                raise RuntimeError('Descritivo ou coleção de anexos alterado durante a cópia.')
            child = target_children[kind, ident]
            row, _ = client.get_item_fields_with_etag(child, FIELDS, target_list=CHILD)
            if row != before['rows'][child]:
                raise RuntimeError('Vínculo da provisão alterado durante a cópia.')
            if kind != CHILD:
                expected = dict(owner)
                if kind == LAUNCH:
                    expected.update(IDPGTOAGENDADO=str(child), AGRUPAR=text(row['IDPEDIDO']))
                live, _ = client.get_item_fields_with_etag(ident, tuple(expected), target_list=kind)
                if any(text(live.get(k)) != text(v) for k, v in expected.items()):
                    raise RuntimeError('Destino financeiro divergente durante a cópia.')

        inventory = {(kind, ident): {n: store.digest(kind, ident, n)
                     for n in sorted(store.names(kind, ident))} for kind, ident in destinations}
        report = {'parent': parent, 'copied': 0, 'reused': 0, 'planned': 0, 'files': [], 'quarantined': []}
        for original in sorted(selected):
            # One source body at a time, never an in-memory batch of documents.
            content = store.content(PARENT, parent, original)
            digest = mirror.sha(content)
            child_copy = re.match(r'^PROV-([1-9][0-9]*)-([a-f0-9]{64})-', original)
            if child_copy and child_copy[2] == digest:
                ident = int(child_copy[1])
                if ident not in before['rows'] or not any(store.digest(CHILD, ident, n) == digest for n in store.names(CHILD, ident)):
                    report['quarantined'].append(original)
                # The reserved mirror namespace retains provenance even if its
                # original was removed or the child was relinked. Never promote
                # retained row documents into group-wide evidence.
                continue
            copied_name = 'DESC-' + mirror.copy_name(parent, digest, original)[5:]
            # Validate this file's complete target plan before the first write.
            plan = []
            for kind, ident in destinations:
                existing = inventory[kind, ident]
                name = next((n for n, d in existing.items() if d == digest), copied_name)
                if name in existing and existing[name] != digest:
                    raise RuntimeError('Conflito de conteúdo; nenhum anexo foi substituído.')
                plan.append((kind, ident, name, name in existing))
            guard()
            if store.digest(PARENT, parent, original) != digest:
                raise RuntimeError('Conteúdo original alterado antes da cópia.')
            for kind, ident, name, reused in plan:
                guard_target(kind, ident)
                if not reused and not dry_run:
                    # Fresh inventory protects a name collision introduced after planning.
                    if name not in store.names(kind, ident):
                        try:
                            client._ensure_attachment_local(ident, name, content, target_list=kind)
                        except Exception:
                            if name not in store.names(kind, ident) or store.digest(kind, ident, name) != digest:
                                raise
                    if store.digest(kind, ident, name) != digest:
                        raise RuntimeError('A cópia do anexo não passou na conferência SHA-256.')
                if not dry_run and store.digest(kind, ident, name) != digest:
                    raise RuntimeError('Anexo de destino divergente na conferência SHA-256.')
                report['reused' if reused else 'planned' if dry_run else 'copied'] += 1
                report['files'].append({'target_list': kind, 'item_id': ident, 'source': original, 'name': name, 'sha256': digest})
                inventory[kind, ident][name] = digest
            guard()
            if store.digest(PARENT, parent, original) != digest:
                raise RuntimeError('Conteúdo original alterado durante a cópia.')
        guard()
        originals = {entry['source']: entry['sha256'] for entry in report['files']}
        for original, digest in originals.items():
            if store.digest(PARENT, parent, original) != digest:
                raise RuntimeError('Conteúdo original alterado na conferência final.')
        for entry in report['files']:
            if not dry_run and store.digest(entry['target_list'], entry['item_id'], entry['name']) != entry['sha256']:
                raise RuntimeError('Destino alterado na conferência SHA-256 final.')
        guard()
        return report


def reconcile(client, cache, now=None, dry_run=False):
    """Existing two-minute timer retries partial failures and direct-SP uploads."""
    now = time.time() if now is None else now
    store = mirror.SharePointStore(client)
    report = {'checked': 0, 'cached': 0, 'copied': 0, 'reused': 0, 'planned': 0, 'unlinked': 0, 'errors': []}
    rows = store.collection(client._list_endpoint(PARENT) + '/items',
                            {'$select': 'Id,Attachments', '$filter': 'Attachments eq true', '$top': '5000'})
    for row in rows:
        parent = mirror.item_id(row.get('Id'))
        try:
            # Include links and inventories, not just parent Modified (SP may leave it unchanged).
            state = snapshot(client, store, parent)
            targets = {(CHILD, min(state['rows']))}
            for order, (_, launch) in state['targets'].items():
                targets.update(((ORDER, order), (LAUNCH, launch)))
            metadata = {'state': state, 'source': sorted(store.names(PARENT, parent)),
                        'destinations': [(k, i, sorted(store.names(k, i))) for k, i in sorted(targets)]}
            fingerprint = mirror.Mirror.fingerprint(metadata)
            previous = cache.get(str(parent), {})
            if not dry_run and previous.get('fingerprint') == fingerprint and 0 <= now - previous.get('checkedAt', 0) < 3600:
                report['cached'] += 1
                continue
            result = sync(client, parent, dry_run=dry_run)
            report['checked'] += 1
            for key in ('copied', 'reused', 'planned'): report[key] += result[key]
            # Cache pre-write inventory; the first next run confirms all post-write state.
            if not dry_run: cache[str(parent)] = {'fingerprint': fingerprint, 'checkedAt': now}
        except mirror.MissingLink:
            cache.pop(str(parent), None)
            report['unlinked'] += 1
        except Exception as exc:
            cache.pop(str(parent), None)
            report['errors'].append({'parent': parent, 'type': type(exc).__name__})
    return report
