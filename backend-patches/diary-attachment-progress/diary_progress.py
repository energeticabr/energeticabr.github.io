"""Optional, bounded and identity-scoped telemetry; never runs a workflow."""
from contextlib import contextmanager
from contextvars import ContextVar
import math
import re
import threading
import time

_sink = ContextVar("diary_evidence_progress", default=None)
STAGES = frozenset({"starting", "photos", "pdf", "merging", "saving", "ready"})


def emit_progress(percent, stage):
    sink = _sink.get()
    if sink is not None:
        sink(percent, stage)


class ProgressRegistry:
    def __init__(self, *, clock=time.monotonic, ttl=1800, limit=256):
        self.clock, self.ttl, self.limit = clock, ttl, limit
        self.jobs = {}
        self.lock = threading.Lock()

    @staticmethod
    def _key(identity, request_id):
        # Existing portal authentication verifies Graph /me and returns its
        # directory object ID without JWT tenant claims. Use its service
        # authority namespace; honor tid too if the authenticator supplies it.
        tenant = str(identity.get("tid") or "portal-microsoft-graph")
        owner = str(identity.get("oid") or "")
        if not owner:
            raise PermissionError("Identidade Microsoft incompleta")
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise ValueError("Identificador de progresso inválido")
        return tenant, owner, request_id

    def _expire(self):
        now = self.clock()
        for key in list(self.jobs):
            if now - self.jobs[key]["updated"] >= self.ttl:
                del self.jobs[key]

    @staticmethod
    def _public(request_id, job):
        return {"requestId": request_id, "percent": job["percent"],
                "stage": job["stage"], "status": job["status"]}

    def snapshot(self, identity, request_id):
        key = self._key(identity, request_id)
        with self.lock:
            self._expire()
            job = self.jobs.get(key)
            return self._public(request_id, job) if job else {
                "requestId": request_id, "percent": 0, "stage": "starting", "status": "unavailable"}

    @contextmanager
    def scope(self, identity, request_id, *, observer=None):
        key = self._key(identity, request_id)
        job = {"percent": 0, "stage": "starting", "status": "running",
               "updated": self.clock(), "confirmed": False, "ready": False}
        with self.lock:
            self._expire()
            while len(self.jobs) >= self.limit:
                del self.jobs[next(iter(self.jobs))]
            self.jobs[key] = job

        def update(percent, stage):
            if (isinstance(percent, bool) or not isinstance(percent, (int, float))
                    or not math.isfinite(percent) or percent < 0 or stage not in STAGES):
                return
            with self.lock:
                if self.jobs.get(key) is not job:
                    return
                job["percent"] = max(job["percent"], min(99, int(percent)))
                job["stage"], job["updated"] = stage, self.clock()
                job["ready"] = job["ready"] or stage == "ready"
                snapshot = self._public(request_id, job)
            if observer:
                observer(snapshot)
        token = _sink.set(update)
        try:
            yield job
        finally:
            _sink.reset(token)
            with self.lock:
                if job["confirmed"] and job["ready"]:
                    job.update(percent=100, status="complete", updated=self.clock())
                else:
                    job.update(status="failed", updated=self.clock())


REGISTRY = ProgressRegistry()


def finish_diary_request(identity, body, handle, make_public, *, registry=REGISTRY):
    """Only mark complete once both processing and the public response succeeded."""
    request_id = body.get("messageId")
    with registry.scope(identity, request_id) as job:
        result = make_public(handle())
        job["confirmed"] = True
    return {**result, "diaryEvidenceProgress": registry.snapshot(identity, request_id)}
