"""Guarded patch of the deployed sources. No credentials or workflow data."""
import argparse
import ast
import shutil
from pathlib import Path


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected one backend anchor, found {text.count(old)}: {old[:70]}")
    return text.replace(old, new, 1)


def patch_sources(source, target):
    source, target = Path(source), Path(target)
    target.mkdir(parents=True, exist_ok=True)
    bridge = (source / "channel_bridge.py").read_text(encoding="utf-8")
    builder = (source / "worker/diary_evidence.py").read_text(encoding="utf-8")
    workflow = (source / "worker/workflow.py").read_text(encoding="utf-8")
    bridge = replace_once(bridge, "from __future__ import annotations",
        "from __future__ import annotations\n\nfrom diary_progress import REGISTRY, finish_diary_request")
    bridge = replace_once(bridge,
        '                if action == "launch_gallery":',
        '''                if action == "diary_evidence_progress":
                    if set(body) != {"action", "requestId"}:
                        raise ValueError("Parâmetros de progresso inválidos")
                    # Identity is freshly validated; a scoped record exists only after
                    # authorization of the original request. Never acquire bridge.lock.
                    return self._send_json(200, REGISTRY.snapshot(identity, body.get("requestId")), cors_origin=origin)
                if action == "launch_gallery":''')
    bridge = replace_once(bridge,
        '''                    self.bridge.portal_authorize(identity, allowed_emails=self.portal_authenticator.allowed_emails)
                    result = self.bridge.handle(portal_channel_payload(body, identity))
                return self._send_json(''',
        '''                    self.bridge.portal_authorize(identity, allowed_emails=self.portal_authenticator.allowed_emails)
                    if body.get("trackDiaryEvidence") is True:
                        public = finish_diary_request(
                            identity, body,
                            lambda: self.bridge.handle(portal_channel_payload(body, identity)),
                            lambda value: portal_public_result(
                                value, identity=identity, media_store=self.portal_media_store,
                                media_root=self._portal_media_root(),
                                active_flow=self.bridge.portal_flow_status(identity, allowed_emails=self.portal_authenticator.allowed_emails),
                                attachments=self.bridge.portal_attachment_snapshot(identity, self.portal_media_store, allowed_emails=self.portal_authenticator.allowed_emails),
                            ),
                        )
                        return self._send_json(200, public, cors_origin=origin)
                    result = self.bridge.handle(portal_channel_payload(body, identity))
                return self._send_json(''')
    builder = replace_once(builder, "from __future__ import annotations",
        "from __future__ import annotations\n\nfrom diary_progress import emit_progress")
    builder = replace_once(builder,
        '''        output = canvas.Canvas(str(output_path), pagesize=A4, pageCompression=1)
        for page_number, page in enumerate(pages, start=1):''',
        '''        output = canvas.Canvas(str(output_path), pagesize=A4, pageCompression=1)
        total_photos = sum(len(p.get("message_ids", [])) for p in pages)
        rendered_photos = 0
        for page_number, page in enumerate(pages, start=1):''')
    builder = replace_once(builder, '''            output.showPage()
        output.save()

    def build_preview(''',
        '''                rendered_photos += 1
                emit_progress(75 * rendered_photos / max(1, total_photos), "photos")
            output.showPage()
        output.save()
        emit_progress(80, "pdf")

    def build_preview(''')
    builder = replace_once(builder, '''        return preview, [generated, *separate_documents]''',
        '''        emit_progress(90, "saving")
        return preview, [generated, *separate_documents]''')
    builder = replace_once(builder, '''        new_content = self.media_repository.read(generated_attachment)''',
        '''        emit_progress(90, "merging")
        new_content = self.media_repository.read(generated_attachment)''')
    builder = replace_once(builder, '''        rendered_pages = 0
        try:
            for source_path in source_paths:''',
        '''        rendered_pages = 0
        total_pages = sum(ConstructionDiaryEvidenceBuilder._pdf_page_count(path) for path in source_paths)
        try:
            for source_path in source_paths:''')
    builder = replace_once(builder, '''                            rendered_pages += 1''',
        '''                            rendered_pages += 1
                            emit_progress(90 + 8 * rendered_pages / max(1, total_pages), "merging")''')
    # Scope the completion hook to this method, not other evidence workflows.
    parsed = ast.parse(workflow)
    method = next(node for node in ast.walk(parsed)
        if isinstance(node, ast.FunctionDef) and node.name == "_finish_diary_evidence")
    lines = workflow.splitlines(keepends=True)
    section = "".join(lines[method.lineno - 1:method.end_lineno])
    section = replace_once(section, "        return self._prompt_next_or_summary(state, etag)",
        '''        result = self._prompt_next_or_summary(state, etag)
        if self._is_construction_diary_flow(state):
            emit_progress(99, "ready")
        return result''')
    workflow = "".join(lines[:method.lineno - 1]) + section + "".join(lines[method.end_lineno:])
    workflow = replace_once(workflow, "from __future__ import annotations",
        "from __future__ import annotations\n\nfrom diary_progress import emit_progress")
    for name, text in [("channel_bridge.py", bridge), ("worker/diary_evidence.py", builder), ("worker/workflow.py", workflow)]:
        compile(text, name, "exec")
        path = target / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    shutil.copyfile(Path(__file__).with_name("diary_progress.py"), target / "diary_progress.py")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    patch_sources(args.source, args.target)
