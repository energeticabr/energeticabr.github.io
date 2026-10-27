"""Optional operation stages. No timers, business reads, or workflow mutations."""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
import math
import re
import threading
import time

STAGES = ("identity", "processing", "flow", "attachments", "response")
_current = ContextVar("portal_operation_progress", default=None)


def advance(name):
    job = _current.get()
    if job is not None and name in STAGES:
        job["registry"].update(job, name)


def work_units(percent):
    job = _current.get()
    if job is not None and isinstance(percent, (int, float)) and not isinstance(percent, bool) and math.isfinite(percent) and 0 <= percent <= 100:
        job["registry"].update(job, "processing", percent / 100)


def stage(name):
    def decorate(function):
        @wraps(function)
        def run(*args, **kwargs):
            value = function(*args, **kwargs)
            advance(name)
            return value
        return run
    return decorate


class ProgressRegistry:
    def __init__(self, *, clock=time.monotonic, ttl=1800, limit=256):
        self.clock, self.ttl, self.limit = clock, ttl, limit
        self.jobs = {}
        self.lock = threading.Lock()

    @staticmethod
    def key(identity, request_id):
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise ValueError("Identificador de progresso inválido")
        oid = str(identity.get("oid") or "").strip()
        if not oid: raise ValueError("Identidade de progresso inválida")
        return (str(identity.get("tid") or "portal-microsoft-graph"), oid, request_id)

    def expire(self):
        for key in list(self.jobs):
            if self.clock() - self.jobs[key]["updated"] >= self.ttl: del self.jobs[key]

    @staticmethod
    def public(job):
        return {"requestId": job["requestId"], "percent": job["percent"],
                "completed": len(job["done"]), "total": len(job["stages"]),
                "stage": job["stage"], "status": job["status"]}

    def snapshot(self, identity, request_id):
        key = self.key(identity, request_id)
        with self.lock:
            self.expire()
            job = self.jobs.get(key)
            return self.public(job) if job else {"requestId": request_id, "percent": 0,
                "completed": 0, "total": len(STAGES), "stage": "starting", "status": "unavailable"}

    def update(self, job, name, fraction=None):
        with self.lock:
            if self.jobs.get(job["key"]) is not job or job["status"] != "running" or name not in job["stages"]: return
            if fraction is None: job["done"].add(name)
            else: job["fraction"] = max(job["fraction"], fraction)
            completed = len(job["done"]) + (job["fraction"] if "processing" not in job["done"] else 0)
            job.update(percent=max(job["percent"], min(99, int(completed * 100 / len(job["stages"])))),
                       stage=name, updated=self.clock())

    @contextmanager
    def scope(self, identity, request_id, *, stages=None):
        if request_id is None:
            yield None
            return
        key = self.key(identity, request_id)
        stages = tuple(STAGES if stages is None else stages)
        if not stages or len(set(stages)) != len(stages) or any(name not in STAGES for name in stages):
            raise ValueError("Etapas de progresso inválidas")
        job = {"key": key, "registry": self, "requestId": request_id, "percent": 0,
               "done": set(), "fraction": 0, "stage": "starting", "status": "running",
               "updated": self.clock(), "stages": stages}
        with self.lock:
            self.expire()
            while len(self.jobs) >= self.limit: del self.jobs[next(iter(self.jobs))]
            # A legitimate read retry must never fail because optional telemetry
            # retained its previous attempt. update() fences displaced jobs.
            self.jobs[key] = job
        token = _current.set(job)
        try: yield job
        finally:
            _current.reset(token)
            with self.lock:
                if job["status"] == "running": job.update(status="failed", updated=self.clock())


REGISTRY = ProgressRegistry()


def public_progress(status, payload):
    job = _current.get()
    if job is None: return payload
    advance("response")
    failed = any(re.search(r"error|fail|paused|invalid|unavailable|reupload", str(item.get("status") or ""), re.I)
                 for item in payload.get("results", []) if isinstance(item, dict))
    confirmed = (status == 200 and payload.get("status") == "processed"
                 and isinstance(payload.get("messages"), list) and not payload.get("error") and not failed
                 and len(job["done"]) == len(job["stages"]))
    with job["registry"].lock:
        job.update(status="complete" if confirmed else "failed", updated=job["registry"].clock())
        if confirmed: job["percent"] = 100
        value = job["registry"].public(job)
    return {**payload, "operationProgress": value}
