"""Run the pinned bridge's actual methods without importing its service stack.

Only the external workflow engine and Microsoft token verifier are doubles.
Ownership, stable IDs, context validation, transfer validation, HTTP dispatch
and JSON serialization all execute the downloaded production code via AST.
Every temporary file stays within this backend patch's write scope.
"""
from __future__ import annotations

import ast
import copy
from datetime import datetime
import hashlib
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import mimetypes
import os
from pathlib import Path
import re
import tempfile
import threading
import time
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit
import uuid


PATCH_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PATCH_ROOT.parents[1] / "artifacts/resume-attachment-20261013/channel_bridge.before.py"
SOURCE_SHA256 = "50be0e6c259279a139a02ba58076502651246b1a21f1897471bf4683d921af95"
UNAVAILABLE = "Um anexo selecionado não está mais disponível ou já foi submetido."
MISSING_FILE = "Um anexo selecionado não está mais disponível."
ALICE = {"oid": "00000000-0000-0000-0000-000000000001", "email": "owner@example.test"}
# Same legacy digit normalization, distinct Microsoft owner: must fail ownership.
BOB = {"oid": "a0000000-0000-0000-0000-000000000001", "email": "other@example.test"}
ORIGIN = "https://portal.example.test"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pinned_source():
    raw = SOURCE.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise RuntimeError("Read-only bridge fixture drifted")
    return raw.decode("utf-8")


def load_bridge(*, baseline=False):
    source = pinned_source()
    if not baseline:
        patcher = load_module("attachment_recovery_patch", PATCH_ROOT / "patch_bridge.py")
        source = patcher.patch_bridge(source)
    tree = ast.parse(source)
    functions = {"_first", "_normalize_identifier", "portal_origin_allowed",
                 "portal_channel_payload", "normalize_channel_events", "portal_public_result"}
    bridge_methods = {"_portal_state", "_portal_saved_context", "_portal_attachment_id",
                      "portal_home_attachment_transfer"}
    handler_methods = {"do_POST", "_send_json", "_portal_identity", "_portal_media_root", "log_message"}
    selected = [ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)]
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in functions:
            selected.append(node)
        elif isinstance(node, ast.ClassDef) and node.name in {"AttachmentUnavailableError", "PortalConversationOwnerStore"}:
            selected.append(node)
        elif isinstance(node, ast.ClassDef) and node.name in {"ChannelBridge", "BridgeHandler"}:
            methods = bridge_methods if node.name == "ChannelBridge" else handler_methods
            extracted = copy.deepcopy(node)
            extracted.body = [item for item in extracted.body
                              if isinstance(item, ast.FunctionDef) and item.name in methods]
            selected.append(extracted)
    namespace = {"BaseHTTPRequestHandler": BaseHTTPRequestHandler, "Path": Path,
                 "datetime": datetime, "hashlib": hashlib, "json": json,
                 "mimetypes": mimetypes, "os": os, "re": re, "threading": threading,
                 "time": time, "uuid": uuid, "urlsplit": urlsplit, "parse_qs": parse_qs,
                 "log": lambda *args, **kwargs: None}
    # Unchanged logic.conversation_key adapter; the service module is not imported.
    namespace["conversation_key"] = lambda event: hashlib.sha256(
        f"{event['conversation_id']}|{event['sender']}".encode("utf-8")).hexdigest()
    module = ast.fix_missing_locations(ast.Module(body=selected, type_ignores=[]))
    exec(compile(module, str(SOURCE), "exec"), namespace)
    return namespace


class FixtureStateStore:
    def __init__(self, path):
        self.path = path
        self.reads = 0
        self.writes = 0
        self.second_read = None

    def load(self, key):
        self.reads += 1
        state = json.loads(self.path.read_text(encoding="utf-8"))
        if self.reads == 2 and self.second_read:
            state = self.second_read(state)
        return state, "fixture-etag"

    def save(self, *args, **kwargs):
        self.writes += 1
        raise AssertionError("Transfer validation must not write workflow state")


class RecordingMessenger:
    def __init__(self):
        self.resets = 0
        self.messages = [{"type": "text", "text": "draft prompt"}]

    def reset(self):
        self.resets += 1
        self.messages = []

    def drain(self):
        return list(self.messages)


class ExternalEngine:
    """Record the external transfer boundary; forbid destructive/posting APIs."""
    def __init__(self, directory, store):
        self.media_repository = SimpleNamespace(directory=directory, delete=self.forbidden)
        self.state_store = store
        self.actions = []
        self.attachment_reads = 0
        self.attachment_error = None

    @staticmethod
    def forbidden(*args, **kwargs):
        raise AssertionError("Source deletion/posting is outside recovery")

    def active_flow_status(self, state):
        return {"stage": state["stage"], "flow": state["flow"]} if state else None

    def _all_state_attachments(self, state):
        self.attachment_reads += 1
        if self.attachment_error:
            raise self.attachment_error
        return state.get("attachments", [])

    def _prompt_portal_transfer_exit(self, event, state, etag, **kwargs):
        self.actions.append({"operation": "prompt", "event": event, "etag": etag, **kwargs})
        return {"status": "awaiting_portal_transfer"}

    def _send_portal_transfer_exit_prompt(self, state):
        self.actions.append({"operation": "replay"})

    def _finish_portal_transfer_exit(self, event, state, etag, key, **kwargs):
        self.actions.append({"operation": "confirm", "event": event, "key": key, **kwargs})
        return {"status": "returned_to_main_menu"}

    def __getattr__(self, name):
        raise AssertionError(f"Unexpected workflow action: {name}")


