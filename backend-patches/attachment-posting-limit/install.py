"""Remove the PowerApps aggregate posting cap in a flat staging directory."""
import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

OLD_LIMIT = '''    def _attachment_size_limit(self) -> int:
        return int(
            self.config.get("limits", {}).get(
                "max_total_attachment_bytes", 10_000_000
            )
        )
'''
NEW_LIMIT = '''    def _attachment_size_limit(self) -> int:
        # Upload size and attachment count are enforced when files arrive.
        # Do not impose the former PowerApps 10 MB aggregate posting cap.
        # The sentinel exceeds every batch permitted by the input limit.
        limits = self.config.get("limits", {})
        input_limit = max(1, int(limits.get("max_input_attachment_bytes", 60_000_000)))
        return input_limit + 1
'''
OLD_REPLY = '''        self._mark_processed(state, event["message_id"])
        if command in {
            "sim",
            "comprimir",
            "sim comprimir",
            "compress_attachments_yes",
'''
NEW_REPLY = '''        self._mark_processed(state, event["message_id"])
        # A conversation may still carry the former mandatory size prompt.
        # Preserve its originals and return to review; never submit here.
        total, recovery = self._attachment_total_or_request_reupload(state, etag)
        if recovery is not None:
            return recovery
        if total < self._attachment_size_limit():
            resume_stage = state.pop("attachment_compression_resume_stage", None)
            state.pop("attachment_compression_result", None)
            state.pop("attachment_compression_approved", None)
            state["stage"] = resume_stage or "summarizing"
            etag = self._save(state, etag)
            if resume_stage:
                return self._resend_current_prompt(state, etag)
            return self._summarize_and_confirm(state, etag)
        if command in {
            "sim",
            "comprimir",
            "sim comprimir",
            "compress_attachments_yes",
'''
EDITS = [
    (OLD_LIMIT, NEW_LIMIT), (OLD_REPLY, NEW_REPLY),
    ('f"⚠️ OS ANEXOS TOTALIZAM {_human_size(total)}. O LIMITE POR ITEM "',
     'f"⚠️ OS ANEXOS TOTALIZAM {_human_size(total)}. O LIMITE DO CONJUNTO "'),
    ('"*❌ POSTAGEM CANCELADA: OS ANEXOS EXCEDEM 10 MB E A "',
     '"*❌ POSTAGEM CANCELADA: OS ANEXOS EXCEDEM O LIMITE PERMITIDO E A "'),
    ('"o conjunto permaneceu maior ou igual ao limite de 10 MB"',
     '"o conjunto permaneceu maior ou igual ao limite permitido"'),
    ('"❌ *NÃO FOI POSSÍVEL REDUZIR O CONJUNTO PARA MENOS DE 10 MB.*\\n"',
     '"❌ *NÃO FOI POSSÍVEL REDUZIR O CONJUNTO AO LIMITE PERMITIDO.*\\n"'),
]


def prepare(root):
    workflow = (root / 'workflow.py').read_text(encoding='utf-8')
    for old, new in EDITS:
        count = workflow.count(old)
        if count != 1:
            raise RuntimeError('Expected one exact anchor, found %s; nothing written' % count)
        workflow = workflow.replace(old, new, 1)
    ast.parse(workflow)
    config = (root / 'workflow_config.json').read_text(encoding='utf-8')
    parsed = json.loads(config)
    if parsed['limits'].get('max_total_attachment_bytes') != 10_000_000:
        raise RuntimeError('Production legacy limit differs; review before applying')
    anchor = '    "max_total_attachment_bytes": 10000000,\n'
    if config.count(anchor) != 1:
        raise RuntimeError('Expected one config anchor; nothing written')
    config = config.replace(anchor, '', 1)
    json.loads(config)
    return {'workflow.py': workflow, 'workflow_config.json': config}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = args.source.resolve(strict=True)
    prepared = prepare(root)
    if args.check:
        print('Exact anchors, Python syntax and JSON verified; no files written')
        return
    backup = root / ('posting-limit-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir()
    for name in prepared:
        shutil.copy2(root / name, backup / name)
    written = []
    try:
        for name, content in prepared.items():
            target = root / name
            temporary = root / (name + '.posting-limit.tmp')
            with temporary.open('w', encoding='utf-8', newline='\n') as output:
                output.write(content)
            temporary.chmod(target.stat().st_mode)
            temporary.replace(target)
            written.append(name)
    except Exception:
        for name in written:
            shutil.copy2(backup / name, root / name)
        raise
    for name in prepared:
        print(name + ' ' + hashlib.sha256((root / name).read_bytes()).hexdigest())
    print('Installed; originals saved at ' + str(backup))


if __name__ == '__main__':
    main()
