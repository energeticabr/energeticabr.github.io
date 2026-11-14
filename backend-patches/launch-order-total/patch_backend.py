"""Apply the reviewed diff to either pinned backend source without rebasing it."""
from pathlib import Path
import re
import sys

RELATIVE = 'worker/launch_gallery.py'


def change(relative, before, patch=None):
    if relative != RELATIVE:
        raise ValueError('Unexpected source path')
    if patch is None:
        patch = (Path(sys.argv[0]).resolve().parent / 'source.patch').read_bytes()
    lf = before.replace(b'\r\n', b'\n')
    if b'\r' in lf or (b'\r\n' in before and lf.replace(b'\n', b'\r\n') != before):
        raise ValueError('Mixed source line endings')
    header, *hunks = re.split(rb'^@@ ', patch, flags=re.M)
    if header != b'--- a/worker/launch_gallery.py\n+++ b/worker/launch_gallery.py\n' or not hunks:
        raise ValueError('Unexpected patch scope')
    updated = lf
    for hunk in hunks:
        bounds, _, contents = hunk.partition(b'\n')
        counts = re.fullmatch(rb'-\d+,(\d+) \+\d+,(\d+) @@', bounds)
        if not counts:
            raise ValueError('Unexpected hunk header')
        old, new = [], []
        for line in contents.splitlines(keepends=True):
            # An empty context line is stored without the trailing marker space.
            marker, data = (b' ', b'\n') if line == b'\n' else (line[:1], line[1:])
            if marker not in {b' ', b'+', b'-'}:
                raise ValueError('Unexpected hunk line')
            if marker != b'+':
                old.append(data)
            if marker != b'-':
                new.append(data)
        anchor = b''.join(old)
        if (len(old), len(new)) != tuple(map(int, counts.groups())) or updated.count(anchor) != 1:
            raise ValueError('Hunk does not match exactly one source anchor')
        updated = updated.replace(anchor, b''.join(new), 1)
    return updated.replace(b'\n', b'\r\n') if b'\r\n' in before else updated


if __name__ == '__main__':
    source, output = map(Path, sys.argv[1:])
    output.write_bytes(change(RELATIVE, source.read_bytes()))