class BridgeFixture:
    def __init__(self, namespace):
        temporary_root = PATCH_ROOT / "tests/.tmp"
        temporary_root.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="bridge-", dir=temporary_root)
        self.root = Path(self.temp.name)
        self.namespace = namespace
        self.bridge = namespace["ChannelBridge"]()
        self.bridge.lock = threading.Lock()
        self.bridge.messenger = RecordingMessenger()
        self.store = FixtureStateStore(self.root / "state.json")
        self.engine = ExternalEngine(self.root / "media", self.store)
        self.bridge.engine = self.engine
        sender = namespace["_normalize_identifier"](f"portal:{ALICE['oid']}")
        self.key = namespace["conversation_key"]({"sender": sender, "conversation_id": sender})
        self.state = {"key": self.key, "sender": sender, "conversation_id": sender,
                      "phone_number_id": "portal-admin", "stage": "collecting", "flow": "launch",
                      "batch_id": "fixture-batch", "step_index": 4,
                      "fields": {"DESCRICAO": "keep this draft", "VALOR": "125,00"},
                      "answers": {"supplier": "fixture supplier"}, "attachments": []}
        self.save_fixture()
        self.bridge.portal_owners = namespace["PortalConversationOwnerStore"](self.root)
        self.bridge.portal_owners.path.parent.mkdir()
        self.bridge.portal_owners.path.write_text(json.dumps(
            {"version": 1, "owners": {self.key: ALICE["oid"]}}), encoding="utf-8")
        self.authentications = []

        def authenticate(token):
            self.authentications.append(token)
            if token == "Bearer alice":
                return dict(ALICE)
            if token == "Bearer bob":
                return dict(BOB)
            raise PermissionError("Invalid Microsoft session")

        self.handler = type("RecoveryHTTPHandler", (namespace["BridgeHandler"],), {
            "bridge": self.bridge, "portal_authenticator": SimpleNamespace(
                authenticate=authenticate, allowed_emails={ALICE["email"]}),
            "portal_origins": {ORIGIN}, "max_body_bytes": 1024 * 1024, "portal_media_store": None})
        # These projections are external dependencies of the unchanged success path.
        self.bridge.portal_flow_status = lambda *args, **kwargs: {"stage": "collecting"}
        self.bridge.portal_attachment_snapshot = lambda *args, **kwargs: []
        drafts = ModuleType("workflow_drafts")
        drafts.DRAFT_BUSY_STAGES = frozenset({
            "committing", "notifying", "summarizing", "compressing_attachments",
            "deleting_attendance", "generating_report", "report_notifying",
            "sending_document_attachments", "cash_receipt_recovery"})
        workflow = ModuleType("workflow")
        workflow.PORTAL_TRANSFER_EXIT_STAGE = "confirming_portal_transfer"
        self.modules = patch.dict("sys.modules", {"workflow_drafts": drafts, "workflow": workflow})
        self.modules.start()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.modules.stop()
        self.temp.cleanup()

    def save_fixture(self):
        self.store.path.write_text(json.dumps(self.state, ensure_ascii=False), encoding="utf-8")

    def attachment(self, name, *, exists=True, object_name=None, **flags):
        object_name = object_name or f"{self.key[:12]}/{name}"
        item = {"object_name": object_name, "message_id": f"upload-{name}",
                "original_name": name, "mime_type": "application/pdf", **flags}
        self.state["attachments"].append(item)
        target = self.engine.media_repository.directory / object_name
        if exists:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(f"original content of {name}".encode("utf-8"))
        self.save_fixture()
        return self.bridge._portal_attachment_id(ALICE, self.state, item), item

    def body(self, ids, **overrides):
        return {"action": "home_attachment_transfer", "messageId": "transfer-attempt",
                "expectedContextId": self.bridge._portal_saved_context(self.state)[0],
                "attachmentIds": ids, **overrides}

    def request(self, body, *, token="alice", origin=ORIGIN, raw=None):
        payload = raw if raw is not None else json.dumps(body, ensure_ascii=False).encode("utf-8")
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        try:
            connection.request("POST", "/portal/chat", payload, {
                "Authorization": f"Bearer {token}", "Origin": origin, "Content-Type": "application/json"})
            response = connection.getresponse()
            self.last_headers = dict(response.getheaders())
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def snapshot(self):
        return {path.relative_to(self.root).as_posix(): (path.read_bytes(), path.stat().st_mode)
                for path in self.root.rglob("*") if path.is_file()}
