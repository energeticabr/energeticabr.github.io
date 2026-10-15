"""Read-only comparison of the signing product catalog and SharePoint rows.

Run on the VM. Emits aggregate counts only, never credentials or row values.
"""

import json
import os
from collections import Counter
from pathlib import Path
import sys

sys.path.insert(0, str(Path(os.environ.get("PRODUCT_CATALOG_SOURCE", "/opt/energetica-whatsapp")) / "worker"))
sys.path.insert(1, "/opt/energetica-whatsapp/worker")

for raw in Path("/etc/energetica-whatsapp.env").read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if line and not line.startswith("#") and "=" in line:
        name, value = line.split("=", 1)
        os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))

from clients import SharePointClient  # noqa: E402
from workflow import WorkflowEngine  # noqa: E402

client = SharePointClient(
    os.environ["SHAREPOINT_HOST"], os.environ["SHAREPOINT_SITE_PATH"],
    os.environ["ENTRA_TENANT_ID"], os.environ["ENTRA_CLIENT_ID"],
    Path(os.environ["ENTRA_PRIVATE_KEY_FILE"]).read_text(encoding="utf-8"),
    Path(os.environ["ENTRA_CERTIFICATE_FILE"]).read_text(encoding="utf-8"),
    "CADASTROPRODUTO",
)
request = client._request


def read_only(method, endpoint, **kwargs):
    if method != "GET":
        raise RuntimeError("SharePoint writes are forbidden in this diagnostic")
    return request(method, endpoint, **kwargs)


client._request = read_only
fields = {name: client._internal_field("CADASTROPRODUTO", name)
          for name in ("Id", "PRODUTO", "SATUS")}
endpoint = client._list_endpoint("CADASTROPRODUTO") + "/items"
params = {"$select": ",".join(fields.values()), "$top": "5000", "$orderby": f"{fields['Id']} desc"}
rows = []
while endpoint:
    payload = client._request("GET", endpoint, params=params)
    rows.extend(client._values(payload))
    endpoint = payload.get("@odata.nextLink") or payload.get("odata.nextLink") or ""
    params = None

step = WorkflowEngine._document_signing_payment_product_step()
options = client.get_options(step, context={})
status_counts = Counter(str(row.get(fields["SATUS"]) or "<empty>") for row in rows)
matching = [row for row in rows if "ser" in str(row.get(fields["PRODUTO"]) or "").casefold()]
ids = [int(option["id"]) for option in options]
print(json.dumps({
    "allRows": len(rows), "statusCounts": status_counts,
    "optionCount": len(options), "optionIdsDescending": ids == sorted(ids, reverse=True),
    "firstOptionId": ids[0] if ids else None,
    "lastOptionId": ids[-1] if ids else None,
    "nameContainsSer": len(matching),
    "nameContainsSerByStatus": Counter(str(row.get(fields["SATUS"]) or "<empty>") for row in matching),
}, ensure_ascii=False))
