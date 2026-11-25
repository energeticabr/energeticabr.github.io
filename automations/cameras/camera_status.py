"""Persist camera reachability and run low-cost provider status checks."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import threading
import time


ICSEE_STATUS_INTERVAL_SECONDS = 2 * 60 * 60
YOOSEE_STATUS_POLL_SECONDS = 30
ICSEE_STATUS_TIMEOUT_SECONDS = 30
VALID_STATES = {"online", "offline", "unknown"}


def utc_now():
    return datetime.now(timezone.utc)


def utc_text(value=None):
    current = value or utc_now()
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _parse_time(value):
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_icsee_status_due(last_checked_at, now=None, interval_seconds=ICSEE_STATUS_INTERVAL_SECONDS):
    previous = _parse_time(last_checked_at)
    if previous is None:
        return True
    current = _parse_time(now) or utc_now()
    return (current - previous).total_seconds() >= interval_seconds


class CameraStatusStore:
    def __init__(self, path):
        path = str(path)
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._connection = sqlite3.connect(path, check_same_thread=False, timeout=10)
        self._connection.execute("PRAGMA busy_timeout = 10000")
        if path != ":memory:":
            self._connection.execute("PRAGMA journal_mode = WAL")
        self._connection.execute("""
            CREATE TABLE IF NOT EXISTS camera_status (
                channel_id TEXT PRIMARY KEY,
                state TEXT NOT NULL CHECK (state IN ('online', 'offline', 'unknown')),
                last_online_at TEXT,
                checked_at TEXT NOT NULL
            )
        """)
        self._connection.commit()

    def get(self, channel_id):
        with self._lock:
            row = self._connection.execute(
                "SELECT state, last_online_at, checked_at FROM camera_status WHERE channel_id = ?",
                (channel_id,),
            ).fetchone()
        if row is None:
            return {"status": "unknown", "lastOnlineAt": None, "checkedAt": None}
        return {"status": row[0], "lastOnlineAt": row[1], "checkedAt": row[2]}

    def update(self, channel_id, status, *, checked_at=None, last_online_at=None):
        if status not in VALID_STATES:
            raise ValueError("Invalid camera status")
        checked = utc_text(_parse_time(checked_at))
        with self._lock:
            previous = self._connection.execute(
                "SELECT last_online_at FROM camera_status WHERE channel_id = ?", (channel_id,),
            ).fetchone()
            previous_online = previous[0] if previous else None
            if status == "online":
                last_online_at = utc_text(_parse_time(last_online_at) or _parse_time(checked))
            elif last_online_at:
                parsed_last_online = _parse_time(last_online_at)
                last_online_at = utc_text(parsed_last_online) if parsed_last_online else previous_online
            else:
                last_online_at = previous_online
            self._connection.execute("""
                INSERT INTO camera_status(channel_id, state, last_online_at, checked_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(channel_id) DO UPDATE SET
                    state = excluded.state,
                    last_online_at = excluded.last_online_at,
                    checked_at = excluded.checked_at
            """, (channel_id, status, last_online_at, checked))
            self._connection.commit()
        return self.get(channel_id)

    def close(self):
        with self._lock:
            self._connection.close()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def query_icsee_status(entry, *, timeout=ICSEE_STATUS_TIMEOUT_SECONDS):
    """Use the installed CloudIdClient without starting video or sending camera credentials."""
    source = entry.get("input") or {}
    command = entry.get("command")
    cloud_id = source.get("cloudId")
    pins = source.get("tlsPins")
    if (not isinstance(command, list) or not command or not isinstance(cloud_id, str)
            or not isinstance(pins, dict) or not isinstance(pins.get("status"), str)
            or not isinstance(pins.get("relay"), str)):
        return "unknown"
    payload = {"operation": "status", "cloudId": cloud_id, "tlsPins": pins}
    try:
        result = subprocess.run(
            command, input=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout, check=False,
        )
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return "unknown"
    if result.returncode != 0:
        return "unknown"
    try:
        response = json.loads(result.stdout)
    except (TypeError, ValueError, UnicodeError):
        return "unknown"
    status = response.get("status") if isinstance(response, dict) else None
    return {"Online": "online", "Offline": "offline"}.get(status, "unknown")


def read_yoosee_status(socket_path="/run/energetico-yoosee/live.sock", *, timeout=3):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(timeout)
        connection.connect(socket_path)
        connection.sendall(b"STATUS\n")
        with connection.makefile("rb") as stream:
            payload = stream.readline(32769)
    if not payload or len(payload) > 32768 or not payload.endswith(b"\n"):
        raise ValueError("Invalid Yoosee status response")
    result = json.loads(payload)
    if not isinstance(result, dict):
        raise ValueError("Invalid Yoosee status response")
    return result


def is_icsee_entry(entry):
    source = entry.get("input") or {}
    return isinstance(source.get("cloudId"), str) and bool(source.get("cloudId"))


def is_yoosee_entry(entry):
    source = entry.get("input") or {}
    return type(source.get("deviceId")) is int and source["deviceId"] > 0


class CameraStatusMonitor:
    def __init__(self, entries, store, *, socket_path=None, icsee_query=query_icsee_status,
                 yoosee_query=read_yoosee_status, clock=utc_now,
                 poll_seconds=YOOSEE_STATUS_POLL_SECONDS):
        self.entries = list(entries.values()) if isinstance(entries, dict) else list(entries)
        self.store = store
        self.socket_path = socket_path or os.environ.get("YOOSEE_SOCKET", "/run/energetico-yoosee/live.sock")
        self.icsee_query = icsee_query
        self.yoosee_query = yoosee_query
        self.clock = clock
        self.poll_seconds = poll_seconds
        self.stop_event = threading.Event()
        self.thread = None

    def poll_once(self):
        now = self.clock()
        checked_at = utc_text(now)
        yoosee_entries = [entry for entry in self.entries if is_yoosee_entry(entry)]
        if yoosee_entries:
            try:
                snapshot = self.yoosee_query(self.socket_path)
            except (OSError, ValueError, TimeoutError):
                snapshot = None
            for entry in yoosee_entries:
                device = str(entry["input"]["deviceId"])
                record = snapshot.get(device) if isinstance(snapshot, dict) else None
                state = record.get("status") if isinstance(record, dict) else None
                if state not in VALID_STATES:
                    state = "unknown"
                last_online = record.get("lastOnlineAt") if isinstance(record, dict) else None
                self.store.update(entry["id"], state, checked_at=checked_at,
                                  last_online_at=last_online)

        for entry in self.entries:
            if not is_icsee_entry(entry):
                continue
            current = self.store.get(entry["id"])
            if not is_icsee_status_due(current["checkedAt"], now):
                continue
            try:
                state = self.icsee_query(entry)
            except Exception:
                state = "unknown"
            if state not in VALID_STATES:
                state = "unknown"
            self.store.update(entry["id"], state, checked_at=checked_at)

    def run(self):
        while not self.stop_event.is_set():
            try:
                self.poll_once()
            except Exception:
                # A failed provider poll must not stop the camera catalog service.
                pass
            self.stop_event.wait(self.poll_seconds)

    def start(self):
        if self.thread and self.thread.is_alive():
            return self.thread
        self.stop_event.clear()
        self.thread = threading.Thread(target=self.run, name="camera-status-monitor", daemon=True)
        self.thread.start()
        return self.thread

    def stop(self):
        self.stop_event.set()
