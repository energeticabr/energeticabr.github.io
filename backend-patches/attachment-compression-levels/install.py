"""Apply exact-anchor incremental changes to the inspected worker code.

Usage: python install.py /tmp/stagedworker [--check]
The staged directory must contain all three flat source files. Live service
paths differ: channel_bridge.py is in the app root, other modules in worker/.
All anchors and Python syntax are verified before any file is replaced.
"""
import argparse
import ast
from datetime import datetime, timezone
import json
import hashlib
from pathlib import Path
import shutil


def prepare(root):
    edits = json.loads(Path(__file__).with_name('edits.json').read_text(encoding='utf-8'))
    paths = {entry['file'] for entry in edits}
    sources = {name: (root / name).read_text(encoding='utf-8') for name in paths}
    # Complete marker set makes repeated installation a no-op. Never infer
    # completion from one marker in a partially patched installation.
    markers = {
        'compression.py': ('def _compress_at_level(', 'if level is not None:'),
        'workflow.py': ('def _send_attachment_compression_levels(', 'pending["awaiting_level"] = True'),
        'channel_bridge.py': ('awaiting_portal_attachment_compression_level', 'level=body.get("level")'),
    }
    installed = [all(marker in sources[name] for marker in values) for name, values in markers.items()]
    if all(installed):
        expected = json.loads(Path(__file__).with_name('installed-sha256.json').read_text(encoding='utf-8'))
        for name, source in sources.items():
            if hashlib.sha256(source.encode('utf-8')).hexdigest() != expected[name]:
                raise RuntimeError(f'{name}: installed markers found but content differs from verified release; no files written')
        for source in sources.values():
            ast.parse(source)
        return {}, True
    if any(installed):
        raise RuntimeError('Partial installation detected; restore saved sources before retrying')
    for entry in edits:
        name, old, new = entry['file'], entry['old'], entry['new']
        count = sources[name].count(old)
        if count != 1:
            raise RuntimeError(f'{name}: anchor occurs {count} times; expected exactly one. No files written.')
        sources[name] = sources[name].replace(old, new, 1)
    for name, source in sources.items():
        ast.parse(source, filename=str(root / name))
    return sources, False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('worker', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = args.worker.resolve(strict=True)
    sources, already = prepare(root)
    if already:
        print('Already installed; all markers present and Python syntax valid')
        return
    if args.check:
        print('Validated all exact anchors and Python syntax; no files written')
        return
    backup = root / ('attachment-compression-levels-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir()
    written = []
    try:
        for name in sources:
            shutil.copy2(root / name, backup / name)
        for name, source in sources.items():
            temporary = root / (name + '.compression-levels.tmp')
            with temporary.open('w', encoding='utf-8', newline='\n') as output:
                output.write(source)
            temporary.chmod((root / name).stat().st_mode)
            temporary.replace(root / name)
            written.append(name)
    except Exception:
        for name in written:
            shutil.copy2(backup / name, root / name)
        raise
    print(f'Installed {len(sources)} modules; originals saved at {backup}')


if __name__ == '__main__':
    main()
