"""Private fixed-operation DDA queue. No banking payloads or credentials."""
import contextlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/var/lib/energetica-whatsapp/dda-sync")
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
                now = self.clock()
                for job in state["jobs"].values():
                    if job["status"] in ACTIVE and (now - state["heartbeat"] > 180 or now - job["createdAt"] > 2700):
                        job.update(status="failed", code="WORKER_UNAVAILABLE", completedAt=now)
                yield state
                state["jobs"] = dict(sorted(state["jobs"].items(), key=lambda item: item[1]["createdAt"])[-50:])
                temp = self.root / "state.tmp"
                temp.write_text(json.dumps(state), encoding="utf-8")
                os.chmod(temp, 0o600)
                os.replace(temp, path)
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
            raise PermissionError("Consulta DDA não autorizada para este usuário.")
        return str(identity["oid"])

    @staticmethod
    def public(job):
        result = {key: job[key] for key in ("requestId", "status", "code", "created", "updated", "verified", "createdItemIds") if key in job}
        if "completedAt" in job:
            result["completedUtc"] = datetime.fromtimestamp(job["completedAt"], timezone.utc).isoformat()
        return result

    def start(self, identity):
        owner = self.authorize(identity)
        with self.locked() as state:
            if self.clock() - state["heartbeat"] > 180:
                return {"status": "unavailable", "code": "WORKER_UNAVAILABLE"}
            for job in state["jobs"].values():
                if job["status"] in ACTIVE:
                    return self.public(job) if job["owner"] == owner else {"status": "busy"}
            job = {"requestId": uuid.uuid4().hex, "owner": owner, "status": "queued", "createdAt": self.clock()}
            state["jobs"][job["requestId"]] = job
            return self.public(job)

    def status(self, identity, request_id):
        owner = self.authorize(identity)
        if not re.fullmatch(r"[a-f0-9]{32}", str(request_id)):
            raise ValueError("Pedido DDA inválido.")
        with self.locked() as state:
            job = state["jobs"].get(request_id)
            if not job or job["owner"] != owner:
                raise PermissionError("Pedido DDA indisponível para esta sessão.")
            return self.public(job)

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
                success = payload.get("status") == "succeeded" and payload.get("failed", 0) == 0
                job.update(status="succeeded" if success else "failed", completedAt=self.clock())
                if success:
                    for key in ("created", "updated", "verified"):
                        value = payload.get(key, 0)
                        if type(value) is not int or not 0 <= value <= 1000000:
                            raise ValueError("Invalid count")
                        job[key] = value
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
    if action == "dda_refresh" and set(body) == {"action"}:
        status = queue.start(identity)
    elif action == "dda_refresh_status" and set(body) == {"action", "requestId"}:
        status = queue.status(identity, body["requestId"])
    else:
        raise ValueError("Pedido de sincronização DDA inválido.")
    return {"status": "processed", "messages": [], "ddaRefresh": status}

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
