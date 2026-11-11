"""Private fixed-operation Sicoob queue. No banking payloads or credentials."""
import contextlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/var/lib/energetica-whatsapp/sicoob-sync")
ACTIVE = {"queued", "running"}

class Queue:
    def __init__(self, root=ROOT, clock=time.time):
        self.root, self.clock = Path(root), clock

    @contextlib.contextmanager
    def locked(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (self.root / "lock").open("a+b") as lock:
            if os.name == "nt":
                import msvcrt
                lock.seek(0)
                if not lock.read(1):
                    lock.write(b"0")
                    lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                path = self.root / "state.json"
                state = json.loads(path.read_text()) if path.exists() else {"jobs": {}, "heartbeat": 0}
                state.setdefault("aliases", {})
                now = self.clock()
                for job in state["jobs"].values():
                    if job["status"] in ACTIVE and (now - state["heartbeat"] > 180 or now - job["createdAt"] > 7200):
                        job.update(status="failed", code="WORKER_UNAVAILABLE", completedAt=now)
                yield state
                # Manual receipts and aliases are permanent idempotency records.
                # Only legacy terminal history may expire. No bank data is stored.
                legacy = sorted(((key, job) for key, job in state["jobs"].items()
                                 if not job.get("notify") and job["status"] not in ACTIVE),
                                key=lambda item: item[1]["createdAt"])
                for key, _ in legacy[:-50]:
                    del state["jobs"][key]
                temp = self.root / "state.tmp"
                with temp.open("w", encoding="utf-8") as output:
                    os.chmod(temp, 0o600)
                    output.write(json.dumps(state))
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(temp, path)
                if os.name != "nt":
                    directory = os.open(self.root, os.O_RDONLY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
            finally:
                if os.name == "nt":
                    lock.seek(0)
                    msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(lock, fcntl.LOCK_UN)

    def authorize(self, identity):
        allowed = json.loads((self.root / "access.json").read_text()).get("emails", [])
        email = str(identity.get("email") or identity.get("preferred_username") or "").strip().lower()
        if not identity.get("oid") or not email or email not in {str(x).lower() for x in allowed}:
            raise PermissionError("Consulta Sicoob não autorizada para este usuário.")
        return str(identity["oid"])

    @staticmethod
    def public(job):
        result = {key: job[key] for key in ("requestId", "status", "code", "created", "updated", "verified", "createdItemIds", "pendingDetails") if key in job}
        if "completedAt" in job:
            result["completedUtc"] = datetime.fromtimestamp(job["completedAt"], timezone.utc).isoformat()
        return result

    @staticmethod
    def validate_id(request_id):
        if not isinstance(request_id, str) or not re.fullmatch(r"[a-f0-9]{32}", request_id):
            raise ValueError("Pedido Sicoob inválido.")

    @staticmethod
    def find(state, owner, request_id):
        canonical = state["aliases"].get(request_id, request_id)
        job = state["jobs"].get(canonical)
        if job and job["owner"] != owner:
            raise PermissionError("Pedido Sicoob indisponível para esta sessão.")
        return job

    def start(self, identity, request_id=None):
        owner = self.authorize(identity)
        if request_id is not None:
            self.validate_id(request_id)
        with self.locked() as state:
            if request_id is not None:
                previous = self.find(state, owner, request_id)
                if previous:
                    return self.public(previous)
            failure = None
            if self.clock() - state["heartbeat"] > 180:
                if request_id is None:
                    return {"status": "unavailable", "code": "WORKER_UNAVAILABLE"}
                failure = "WORKER_UNAVAILABLE"
            else:
                for job in state["jobs"].values():
                    if job["status"] in ACTIVE:
                        if job["owner"] == owner:
                            if request_id is not None:
                                state["aliases"][request_id] = job["requestId"]
                                job["notify"] = True
                            return self.public(job)
                        if request_id is None:
                            return {"status": "busy"}
                        failure = "BUSY"
                        break
            job = {"requestId": request_id or uuid.uuid4().hex, "owner": owner,
                   "status": "queued", "createdAt": self.clock()}
            if request_id is not None:
                job["notify"] = True
            if failure:
                job.update(status="failed", code=failure, completedAt=self.clock())
            state["jobs"][job["requestId"]] = job
            return self.public(job)

    def status(self, identity, request_id):
        owner = self.authorize(identity)
        self.validate_id(request_id)
        with self.locked() as state:
            job = self.find(state, owner, request_id)
            if not job:
                raise PermissionError("Pedido Sicoob indisponível para esta sessão.")
            return self.public(job)

    def pending(self, identity):
        owner = self.authorize(identity)
        with self.locked() as state:
            jobs = sorted(state["jobs"].values(), key=lambda job: job["createdAt"])
            return {"status": "pending", "requests": [self.public(job) for job in jobs
                    if job["owner"] == owner and job.get("notify") and not job.get("acknowledgedAt")]}

    def acknowledge(self, identity, request_id):
        owner = self.authorize(identity)
        self.validate_id(request_id)
        with self.locked() as state:
            job = self.find(state, owner, request_id)
            if not job:
                raise PermissionError("Pedido Sicoob indisponível para esta sessão.")
            if job["status"] not in {"succeeded", "failed"}:
                raise ValueError("Pedido Sicoob ainda não concluído.")
            job.setdefault("acknowledgedAt", self.clock())
            return {"status": "acknowledged", "requestId": job["requestId"]}

    def worker(self, operation, payload=None):
        if operation not in {"heartbeat", "claim", "complete"}:
            raise ValueError("Invalid worker operation")
        payload = payload or {}
        with self.locked() as state:
            state["heartbeat"] = self.clock()
            if operation == "claim":
                for job in state["jobs"].values():
                    if job["status"] == "queued":
                        job["status"] = "running"
                        return {"job": self.public(job)}
                return {"job": None}
            if operation == "complete":
                job = state["jobs"].get(payload.get("requestId"))
                if not job or job["status"] != "running":
                    raise ValueError("No running request")
                success = payload.get("status") == "succeeded" and payload.get("failed") == 0
                job.update(status="succeeded" if success else "failed", completedAt=self.clock())
                if success:
                    for key in ("created", "updated", "verified"):
                        value = payload.get(key)
                        if type(value) is not int or not 0 <= value <= 1000000:
                            raise ValueError("Invalid count")
                        job[key] = value
                    if "pendingDetails" in payload:
                        value = payload["pendingDetails"]
                        if type(value) is not int or not 0 <= value <= 1000000:
                            raise ValueError("Invalid pending detail count")
                        job["pendingDetails"] = value
                    if "createdItemIds" in payload:
                        ids = payload["createdItemIds"]
                        if (not isinstance(ids, list) or len(ids) != job["created"] or len(ids) > 10000
                                or any(type(item) is not int or not 1 <= item <= 2147483647 for item in ids)
                                or len(set(ids)) != len(ids)):
                            raise ValueError("Invalid created item IDs")
                        job["createdItemIds"] = ids
                else:
                    job["code"] = "SYNC_FAILED"
            return {"ok": True}

def handle_portal(identity, body, queue=None):
    queue = queue or Queue()
    action = body.get("action")
    if action == "sicoob_refresh" and set(body) in ({"action"}, {"action", "requestId"}):
        if "requestId" in body:
            queue.validate_id(body["requestId"])
        status = queue.start(identity, body.get("requestId"))
    elif action == "sicoob_refresh_status" and set(body) == {"action", "requestId"}:
        status = queue.status(identity, body["requestId"])
    elif action == "sicoob_refresh_status" and set(body) == {"action", "mode"} and body["mode"] == "pending":
        status = queue.pending(identity)
    elif (action == "sicoob_refresh_status" and set(body) == {"action", "requestId", "acknowledge"}
          and body["acknowledge"] is True):
        status = queue.acknowledge(identity, body["requestId"])
    else:
        raise ValueError("Pedido de sincronização Sicoob inválido.")
    return {"status": "processed", "messages": [], "sicoobRefresh": status}

if __name__ == "__main__":
    try:
        operation = sys.argv[1] if len(sys.argv) == 2 else ""
        raw = sys.stdin.read(131073) if operation == "complete" else ""
        if len(raw) > 131072:
            raise ValueError("Worker receipt too large")
        payload = json.loads(raw) if operation == "complete" else None
        print(json.dumps(Queue().worker(operation, payload)))
    except Exception:
        print('{"ok":false,"code":"WORKER_COMMAND_FAILED"}')
        sys.exit(1)
