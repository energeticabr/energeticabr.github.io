"""Run the full deployment script with fake privileged commands, never live services."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(__file__).with_name("deploy.sh").read_text(encoding="utf-8")
with tempfile.TemporaryDirectory(prefix="transport-deploy-rollback-") as temporary:
    root = Path(temporary)
    stage = root / "launch-payroll-transport-fixture"
    stage.mkdir()
    source = source.replace("/home/opc/launch-payroll-transport-*", str(root) + "/launch-payroll-transport-*")
    source = source.replace("/home/opc/.energetica-deploy.lock", str(root / "lock"))
    script = root / "deploy.sh"
    script.write_text(source, encoding="utf-8")
    baseline = {"workflow.py": "c4fd1a32cce1da04f2c03f838f7a2d053a6a966f672ba9e5b15058e8435b82c2"}
    candidate = {"workflow.py": "c064da3e06afece45e8ea16b4d1aa05d7ed506b5572b7208dc9be9987c7daf54"}
    live_roots = ("/opt/energetica-whatsapp", "/home/opc/energetica-build")
    initial = {folder + "/worker/" + name: digest for folder in live_roots for name, digest in baseline.items()}
    database = root / "commands.json"
    database.write_text(json.dumps({"files": initial, "calls": [], "installed": False, "injected": False}), encoding="utf-8")
    binary = root / "bin"
    binary.mkdir()
    # Only privileged commands are simulated. All file writes stay in this temp directory.
    fake = binary / "sudo"
    fake.write_text("#!" + sys.executable + "\n" + '''import json, os, sys
from pathlib import Path
path = Path(os.environ["DEPLOY_TEST_DATABASE"])
db = json.loads(path.read_text())
args = sys.argv[1:]
if args[0] == "-n": args.pop(0)
db["calls"].append(args)
baseline = json.loads(os.environ["DEPLOY_TEST_BASELINE"])
candidate = json.loads(os.environ["DEPLOY_TEST_CANDIDATE"])
if args[0] == "sha256sum":
    target = args[1]
    digest = db["files"].get(target, candidate.get(Path(target).name))
    if target in db["files"] and db["installed"] and not db["injected"]:
        digest = "0" * 64
        db["injected"] = True
    print(digest + "  " + target)
elif args[0] == "cp" and args[-1].endswith("/worker/workflow.py"):
    for item in args[1:-1]:
        name = Path(item).name
        if name not in candidate: continue
        restored = "/backup/" in item
        db["files"][args[-1]] = (baseline if restored else candidate)[name]
        if not restored: db["installed"] = True
path.write_text(json.dumps(db))
''', encoding="utf-8")
    fake.chmod(0o755)
    env = {**os.environ, "PATH": str(binary) + os.pathsep + os.environ["PATH"],
           "DEPLOY_TEST_DATABASE": str(database), "DEPLOY_TEST_BASELINE": json.dumps(baseline),
           "DEPLOY_TEST_CANDIDATE": json.dumps(candidate)}
    result = subprocess.run(["bash", str(script), str(stage), "apply"], env=env, capture_output=True, text=True)
    final = json.loads(database.read_text())
    assert result.returncode != 0, "Forced mismatch must fail deployment"
    assert final["installed"] and final["injected"], "Must fail after installation, not in validation"
    assert final["files"] == initial, "Rollback did not restore both deployed copies"
    assert "ROLLED_BACK" in result.stderr, result.stderr
    assert any(call[:2] == ["systemctl", "restart"] for call in final["calls"]), "Services not restarted after rollback"
    print("POST_INSTALL_HASH_MISMATCH_ROLLBACK_VERIFIED")
