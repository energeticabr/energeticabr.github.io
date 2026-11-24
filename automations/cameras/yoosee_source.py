"""Adapt the Yoosee desktop SDK to the camera gateway's Annex B input."""

import asyncio
import contextlib
import json
import os
import re
import shutil
import socket
import sys
import time
from ctypes import c_int64
from pathlib import Path

SOCKET = "/run/energetico-yoosee/live.sock"
MAX_START_BUFFER = 512 * 1024
HEVC_VPS = b"\x00\x00\x01\x40"


def parse_request(line):
    entry = json.loads(line)
    if not isinstance(entry, dict):
        raise ValueError("Invalid adapter input")
    operation = entry.get("operation", "live")
    device_id = entry.get("deviceId")
    if operation not in {"live", "recordings"} or type(device_id) is not int or not 0 < device_id < 2**64:
        raise ValueError("Invalid camera or operation")
    return operation, device_id


def load_credentials(directory):
    entry = json.loads((directory / "yoosee.json").read_text(encoding="utf-8"))
    if not isinstance(entry, dict):
        raise ValueError("Invalid Yoosee credentials")
    account, password = entry.get("account"), entry.get("password")
    if not isinstance(account, str) or "@" not in account or not isinstance(password, str) or not password:
        raise ValueError("Invalid Yoosee credentials")
    return account, password


def sdk_input(session, device_id):
    token = session.access_token
    if not isinstance(token, str) or not re.fullmatch(r"[0-9a-fA-F]{128}", token):
        raise ValueError("Unexpected Yoosee SDK token format")
    return f"{c_int64(int(session.access_id)).value}\n{device_id}\n{token}\n".encode("ascii")


def remember_video(buffer, packet):
    previous_end = len(buffer)
    buffer.extend(packet)
    start = buffer.rfind(HEVC_VPS, max(0, previous_end - len(HEVC_VPS)))
    if start > 0:
        del buffer[:start]
    if len(buffer) > MAX_START_BUFFER:
        del buffer[:-MAX_START_BUFFER]


def launch(sdk_root, device_id):
    runtime = sdk_root / "runtime" / "usr"
    loader = runtime / "bin" / "wine64"
    state = Path(os.environ["STATE_DIRECTORY"]) / str(device_id)
    mingw = runtime / "x86_64-w64-mingw32" / "sys-root" / "mingw" / "bin"
    system32 = state / "wine" / "drive_c" / "windows" / "system32"
    system32.mkdir(parents=True, exist_ok=True)
    for library in mingw.glob("*.dll"):
        target = system32 / library.name
        if target.is_symlink() and target.readlink() != library:
            target.unlink()
        try:
            target.symlink_to(library)
        except FileExistsError:
            pass
    environment = {
        **os.environ,
        "HOME": str(state),
        "PATH": f"{runtime / 'bin'}:{os.defpath}",
        "LD_LIBRARY_PATH": f"{runtime / 'lib64'}:{runtime / 'lib64' / 'wine' / 'x86_64-unix'}",
        "WINEPREFIX": str(state / "wine"),
        "WINEARCH": "win64",
        "WINEDEBUG": "-all",
        "WINEDLLPATH": str(runtime / "lib64" / "wine"),
        "WINEPATH": "Z:" + str(mingw).replace("/", "\\"),
        "WINELOADER": str(loader),
        "WINESERVER": str(runtime / "bin" / "wineserver64"),
        "WINEDLLOVERRIDES": "mscoree,mshtml=;msvcp140,vcruntime140,vcruntime140_1=n,b",
    }
    os.chdir(state)
    os.execve(loader, [str(loader), str(sdk_root / "bin" / "yoosee_live.exe")], environment)


