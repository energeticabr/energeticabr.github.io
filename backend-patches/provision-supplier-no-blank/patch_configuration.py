"""Exact, one-property configuration change in staged deployment candidates."""
import copy
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
assert root.name in {'app', 'build'} and root.parent.name.startswith('provision-supplier-no-blank-')
path = root / 'worker/workflow_config.json'
before = path.read_bytes()
assert hashlib.sha256(before).hexdigest() == '008558f341ec19930858be622ee11ff4f1ef554e34e4e86694a0298652dddf4d'
old = b'"key": "fornecedor_pagamento",\n          "kind": "selection",\n          "target_field": "FORNECEDOR",\n          "prompt": "QUAL \xc3\x89 O FORNECEDOR?",\n          "button_label": "ESCOLHER FORNECEDOR",\n          "allow_blank": true,'
# The verified deployed configuration uses CRLF; preserve its exact bytes.
old = old.replace(b'\n', b'\r\n')
assert before.count(old) == 1
after = before.replace(old, old.replace(b'"allow_blank": true', b'"allow_blank": false'), 1)
expected = copy.deepcopy(json.loads(before))
step = next(row for row in expected['sharepoint']['payment_flow']['steps'] if row['key'] == 'fornecedor_pagamento')
step['allow_blank'] = False
assert json.loads(after) == expected, 'Unrelated configuration change'
assert hashlib.sha256(after).hexdigest() == '5036ce110dcdaa4d3a5a382f804509ad297eae49843ad849cc87a0b2b2ef05f7'
path.write_bytes(after)
print('One verified supplier property changed in staged candidate')
