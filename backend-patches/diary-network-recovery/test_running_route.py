"""Optional integration against the pinned deployed bridge candidate."""
import ast,io,json,os,sys,time,unittest
from pathlib import Path
from urllib.parse import urlsplit
sys.path.insert(0,str(Path(__file__).parent.parent/'diary-attachment-progress'))
from diary_progress import ProgressRegistry,emit_progress

@unittest.skipUnless(os.environ.get('DIARY_BRIDGE_SOURCE'),'set DIARY_BRIDGE_SOURCE for deployed-source integration')
class RunningRouteTests(unittest.TestCase):
    def test_pending_route_authenticates_and_never_acquires_the_workflow_lock(self):
        source=Path(os.environ['DIARY_BRIDGE_SOURCE']).read_text(encoding='utf-8')
        method=next(n for n in ast.walk(ast.parse(source)) if isinstance(n,ast.FunctionDef) and n.name=='do_POST')
        registry=ProgressRegistry();owner={'oid':'owner','tid':'tenant'}
        scope={'urlsplit':urlsplit,'time':time,'json':json,'REGISTRY':registry,
               'portal_origin_allowed':lambda *_:True,'log':lambda *_a,**_k:None,
               'AttachmentUnavailableError':type('AttachmentUnavailableError',(Exception,),{})}
        exec(compile(ast.Module(body=[method],type_ignores=[]),'channel_bridge.py','exec'),scope)
        class ForbiddenBridge:
            def __getattr__(self,name): raise AssertionError('workflow touched: '+name)
        class Handler:
            path='/portal/chat';max_body_bytes=10000;portal_origins=set();bridge=ForbiddenBridge()
            identity=owner;authenticated=True
            def _portal_identity(self):
                if not self.authenticated: raise PermissionError('missing token')
                return self.identity
            def _send_json(self,status,payload,**kwargs):return status,payload
            def query(self,body):
                content=json.dumps(body).encode();self.headers={'Content-Length':str(len(content))};self.rfile=io.BytesIO(content)
                return scope['do_POST'](self)
        handler=Handler()
        with registry.scope(owner,'original-request'):
            emit_progress(62,'photos')
            self.assertEqual(handler.query({'action':'diary_evidence_pending'}),(200,{'requestId':'original-request','status':'running','percent':62,'stage':'photos'}))
            handler.identity={'oid':'other','tid':'tenant'}
            self.assertEqual(handler.query({'action':'diary_evidence_pending'}),(200,{'status':'unavailable'}))
            handler.authenticated=False
            self.assertEqual(handler.query({'action':'diary_evidence_pending'})[0],401)
            handler.authenticated=True
            self.assertEqual(handler.query({'action':'diary_evidence_pending','text':'must not execute'})[0],422)

if __name__=='__main__': unittest.main()
