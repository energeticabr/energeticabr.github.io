import json
import unittest
from pathlib import Path

class BridgeDefinitionTests(unittest.TestCase):
    def test_reverse_branch_is_constrained_and_old_modes_async(self):
        d=json.loads(Path('fiscal-bridge-definition.json').read_text(encoding='utf-8-sig'))
        self.assertIn('dda_sync',d['triggers']['manual']['inputs']['schema']['properties']['mode']['enum'])
        branch=d['actions']['Operacao']['else']['actions']['Obter_PDF']
        self.assertIn("'dda-'",branch['actions']['PDFs']['inputs']['where'])
        reverse=branch['else']['actions']['Sincronizar_DDA']
        self.assertIn("'DDA-'",reverse['expression'])
        self.assertIn('expectedKey',json.dumps(reverse))
        def walk(v):
            if isinstance(v,dict):
                if v.get('type')=='Response': self.assertEqual(v.get('operationOptions'),'Asynchronous')
                if v.get('type')=='OpenApiConnection':
                    p=v['inputs']['parameters']
                    self.assertEqual(p['dataset'],'https://energeticaltda.sharepoint.com/sites/energetica')
                    if v['inputs']['host']['operationId']=='HttpRequest': self.assertEqual(p['parameters/method'],'GET')
                    else: self.assertIn(v['inputs']['host']['operationId'],('GetItemAttachments','GetAttachmentContent','CreateAttachment'))
                for x in v.values():walk(x)
            elif isinstance(v,list):
                for x in v:walk(x)
        walk(d)
