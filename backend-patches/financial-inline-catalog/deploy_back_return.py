"""Publish the narrowly scoped return fix over the verified inline-catalog release."""
import json
from pathlib import Path
import sys
import deploy

deploy.STAGE = Path('/home/opc/financial-back-return-20261013')
deploy.FILES = {
    'worker/workflow.py': 'ecb883c76fe8e8805e4167ae8e0f99713fdc5ca283c46213e9fe0012e5c29bf0',
    'worker/financial_catalog_registration.py': 'c0df0401f95833c9a4d73f09b014a6e0592c4073c9967c8fab664f0dcfbd64eb',
}

if __name__ == '__main__':
    assert len(sys.argv) == 3 and sys.argv[1] in {'--check', '--deploy'}
    print(json.dumps(deploy.deploy(check=sys.argv[1] == '--check'), ensure_ascii=False))
