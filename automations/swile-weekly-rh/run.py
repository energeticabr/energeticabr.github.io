"""Private server CLI for initial migration and independent list verification."""
import argparse
from datetime import datetime
import importlib.util
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo


def load(name):
    spec = importlib.util.spec_from_file_location('swile_run_' + name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def existing_client():
    """Use the existing backend identity without copying credentials elsewhere."""
    sys.path[:0] = ['/opt/energetica-whatsapp', '/opt/energetica-whatsapp/worker']
    from local_app import load_env
    from clients import SharePointClient
    load_env(Path('/etc/energetica-whatsapp.env'))
    return SharePointClient(os.environ['SHAREPOINT_HOST'], os.environ['SHAREPOINT_SITE_PATH'],
                            os.environ['ENTRA_TENANT_ID'], os.environ['ENTRA_CLIENT_ID'],
                            Path(os.environ['ENTRA_PRIVATE_KEY_FILE']).read_text(),
                            Path(os.environ['ENTRA_CERTIFICATE_FILE']).read_text(), 'DOCUMENTOS')


def verify_coverage(adapter, plans, model, engine):
    """Reread every group and link; no receipt inferred from successful POSTs."""
    receipt = []
    for plan in plans:
        parents = adapter.find(model.PARENT, 'FOLHAOPERACAO', plan['key'])
        if len(parents) != 1:
            raise ValueError('Descritivo ausente ou duplicado')
        parent = parents[0]
        pid = model.identity(parent['Id'])
        children = adapter.find(model.CHILD, 'DESCRITIVOPROVISAO', str(pid))
        keys = [c.get('FOLHAOPERACAO') for c in children]
        if len(set(keys)) != len(keys) or engine._preserve_reason(parent, children, plan):
            raise ValueError('Grupo pago, alterado ou inconsistente; conferir antes de migrar')
        if parent.get('Title') != plan['key']:
            raise ValueError('Grupo ainda em preparação')
        for row in plan['rows']:
            expected = model.child_payload(plan, row, pid)
            expected.pop('DATA')  # Creation day does not change on a later verification.
            matches = [c for c in children if c.get('FOLHAOPERACAO') == expected['FOLHAOPERACAO']]
            if len(matches) != 1 or not engine._matches(matches[0], expected):
                raise ValueError('Fornecedor ou valores não confirmados')
        if not engine._same('VALORTOTAL', parent.get('VALORTOTAL'), 225 * len(children)):
            raise ValueError('Total não confirmado')
        receipt.append({'dueDate': plan['dueDate'], 'parentId': pid,
                        'provisionIds': sorted(model.identity(c['Id']) for c in children),
                        'total': 225 * len(children)})
    return receipt


def main():
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--mode', choices=['preflight', 'seed', 'verify', 'retire'], required=True)
    args = parser.parse_args()
    args.output.mkdir(mode=0o700, parents=True, exist_ok=True)
    config = json.loads(args.config.read_text(encoding='utf-8'))
    model, engine, module = load('model'), load('reconcile'), load('live_adapter')
    with (args.output / 'migration.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        adapter = module.SharePointAdapter(existing_client())
        today = datetime.now(ZoneInfo('America/Sao_Paulo')).date()
        plans = model.plan_horizon(adapter.all_rows(model.RH), today, config['excludedSupplierIds'])
        for title in (model.PARENT, model.CHILD):
            adapter.require_unique(title, 'FOLHAOPERACAO')
        if args.mode == 'preflight':
            result = {'referenceDate': today.isoformat(), 'plans': plans,
                      'legacy': model.legacy_targets(adapter.all_rows(model.CHILD), adapter.all_rows(model.PARENT),
                                                     config['legacyRecurrenceId'])}
        elif args.mode == 'seed':
            result = engine.reconcile(adapter, plans, engine.JsonJournal(args.output / 'migration-journal.json'))
            verify_coverage(adapter, plans, model, engine)
        elif args.mode == 'verify':
            result = verify_coverage(adapter, plans, model, engine)
        else:
            if not plans:
                raise ValueError('Sem fornecedores elegíveis; não retirar a recorrência antiga')
            verify_coverage(adapter, plans, model, engine)
            result = engine.retire_legacy(adapter, config['legacyRecurrenceId'], args.output / 'legacy-backup.json')
            verify_coverage(adapter, plans, model, engine)
        stamp = datetime.now().strftime('%Y%m%dT%H%M%S%f')
        (args.output / (args.mode + '-' + stamp + '.json')).write_text(
            json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        if args.mode == 'preflight':
            print(json.dumps({'weeks': len(plans), 'recipients': len(plans[0]['rows']) if plans else 0,
                              'legacyCandidates': result['legacy'], 'financialWrites': 0}))
        else:
            print(json.dumps({'mode': args.mode, 'receipt': result}, ensure_ascii=False))


if __name__ == '__main__':
    main()