class Hub:
    def __init__(self, root, devices):
        self.root = root
        self.clients = {device: set() for device in devices}
        self.buffers = {device: bytearray() for device in devices}
        self.workers = {}
        self.session = None
        self.session_at = 0.0
        self.login_lock = asyncio.Lock()
        self.start_lock = asyncio.Lock()

    async def access(self):
        from yoosee_cloud.login import account_login, load_app_keys

        async with self.login_lock:
            if self.session is None or time.monotonic() - self.session_at > 90:
                account, password = load_credentials(Path(os.environ["CREDENTIALS_DIRECTORY"]))
                self.session = await account_login(load_app_keys(), account, password, "BR")
                self.session_at = time.monotonic()
            return self.session

    async def connect(self, reader, writer):
        watchers = None
        try:
            line = await asyncio.wait_for(reader.readline(), 4)
            if not re.fullmatch(rb"[0-9]{1,20}\n", line):
                return
            device = int(line)
            watchers = self.clients.get(device)
            if watchers is None:
                return
            watchers.add(writer)
            if self.buffers[device]:
                writer.write(bytes(self.buffers[device]))
            await reader.read()
        except (OSError, ValueError, asyncio.TimeoutError):
            pass
        finally:
            if watchers is not None:
                watchers.discard(writer)
            writer.close()
            with contextlib.suppress(OSError):
                await writer.wait_closed()

    async def pump(self, device, watchers):
        while True:
            process = None
            logger = None
            try:
                async with self.start_lock:
                    started = time.monotonic()
                    session = await self.access()
                    print(f"Yoosee {device % 10000:04d}: abrindo vídeo", file=sys.stderr, flush=True)
                    process = await asyncio.create_subprocess_exec(
                        sys.executable, "-B", __file__, str(self.root), "worker", str(device),
                        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    logger = asyncio.create_task(self.report(process.stderr))
                    process.stdin.write(sdk_input(session, device))
                    await process.stdin.drain()
                    initial = await asyncio.wait_for(process.stdout.readexactly(40_000), 50)
                    print(f"Yoosee {device % 10000:04d}: vídeo recebido em {time.monotonic() - started:.1f}s",
                          file=sys.stderr, flush=True)
                self.publish(device, watchers, initial)
                while True:
                    packet = await asyncio.wait_for(process.stdout.read(16384), 65)
                    if not packet:
                        raise EOFError("SDK stream ended")
                    self.publish(device, watchers, packet)
            except Exception as error:
                print(f"Yoosee {device % 10000:04d}: {type(error).__name__}", file=sys.stderr, flush=True)
                self.buffers[device].clear()
                for writer in tuple(watchers):
                    writer.close()
                watchers.clear()
            finally:
                if process is not None:
                    if logger is not None:
                        logger.cancel()
                        with contextlib.suppress(asyncio.CancelledError, ValueError):
                            await logger
                    process.stdin.close()
                    try:
                        await asyncio.wait_for(process.communicate(), 7)
                    except asyncio.TimeoutError:
                        with contextlib.suppress(ProcessLookupError):
                            process.kill()
                        await process.communicate()
            await asyncio.sleep(5)

    @staticmethod
    async def report(stream):
        while True:
            line = await stream.readline()
            if not line:
                return
            if re.fullmatch(rb"YOOSEE device [0-9]{1,4} (?:(?:state|playback error) -?[0-9]+|codec [0-9]+ resolution [0-9]+x[0-9]+)\r?\n", line):
                sys.stderr.buffer.write(line)
                sys.stderr.buffer.flush()

    def publish(self, device, watchers, packet):
        remember_video(self.buffers[device], packet)
        for writer in tuple(watchers):
            if writer.transport.get_write_buffer_size() > 1024 * 1024:
                writer.close()
                watchers.discard(writer)
            else:
                writer.write(packet)


async def serve(root, devices, socket_path):
    sys.path.insert(0, str(root))
    hub = Hub(root, devices)
    Path(socket_path).unlink(missing_ok=True)
    async with await asyncio.start_unix_server(hub.connect, path=socket_path, limit=4096) as server:
        os.chmod(socket_path, 0o600)
        for device, watchers in hub.clients.items():
            hub.workers[device] = asyncio.create_task(hub.pump(device, watchers))
        await server.serve_forever()


def subscribe(device_id, socket_path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.connect(socket_path)
        connection.sendall(f"{device_id}\n".encode("ascii"))
        with connection.makefile("rb") as stream:
            shutil.copyfileobj(stream, sys.stdout.buffer, 16384)


def main():
    try:
        mode = sys.argv[2] if len(sys.argv) > 2 else "subscribe"
        socket_path = os.environ.get("YOOSEE_SOCKET", SOCKET)
        if mode == "worker":
            launch(Path(sys.argv[1]), int(sys.argv[3]))
        elif mode == "serve":
            if len(sys.argv) > 3:
                devices = tuple(map(int, sys.argv[3:]))
            else:
                credential = Path(os.environ["CREDENTIALS_DIRECTORY"]) / "yoosee.json"
                devices = tuple(json.loads(credential.read_text(encoding="utf-8"))["devices"])
            if (not 1 <= len(devices) <= 2 or len(set(devices)) != len(devices)
                    or any(type(device) is not int or not 0 < device < 2**64 for device in devices)):
                raise ValueError("Invalid Yoosee channels")
            asyncio.run(serve(Path(sys.argv[1]), devices, socket_path))
        else:
            operation, device_id = parse_request(sys.stdin.buffer.readline(8192))
            if operation == "recordings":
                print("[]")
            else:
                subscribe(device_id, socket_path)
    except Exception as error:
        print(f"Yoosee source failed: {type(error).__name__}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
