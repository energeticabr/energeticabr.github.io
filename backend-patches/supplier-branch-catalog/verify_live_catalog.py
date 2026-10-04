"""Read-only check using the official FILIAIS catalog and installed selector."""
import os
from pathlib import Path
import sys
import json

root = Path("/opt/energetica-whatsapp")
sys.path.insert(0, str(root))
sys.path.insert(0, str(root / "worker"))
from local_app import load_env
from clients import SharePointClient
from workflow import WorkflowEngine

load_env(Path("/etc/energetica-whatsapp.env"))
client = SharePointClient(os.environ["SHAREPOINT_HOST"], os.environ["SHAREPOINT_SITE_PATH"],
    os.environ["ENTRA_TENANT_ID"], os.environ["ENTRA_CLIENT_ID"],
    private_key_pem=Path(os.environ["ENTRA_PRIVATE_KEY_FILE"]).read_text(),
    certificate_pem=Path(os.environ["ENTRA_CERTIFICATE_FILE"]).read_text(), target_list="FILIAIS")
step = {"key": "filial_lancamento", "source": {
    "type": "sharepoint_list", "list": "FILIAIS", "id_field": "Id",
    "label_field": "FILIAL", "value_field": "FILIAL", "distinct": True, "top": 5000}}
options = client.get_options(step, {})
assert options
assert "004 - DIVINÓPOLIS" not in [o["value"] for o in options]
engine = WorkflowEngine.__new__(WorkflowEngine)
state = {"selections": {"fornecedor_lancamento": {"id": 170, "source_values": {"FILIAL": "004 - DIVINÓPOLIS"}}}}
result = engine._apply_launch_supplier_branch_override(state, options)
assert [o["value"] for o in result] == [o["value"] for o in options]
assert not any(o.get("recommended") for o in result)
print(json.dumps({"status": "LIVE_CATALOG_VERIFIED", "branches": [o["value"] for o in result]}, ensure_ascii=False))
