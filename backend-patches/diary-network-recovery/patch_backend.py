"""Guarded patch for an already progress-enabled deployment."""
import argparse
from pathlib import Path

def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Production source changed; ambiguous patch anchor')
    return source.replace(old, new, 1)

def patch_sources(source, target):
    source, target = Path(source), Path(target)
    bridge = (source / 'channel_bridge.py').read_text(encoding='utf-8')
    builder = (source / 'worker/diary_evidence.py').read_text(encoding='utf-8')
    bridge = replace_once(bridge, '                if action == "diary_evidence_progress":', '''                if action == "diary_evidence_pending":
                    if set(body) != {"action"}:
                        raise ValueError("Parâmetros de recuperação inválidos")
                    # Microsoft identity is validated above; only authorized jobs
                    # are discoverable. Never wait for the workflow/PDF lock.
                    return self._send_json(200, REGISTRY.pending(identity), cors_origin=origin)
                if action == "diary_evidence_progress":''')
    builder = patch_builder(builder)
    values = {'channel_bridge.py': bridge, 'worker/diary_evidence.py': builder,
              'diary_progress.py': (Path(__file__).parent.parent / 'diary-attachment-progress/diary_progress.py').read_text(encoding='utf-8')}
    for name, content in values.items():
        compile(content, name, 'exec')
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')

def patch_builder(builder):
    builder = replace_once(builder, '''        image = self._rgb_image(content)
        original_width, original_height = image.size''', '''        image = self._rgb_image(content)
        # Bound encoding work before quality retries on large camera photos.
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        original_width, original_height = image.size''')
    builder = replace_once(builder, '''                encoded = self._encode_jpeg(rendered, quality)''', '''                try:
                    encoded = self._encode_jpeg(rendered, quality)
                finally:
                    if rendered is not image:
                        rendered.close()''')
    compile(builder, 'diary_evidence.py', 'exec')
    return builder

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source'); parser.add_argument('target')
    args = parser.parse_args(); patch_sources(args.source, args.target)
