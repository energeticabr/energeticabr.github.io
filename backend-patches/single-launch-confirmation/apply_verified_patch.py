"""Apply unique exact context only to the two staged launch modules."""
from pathlib import Path
import sys

root, patch = map(Path, sys.argv[1:3])
root = root.resolve()
assert root.name in {"app", "build"} and root.parent.name.startswith("single-launch-confirmation-")
lines = patch.read_text(encoding="utf-8").splitlines(keepends=True)
targets = {}
target = None
i = 0
while i < len(lines):
    if lines[i].startswith("--- a/"):
        name = lines[i][6:].strip()
        assert name in {"worker/launch_preview.py", "worker/launch_line_controls.py"}
        assert lines[i + 1] == "+++ b/" + name + "\n"
        target = root / name
        assert target not in targets
        targets[target] = target.read_text(encoding="utf-8")
        i += 2
        continue
    assert target is not None
    assert lines[i].startswith("@@ ")
    old, new = [], []
    i += 1
    while i < len(lines) and not lines[i].startswith(("@@ ", "--- a/")):
        chunk = lines[i]
        assert chunk[0] in {" ", "+", "-"}
        if chunk[0] in {" ", "-"}: old.append(chunk[1:])
        if chunk[0] in {" ", "+"}: new.append(chunk[1:])
        i += 1
    old, new = "".join(old), "".join(new)
    assert old and targets[target].count(old) == 1
    targets[target] = targets[target].replace(old, new, 1)
assert len(targets) == 2
for target, source in targets.items():
    with target.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(source)
print("Scoped exact patch applied")
