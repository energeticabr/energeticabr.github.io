"""Persist camera reachability and run low-cost provider status checks."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import hashlib
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import threading
import time
import uuid


ICSEE_STATUS_INTERVAL_SECONDS = 2 * 60 * 60
YOOSEE_STATUS_POLL_SECONDS = 30
ICSEE_STATUS_TIMEOUT_SECONDS = 30
ICSEE_CHANNEL_MISSES_FOR_OFFLINE = 2
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
                checked_at TEXT NOT NULL,
                last_confirmed_state TEXT CHECK (last_confirmed_state IN ('online', 'offline') OR last_confirmed_state IS NULL)
            )
        """)
        columns = {row[1] for row in self._connection.execute("PRAGMA table_info(camera_status)")}
        if "last_confirmed_state" not in columns:
            self._connection.execute("""
                ALTER TABLE camera_status ADD COLUMN last_confirmed_state TEXT
                CHECK (last_confirmed_state IN ('online', 'offline') OR last_confirmed_state IS NULL)
            """)
            self._connection.execute("""
                UPDATE camera_status SET last_confirmed_state = state
                WHERE state IN ('online', 'offline')
            """)
        self._connection.execute("""
            CREATE TABLE IF NOT EXISTS camera_status_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT NOT NULL,
                state TEXT NOT NULL CHECK (state IN ('online', 'offline')),
                changed_at TEXT NOT NULL
            )
        """)
        event_schema = self._connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'camera_status_events'"
        ).fetchone()[0]
        compact_schema = "".join(str(event_schema).lower().split())
        if "unique(channel_id,state,changed_at)" in compact_schema:
            # Remove the second-resolution uniqueness constraint while
            # retaining the complete event history and IDs.
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                self._connection.execute("ALTER TABLE camera_status_events RENAME TO camera_status_events_legacy")
                self._connection.execute("""
                    CREATE TABLE camera_status_events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        channel_id TEXT NOT NULL,
                        state TEXT NOT NULL CHECK (state IN ('online', 'offline')),
                        changed_at TEXT NOT NULL
                    )
                """)
                self._connection.execute("""
                    INSERT INTO camera_status_events(id, channel_id, state, changed_at)
                    SELECT id, channel_id, state, changed_at FROM camera_status_events_legacy ORDER BY id
                """)
                self._connection.execute("DROP TABLE camera_status_events_legacy")
                self._connection.commit()
            except BaseException:
                self._connection.rollback()
                raise
        self._connection.execute("""
            CREATE TABLE IF NOT EXISTS camera_status_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        self._connection.execute("""
            CREATE TABLE IF NOT EXISTS camera_status_checks (
                source_key TEXT PRIMARY KEY,
                checked_at TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'unknown' CHECK (state IN ('online', 'offline', 'unknown')),
                consecutive_misses INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_misses >= 0)
            )
        """)
        check_columns = {row[1] for row in self._connection.execute("PRAGMA table_info(camera_status_checks)")}
        if "state" not in check_columns:
            self._connection.execute("""
                ALTER TABLE camera_status_checks ADD COLUMN state TEXT NOT NULL DEFAULT 'unknown'
                CHECK (state IN ('online', 'offline', 'unknown'))
            """)
        if "consecutive_misses" not in check_columns:
            self._connection.execute("""
                ALTER TABLE camera_status_checks ADD COLUMN consecutive_misses INTEGER NOT NULL DEFAULT 0
                CHECK (consecutive_misses >= 0)
            """)
        self._connection.execute(
            "INSERT OR IGNORE INTO camera_status_meta(key, value) VALUES ('event_generation', ?)",
            (uuid.uuid4().hex,),
        )
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
            self._connection.execute("BEGIN IMMEDIATE")
            try:
                previous = self._connection.execute(
                    "SELECT last_online_at, last_confirmed_state, checked_at FROM camera_status WHERE channel_id = ?",
                    (channel_id,),
                ).fetchone()
                previous_state = previous[1] if previous else None
                previous_online = previous[0] if previous else None
                previous_checked = _parse_time(previous[2]) if previous else None
                if previous_checked and _parse_time(checked) < previous_checked:
                    self._connection.rollback()
                    return self.get(channel_id)
                if status == "online":
                    last_online_at = utc_text(_parse_time(last_online_at) or _parse_time(checked))
                elif last_online_at:
                    parsed_last_online = _parse_time(last_online_at)
                    last_online_at = utc_text(parsed_last_online) if parsed_last_online else previous_online
                else:
                    last_online_at = previous_online
                last_confirmed_state = status if status in {"online", "offline"} else previous_state
                self._connection.execute("""
                    INSERT INTO camera_status(channel_id, state, last_online_at, checked_at, last_confirmed_state)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(channel_id) DO UPDATE SET
                        state = excluded.state,
                        last_online_at = excluded.last_online_at,
                        checked_at = excluded.checked_at,
                        last_confirmed_state = excluded.last_confirmed_state
                """, (channel_id, status, last_online_at, checked, last_confirmed_state))
                if previous_state in {"online", "offline"} and status in {"online", "offline"} \
                        and status != previous_state:
                    self._connection.execute("""
                        INSERT INTO camera_status_events(channel_id, state, changed_at)
                        VALUES (?, ?, ?)
                    """, (channel_id, status, checked))
                self._connection.commit()
            except BaseException:
                self._connection.rollback()
                raise
        return self.get(channel_id)

    def event_cursor(self):
        with self._lock:
            row = self._connection.execute(
                "SELECT COALESCE(MAX(id), 0) FROM camera_status_events"
            ).fetchone()
        return int(row[0])

    def event_generation(self):
        with self._lock:
            row = self._connection.execute(
                "SELECT value FROM camera_status_meta WHERE key = 'event_generation'"
            ).fetchone()
        return row[0]

    def event_baseline(self):
        with self._lock:
            cursor, generation = self._connection.execute("""
                SELECT COALESCE((SELECT MAX(id) FROM camera_status_events), 0), value
                FROM camera_status_meta WHERE key = 'event_generation'
            """).fetchone()
        return {"events": [], "cursor": int(cursor), "generation": generation}

    def source_check(self, source_key):
        with self._lock:
            row = self._connection.execute(
                "SELECT checked_at, state, consecutive_misses FROM camera_status_checks WHERE source_key = ?",
                (source_key,),
            ).fetchone()
        return {"checkedAt": row[0], "status": row[1], "consecutiveMisses": int(row[2])} if row else None

    def mark_source_checked(self, source_key, checked_at, status="unknown", *, no_video=False):
        if status not in VALID_STATES:
            raise ValueError("Invalid camera status")
        checked = utc_text(_parse_time(checked_at))
        with self._lock:
            row = self._connection.execute(
                "SELECT consecutive_misses FROM camera_status_checks WHERE source_key = ?", (source_key,)
            ).fetchone()
            misses = (int(row[0]) if row else 0) + 1 if no_video else 0
            self._connection.execute("""
                INSERT INTO camera_status_checks(source_key, checked_at, state, consecutive_misses)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(source_key) DO UPDATE SET
                    checked_at = excluded.checked_at,
                    state = excluded.state,
                    consecutive_misses = excluded.consecutive_misses
            """, (source_key, checked, status, misses))
            self._connection.commit()
        return misses

    def events_after(self, cursor, *, limit=100):
        cursor = max(0, int(cursor))
        limit = max(1, min(100, int(limit)))
        with self._lock:
            rows = self._connection.execute("""
                SELECT id, channel_id, state, changed_at
                FROM camera_status_events WHERE id > ? ORDER BY id LIMIT ?
            """, (cursor, limit)).fetchall()
            latest, generation = self._connection.execute("""
                SELECT COALESCE((SELECT MAX(id) FROM camera_status_events), 0), value
                FROM camera_status_meta WHERE key = 'event_generation'
            """).fetchone()
        events = [{"id": int(row[0]), "channelId": row[1], "status": row[2],
                   "changedAt": row[3]} for row in rows]
        next_cursor = events[-1]["id"] if events else int(latest)
        return {"events": events, "cursor": next_cursor, "generation": generation}

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


def provider_group(entry):
    source = entry.get("input") or {}
    if is_yoosee_entry(entry):
        return "yoosee", str(source["deviceId"])
    if is_icsee_entry(entry):
        return "icsee", source["cloudId"]
    return None


class CameraStatusMonitor:
    def __init__(self, entries, store, *, socket_path=None, icsee_query=query_icsee_status,
                 icsee_channel_query=None, icsee_live_query=None,
                 yoosee_query=read_yoosee_status, clock=utc_now,
                 poll_seconds=YOOSEE_STATUS_POLL_SECONDS):
        self.entries = list(entries.values()) if isinstance(entries, dict) else list(entries)
        self.store = store
        self.socket_path = socket_path or os.environ.get("YOOSEE_SOCKET", "/run/energetico-yoosee/live.sock")
        self.icsee_query = icsee_query
        self.icsee_channel_query = icsee_channel_query or (lambda _entry: "online")
        self.icsee_live_query = icsee_live_query or (lambda _entry: "unknown")
        self.yoosee_query = yoosee_query
        self.clock = clock
        self.poll_seconds = poll_seconds
        self.stop_event = threading.Event()
        self.thread = None
        self.icsee_thread = None
        self.icsee_thread_lock = threading.Lock()

    def _groups(self):
        groups = {}
        for entry in self.entries:
            key = provider_group(entry)
            if key is not None:
                groups.setdefault(key, []).append(entry)
        return groups

    def _poll_yoosee(self, groups):
        yoosee_groups = {key: group for key, group in groups.items() if key[0] == "yoosee"}
        if yoosee_groups:
            checked_at = utc_text(self.clock())
            try:
                snapshot = self.yoosee_query(self.socket_path)
            except (OSError, ValueError, TimeoutError):
                snapshot = None
            for (_provider, device), group in yoosee_groups.items():
                record = snapshot.get(device) if isinstance(snapshot, dict) else None
                state = record.get("status") if isinstance(record, dict) else None
                if state not in VALID_STATES:
                    state = "unknown"
                last_online = record.get("lastOnlineAt") if isinstance(record, dict) else None
                for entry in group:
                    self.store.update(entry["id"], state, checked_at=checked_at,
                                      last_online_at=last_online)

    def _poll_icsee(self, groups):
        for (_provider, cloud_id), group in groups.items():
            if _provider != "icsee":
                continue
            source_key = "icsee:" + hashlib.sha256(cloud_id.encode("utf-8")).hexdigest()
            previous_provider = self.store.source_check(source_key)
            now = self.clock()
            provider_due = is_icsee_status_due(
                previous_provider["checkedAt"] if previous_provider else None, now
            )
            if provider_due:
                provider_checked_at = utc_text(now)
                try:
                    provider_state = self.icsee_query(group[0])
                except Exception:
                    provider_state = "unknown"
                if provider_state not in VALID_STATES:
                    provider_state = "unknown"
                self.store.mark_source_checked(source_key, provider_checked_at, provider_state)
            else:
                provider_state = previous_provider["status"]

            if provider_due and provider_state != "online":
                for entry in group:
                    try:
                        live_state = self.icsee_live_query(entry)
                    except Exception:
                        live_state = "unknown"
                    if live_state == "online":
                        self.store.update(entry["id"], "online", checked_at=utc_text(self.clock()))
                    elif live_state == "unknown":
                        self.store.update(entry["id"], "unknown", checked_at=provider_checked_at)
                    else:
                        self.store.update(entry["id"], provider_state, checked_at=provider_checked_at)
                continue
            if provider_state != "online":
                continue

            provider_recovered = previous_provider is not None and previous_provider["status"] != "online"
            for entry in group:
                channel_key = "icsee-channel:" + hashlib.sha256(entry["id"].encode("utf-8")).hexdigest()
                previous_channel = self.store.source_check(channel_key)
                now = self.clock()
                channel_due = is_icsee_status_due(
                    previous_channel["checkedAt"] if previous_channel else None, now
                )
                if not provider_recovered and not channel_due:
                    continue
                channel_started_at = utc_text(now)
                try:
                    state = self.icsee_channel_query(entry)
                except Exception:
                    state = "unknown"
                channel_finished_at = utc_text(self.clock())
                if state == "no_video":
                    try:
                        live_state = self.icsee_live_query(entry)
                    except Exception:
                        live_state = "unknown"
                    if live_state == "online":
                        state = "online"
                        self.store.mark_source_checked(channel_key, channel_finished_at, state)
                        self.store.update(entry["id"], state, checked_at=channel_finished_at)
                        continue
                    if live_state == "unknown":
                        state = "unknown"
                        self.store.mark_source_checked(channel_key, channel_finished_at, state)
                        self.store.update(entry["id"], state, checked_at=channel_started_at)
                        continue
                    misses = self.store.mark_source_checked(
                        channel_key, channel_finished_at, "unknown", no_video=True,
                    )
                    state = "offline" if misses >= ICSEE_CHANNEL_MISSES_FOR_OFFLINE else "unknown"
                else:
                    if state not in VALID_STATES:
                        state = "unknown"
                    self.store.mark_source_checked(channel_key, channel_finished_at, state)
                self.store.update(entry["id"], state, checked_at=channel_started_at)

    def poll_once(self):
        groups = self._groups()
        self._poll_yoosee(groups)
        self._poll_icsee(groups)

    def _schedule_icsee(self, groups):
        if not any(provider == "icsee" for provider, _key in groups):
            return
        with self.icsee_thread_lock:
            if self.icsee_thread and self.icsee_thread.is_alive():
                return
            self.icsee_thread = threading.Thread(
                target=self._poll_icsee, args=(groups,), name="icsee-status-monitor", daemon=True,
            )
            self.icsee_thread.start()

    def run(self):
        while not self.stop_event.is_set():
            try:
                groups = self._groups()
                self._poll_yoosee(groups)
                self._schedule_icsee(groups)
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
