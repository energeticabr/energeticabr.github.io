"""Run the full deployment script with fake privileged commands, never live services."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

source = Path(__file__).with_name("deploy.sh").read_text(encoding="utf-8")
with tempfile.TemporaryDirectory(prefix="single-deploy-rollback-") as temporary:
    root = Path(temporary)
    stage = root / "single-launch-confirmation-fixture"
    stage.mkdir()
    source = source.replace("/home/opc/single-launch-confirmation-*", str(root) + "/single-launch-confirmation-*")
    source = source.replace("/home/opc/.energetica-deploy.lock", str(root / "lock"))
    script = root / "deploy.sh"
    script.write_text(source, encoding="utf-8")
    baseline = {"launch_preview.py": "4c160f51201cecce19169144aa59e47fec577880002c26ac0b7da9c659ae9dfa",
                "launch_line_controls.py": "2213da9b9c0ad571bc1c301fa8c77c470cf66a28d0c8000e8a75258ce351bfbf"}
    candidate = {"launch_preview.py": "bd5d57b4a0578d1d207d5515831b4cd5af05383ba8b5b3dfe8c0b58129942268",
                 "launch_line_controls.py": "699dfe299d219241ba59c3abc03c81008c089dc31ff0368281ca8f2cf7139993"}
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
elif args[0] == "cp" and args[-1].endswith("/worker/"):
    for item in args[1:-1]:
        name = Path(item).name
        if name not in candidate: continue
        restored = "/backup/" in item
        db["files"][args[-1] + name] = (baseline if restored else candidate)[name]
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
    assert final["files"] == initial, "Rollback did not restore both modules"
    assert "ROLLED_BACK" in result.stderr, result.stderr
    assert any(call[:2] == ["systemctl", "restart"] for call in final["calls"]), "Services not restarted after rollback"
    print("POST_INSTALL_HASH_MISMATCH_ROLLBACK_VERIFIED")
