"""Schema replay tests with a fake REST store and the real setup routine."""
import sys,types,unittest
from pathlib import Path
import importlib.util
import xml.etree.ElementTree as ET
import unicodedata
spec=importlib.util.spec_from_file_location('setup_catalog',Path(__file__).with_name('setup_catalog.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def normalized(s):
 return ''.join(c for c in unicodedata.normalize('NFKD',s.lower()) if not unicodedata.combining(c))

class Rest:
 site_url='https://synthetic.example.test/site'
 def __init__(self):
  self.exists=False;self.fields=[];self.items={};self.writes=[];self.views=[]
 def _values(self,p):return p.get('value',[])
 def _list_endpoint(self,name):return "web/lists/GetByTitle('"+name+"')"
 def _request(self,method,path,params=None,json=None):
  if method=='GET':
   if path=='web/lists':return {'value':[{'Id':'synthetic','Title':module.LIST,'BaseTemplate':100}] if self.exists else []}
   if path.endswith('/fields'):return {'value':self.fields}
   if path.endswith('/DefaultView/ViewFields'):return {'Items':self.views}
   if "'FOLHAPGTO'" in path:return {'value':[{'Id':3,'TIPOPGTO':'FGTS'},{'Id':4,'TIPOPGTO':'INSS'}]}
   if path.endswith('/items'):return {'value':list(self.items.values())}
   return {'Id':'synthetic','Title':module.LIST,'BaseTemplate':100}
  if path=='web/lists':
   self.exists=True;self.writes.append(('list',json));return {}
  if path.endswith('/fields/createfieldasxml'):
   attrs=ET.fromstring(json['parameters']['SchemaXml']).attrib
   self.fields.append({'InternalName':attrs['Name'],'TypeAsString':'Text','Required':True,'Indexed':attrs.get('Indexed')=='TRUE','EnforceUniqueValues':attrs.get('EnforceUniqueValues')=='TRUE'})
   self.writes.append(('field',attrs['Name']));return {}
  if '/DefaultView/ViewFields/addviewfield(' in path:
   self.views.append(path.split("('")[-1].split("')")[0]);return {}
  raise AssertionError((method,path))
 def ensure_item(self,key,fields,target_list,idempotency_field,merge_existing):
  assert target_list==module.LIST and idempotency_field=='CHAVE' and not merge_existing
  if key not in self.items:
   self.items[key]={'Id':len(self.items)+1,**fields,'CHAVE':key};self.writes.append(('item',key))
  return self.items[key]['Id']
 def verify_item(self,identifier,fields,names,target_list):
  row=next(r for r in self.items.values() if r['Id']==identifier)
  assert all(row[k]==v for k,v in fields.items())
  return {'fields':True,'attachments':True}

class SchemaTests(unittest.TestCase):
 def setUp(self):
  self.old=sys.modules.get('logic');sys.modules['logic']=types.SimpleNamespace(normalize_text=normalized)
 def tearDown(self):
  if self.old is None:sys.modules.pop('logic',None)
  else:sys.modules['logic']=self.old
 def test_first_run_and_replay_only_create_nine_types(self):
  s=Rest();first=module.setup(s);before=list(s.writes);second=module.setup(s)
  self.assertEqual(first['catalog_count'],9);self.assertTrue(first['created'])
  self.assertFalse(second['created']);self.assertEqual(s.writes,before)
  self.assertEqual({r['TIPOPGTO'] for r in s.items.values()},set(module.DEFAULTS)|{'FGTS','INSS'})
 def test_incompatible_key_stops_before_any_seed(self):
  s=Rest();s.exists=True;s.fields=[{'InternalName':'CHAVE','TypeAsString':'Text','Required':True,'Indexed':True,'EnforceUniqueValues':False}]
  with self.assertRaisesRegex(RuntimeError,'uniqueness'):module.setup(s)
  self.assertFalse(s.items)
 def test_repeated_page_is_rejected(self):
  s=Rest();s._request=lambda *args,**kwargs:{'value':[],'odata.nextLink':'web/lists'}
  with self.assertRaisesRegex(RuntimeError,'Repeated'):module.rows(s,'web/lists',{})

if __name__=='__main__':unittest.main()
