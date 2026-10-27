"""Anchor-checked source patch. Never imports or executes a live business module."""
import ast
from pathlib import Path
import shutil


def once(source, before, after):
    if source.count(before) != 1: raise ValueError("Source anchor missing or ambiguous")
    return source.replace(before, after, 1)


def patch_bridge(source):
    if "from operation_progress import" in source:
        raise ValueError("Operation progress patch already present")
    source = once(source, "from diary_progress import REGISTRY, finish_diary_request",
        "from diary_progress import REGISTRY, finish_diary_request\n"
        "from operation_progress import REGISTRY as OPERATION_PROGRESS, advance as operation_stage, stage as operation_stage_method, public_progress")
    source = once(source,
        '    def _send_json(self, status: int, payload: dict, cors_origin: str = ""):\n',
        '    def _send_json(self, status: int, payload: dict, cors_origin: str = ""):\n'
        '        payload = public_progress(status, payload)\n')
    for name in ("portal_flow_status", "portal_attachment_snapshot", "handle"):
        anchor = "    def " + name + "("
        source = once(source, anchor, '    @operation_stage_method("' + {
            "portal_flow_status": "flow", "portal_attachment_snapshot": "attachments", "handle": "processing"
        }[name] + '")\n' + anchor)
    # The generic progress query is authenticated but does not take bridge.lock.
    source = once(source, '                if action == "diary_evidence_progress":\n',
        '                if action == "operation_progress":\n'
        '                    if set(body) != {"action", "requestId"}:\n'
        '                        raise ValueError("Parâmetros de progresso inválidos")\n'
        '                    return self._send_json(200, OPERATION_PROGRESS.snapshot(identity, body.get("requestId")), cors_origin=origin)\n'
        '                if action == "diary_evidence_progress":\n')
    tree = ast.parse(source)
    handler = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "BridgeHandler")
    post = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == "do_POST")
    # Exact authenticated chat dispatch only, after the independent query branches.
    start = next(node for node in ast.walk(post) if isinstance(node, ast.If)
                 and isinstance(node.test, ast.Compare) and ast.unparse(node.test) == "action == 'launch_gallery'")
    final = [node for node in ast.walk(post) if isinstance(node, ast.Return)
             and isinstance(node.value, ast.Call) and any(isinstance(child, ast.Name) and child.id == "portal_public_result" for child in ast.walk(node))]
    final = max(final, key=lambda node: node.end_lineno)
    lines = source.splitlines(keepends=True)
    block = "".join(lines[start.lineno - 1:final.end_lineno])
    # Count business completion at the actual returned result boundary for action dispatch.
    block_tree = ast.parse("\n".join(line[16:] for line in block.splitlines()))
    additions = []
    for node in ast.walk(block_tree):
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "result" for target in node.targets):
            additions.append(node.end_lineno)
    block_lines = block.splitlines(keepends=True)
    for number in sorted(additions, reverse=True):
        indent = len(block_lines[number - 1]) - len(block_lines[number - 1].lstrip())
        block_lines.insert(number, " " * indent + 'operation_stage("processing")\n')
    wrapped = ('                progress_id = body.pop("progressRequestId", None)\n'
               '                with OPERATION_PROGRESS.scope(identity, progress_id, stages=("identity", "processing", "response") if action == "launch_gallery" else None):\n'
               '                    operation_stage("identity")\n'
               + "".join("    " + line if line.strip() else line for line in block_lines))
    lines[start.lineno - 1:final.end_lineno] = [wrapped]
    result = "".join(lines)
    compile(result, "channel_bridge.py", "exec")
    return result


def patch_diary(source):
    source = once(source, "def emit_progress(percent, stage):\n",
        "def emit_progress(percent, stage):\n"
        "    from operation_progress import work_units\n"
        "    work_units(percent)\n")
    compile(source, "diary_progress.py", "exec")
    return source


def patch_sources(base, destination):
    base, destination = Path(base), Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for name, patch in (("channel_bridge.py", patch_bridge), ("diary_progress.py", patch_diary)):
        text = patch((base / name).read_text(encoding="utf-8-sig"))
        (destination / name).write_text(text, encoding="utf-8", newline="\n")
    shutil.copyfile(Path(__file__).with_name("operation_progress.py"), destination / "operation_progress.py")


if __name__ == "__main__":
    import sys
    patch_sources(*sys.argv[1:])
