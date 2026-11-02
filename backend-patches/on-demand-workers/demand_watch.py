"""Fixed-name demand notifications over the existing authenticated SSH channel.

No fiscal queries, claims, receipts or user data travel on this stream.
"""
import ctypes
from datetime import datetime
import json
import os
from pathlib import Path
import select
import struct
import sys
import time


def timestamp(value):
    # .NET uses seven fractional digits; Python 3.9 accepts three or six.
    import re
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})', value)
    if not match:
        raise ValueError('Invalid retry timestamp')
    fraction = '.' + match[2][:6].ljust(6, '0') if match[2] else ''
    zone = '+00:00' if match[3] == 'Z' else match[3]
    return datetime.fromisoformat(match[1] + fraction + zone).timestamp()


def next_wake(state, kind, now):
    if kind not in {'dda', 'fiscal'}:
        raise ValueError('Invalid queue')
    jobs = state['jobs'].values()
    if kind == 'dda':
        return now if any(job['status'] == 'queued' for job in jobs) else None
    live = [job for job in jobs if job['status'] not in {'succeeded', 'partial', 'failed'}]
    blocked_until = max([now] + [job.get('leaseUntil', 0) for job in live])
    ready = [max(now, timestamp(source['nextAllowedAt'])) if source.get('nextAllowedAt') else now
             for job in live for source in job['sources'].values()
             if source['status'] not in {'succeeded', 'failed'}]
    return max(min(ready), blocked_until) if ready else None


class Notifications:
    def __init__(self):
        self.not_before = {}

    def update(self, states, now):
        events, deadlines = [], []
        for kind, state in states.items():
            ready = next_wake(state, kind, now)
            if ready is None:
                self.not_before.pop(kind, None)
                continue
            due = max(ready, self.not_before.get(kind, 0))
            if due <= now:
                events.append(kind)
                due = now + 15
                self.not_before[kind] = due
            deadlines.append(due)
        return events, min(deadlines) if deadlines else None


class Inotify:
    def __init__(self, directories):
        libc = ctypes.CDLL(None, use_errno=True)
        self.fd = libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
        if self.fd < 0:
            raise OSError(ctypes.get_errno(), 'inotify_init1')
        try:
            for directory in directories:
                # Watch directories because the queue atomically replaces state.json.
                mask = 0x00000008 | 0x00000080 | 0x00000100 | 0x00000400 | 0x00000800
                if libc.inotify_add_watch(self.fd, os.fsencode(directory), mask) < 0:
                    raise OSError(ctypes.get_errno(), 'inotify_add_watch')
        except Exception:
            os.close(self.fd)
            raise

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        os.close(self.fd)

    def wait(self, timeout):
        deadline = time.monotonic() + max(0, timeout)
        while True:
            if not select.select([self.fd], [], [], max(0, deadline - time.monotonic()))[0]:
                return False
            data = os.read(self.fd, 65536)
            changed = False
            offset = 0
            while offset < len(data):
                _, mask, _, length = struct.unpack_from('iIII', data, offset)
                offset += 16
                name = data[offset:offset + length].rstrip(b'\0')
                offset += length
                if mask & (0x400 | 0x800 | 0x8000):
                    raise RuntimeError('Queue directory changed')
                changed |= name == b'state.json' or bool(mask & 0x4000)  # overflow: rescan
            if changed:
                return True
            if time.monotonic() >= deadline:
                return False


def stream(queues, emit, clock=time.time, heartbeat_seconds=30):
    # Queue heartbeat writes use their existing locks, recovery and service user.
    for queue in queues.values():
        queue.worker('heartbeat')
    with Inotify([queue.root for queue in queues.values()]) as watcher:
        notifier = Notifications()
        heartbeat_at = clock() + heartbeat_seconds
        emit({'event': 'ready'})
        while True:
            now = clock()
            if now >= heartbeat_at:
                # Write to SSH before refreshing availability: a broken channel
                # must not continue advertising an available Windows worker.
                emit({'event': 'heartbeat'})
                for queue in queues.values():
                    queue.worker('heartbeat')
                heartbeat_at = now + heartbeat_seconds
            states = {kind: json.loads((Path(queue.root) / 'state.json').read_text(encoding='utf-8'))
                      for kind, queue in queues.items()}
            events, due = notifier.update(states, now)
            for kind in events:
                emit({'event': 'wake', 'queue': kind})
            deadline = min(heartbeat_at, due) if due is not None else heartbeat_at
            watcher.wait(max(0, deadline - clock()))


def emit(event):
    print(json.dumps(event, separators=(',', ':')), flush=True)


def main():
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    import dda_sync
    import sefaz_sync
    stream({'dda': dda_sync.Queue(), 'fiscal': sefaz_sync.Queue()}, emit)


if __name__ == '__main__':
    try:
        main()
    except (BrokenPipeError, KeyboardInterrupt):
        os._exit(0)
    except Exception:
        print('DEMAND_STREAM_FAILED', file=sys.stderr, flush=True)
        sys.exit(1)
