"""Apply unique, exact context replacements to a staged copy, never live files."""
from pathlib import Path
import sys

root, patch = map(Path, sys.argv[1:3])
root = root.resolve()
assert root.name in {"app", "build"} and root.parent.name.startswith("supplier-branch-catalog-")
lines = patch.read_text(encoding="utf-8").splitlines(keepends=True)
targets = {}
target = None
i = 0
while i < len(lines):
    line = lines[i]
    if line.startswith("+++ b/"):
        name = line[6:].strip()
        assert name in {"worker/clients.py", "worker/workflow.py"}, name
        target = root / name
        targets.setdefault(target, target.read_text(encoding="utf-8"))
    elif line.startswith("@@ "):
        assert target is not None
        old, new = [], []
        i += 1
        while i < len(lines) and not lines[i].startswith(("@@ ", "--- a/")):
            chunk = lines[i]
            assert chunk[0] in {" ", "+", "-"}
            if chunk[0] in {" ", "-"}: old.append(chunk[1:])
            if chunk[0] in {" ", "+"}: new.append(chunk[1:])
            i += 1
        old, new = "".join(old), "".join(new)
        assert old and targets[target].count(old) == 1, str(target)
        targets[target] = targets[target].replace(old, new, 1)
        continue
    i += 1
assert len(targets) == 2
for target, text in targets.items():
    with target.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
print("Exact patch applied to staged candidates")
