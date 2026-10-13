"""Three exact, compile-checked replacements for selected attachment rejects."""
from __future__ import annotations

import argparse
import os
from pathlib import Path


REPLACEMENTS = (
    (
        "\n\nclass ChannelBridge:\n",
        "\n\nclass AttachmentUnavailableError(ValueError):\n"
        "    def __init__(self, message, unavailable_attachment_ids):\n"
        "        super().__init__(message)\n"
        "        self.unavailable_attachment_ids = list(unavailable_attachment_ids)\n"
        "\n\nclass ChannelBridge:\n",
    ),
    (
        '            if any(value not in available for value in ids):\n'
        '                raise ValueError("Um anexo selecionado não está mais disponível ou já foi submetido.")\n'
        '            media_root = Path(self.engine.media_repository.directory).resolve()\n'
        '            for value in ids:\n'
        '                path = (media_root / str(available[value]["object_name"])).resolve()\n'
        '                if not path.is_relative_to(media_root / key[:12]) or not path.is_file():\n'
        '                    raise ValueError("Um anexo selecionado não está mais disponível.")\n',
        '            unavailable = []\n'
        '            missing_reference = any(value not in available for value in ids)\n'
        '            media_root = None\n'
        '            for value in ids:\n'
        '                if value not in available:\n'
        '                    unavailable.append(value)\n'
        '                    continue\n'
        '                if media_root is None:\n'
        '                    media_root = Path(self.engine.media_repository.directory).resolve()\n'
        '                path = (media_root / str(available[value]["object_name"])).resolve()\n'
        '                if not path.is_relative_to(media_root / key[:12]) or not path.is_file():\n'
        '                    unavailable.append(value)\n'
        '            if unavailable:\n'
        '                message = ("Um anexo selecionado não está mais disponível ou já foi submetido."\n'
        '                           if missing_reference else "Um anexo selecionado não está mais disponível.")\n'
        '                raise AttachmentUnavailableError(message, unavailable)\n',
    ),
    (
        '            except (OSError, RuntimeError, ValueError) as exc:\n'
        '                log("portal_channel_failed", error=str(exc))\n'
        '                return self._send_json(422, {"error": str(exc)}, cors_origin=origin)\n',
        '            except (OSError, RuntimeError, ValueError) as exc:\n'
        '                log("portal_channel_failed", error=str(exc))\n'
        '                error = {"error": str(exc)}\n'
        '                if isinstance(exc, AttachmentUnavailableError):\n'
        '                    error["code"] = "ATTACHMENT_UNAVAILABLE"\n'
        '                    error["unavailableAttachmentIds"] = exc.unavailable_attachment_ids\n'
        '                return self._send_json(422, error, cors_origin=origin)\n',
    ),
)


def patch_bridge(source):
    for old, _ in REPLACEMENTS:
        if source.count(old) != 1:
            raise ValueError("Backend source changed; refusing ambiguous patch.")
    for old, new in REPLACEMENTS:
        source = source.replace(old, new, 1)
    compile(source, "channel_bridge.py", "exec")
    return source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    if args.source.resolve() == args.target.resolve() or (
        args.target.exists() and os.path.samefile(args.source, args.target)
    ):
        raise ValueError("Bridge source is read-only; choose a separate candidate path.")
    candidate = patch_bridge(args.source.read_bytes().decode("utf-8")).encode("utf-8")
    with args.target.open("xb") as destination:
        destination.write(candidate)


if __name__ == "__main__":
    main()
