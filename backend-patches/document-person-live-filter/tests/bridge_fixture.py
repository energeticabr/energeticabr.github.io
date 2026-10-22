"""Execute the real pinned messenger, without starting the HTTP/service stack."""
from __future__ import annotations

import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path

PATCH_ROOT = Path(__file__).resolve().parents[1]
PRIVATE_ROOT = Path(os.environ["DOCUMENT_PERSON_PRIVATE_ROOT"])
PINS = {
    "production": ("channel_bridge.before.py", "85f963428e6f82ab5207d1c75c177aeba20d42ba47136257652bc53e6c52f164"),
    "mirror": ("channel_bridge.mirror.before.py", "a5a8244d6525f34f53de781caa399570073df1f55ef8148ed4c1c5f9cdfa5e19"),
}
LOGIC_SHA256 = "ddd1e411c811e5635bb9df04811c823da11b0e1a0b2b0de6c6513de74e1e0611"


def pure_logic():
    path = Path(os.environ["DOCUMENT_PERSON_LOGIC_PATH"])
    if hashlib.sha256(path.read_bytes()).hexdigest() != LOGIC_SHA256:
        raise RuntimeError("Pure logic fixture drifted")
    return load_module("document_person_logic", path)


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pinned_source(root):
    filename, expected = PINS[root]
    raw = (PRIVATE_ROOT / filename).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise RuntimeError("Pinned bridge fixture drifted: " + root)
    return raw.decode("utf-8")


def document_step():
    raw = (PRIVATE_ROOT / "workflow_config.before.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != "80fa8588dc246b6273512b1dd173537a204c4301b12da498a3e2c7d79f1ab37d":
        raise RuntimeError("Pinned workflow fixture drifted")

    def find(value):
        if isinstance(value, dict):
            if value.get("key") == "pessoa_relacionada":
                yield value
            for item in value.values():
                yield from find(item)
        elif isinstance(value, list):
            for item in value:
                yield from find(item)

    matches = list(find(json.loads(raw)))
    if len(matches) != 1:
        raise RuntimeError("Ambiguous document step fixture")
    return matches[0]


def messenger(root, *, baseline=False):
    source = pinned_source(root)
    if not baseline:
        source = load_module("document_person_patch", PATCH_ROOT / "patch_bridge.py").patch_bridge(source)
    # logic.py contains only pure helpers and standard-library imports.
    logic = pure_logic()
    tree = ast.parse(source)
    cls = copy.deepcopy(next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "ChannelMessenger"))
    namespace = {name: getattr(logic, name) for name in (
        "condition_matches", "is_binary_choice", "visual_form_prompt", "visual_option_title", "visual_choice_title",
    )}
    # RHID report enrichment is external and unrelated to document choices.
    namespace["attendance_rhid_option_context"] = lambda step, item, options: {}
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), cls], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), PINS[root][0], "exec"), namespace)
    return namespace["ChannelMessenger"]()
