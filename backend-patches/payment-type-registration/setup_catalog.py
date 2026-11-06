"""Create only the dedicated payment-type catalog and idempotently seed it."""
import json
from pathlib import Path
import sys
from xml.etree import ElementTree as ET

LIST='CADASTROTIPOPAGAMENTO'
DEFAULTS=('SALÁRIO','VALE REFEIÇÃO','VALE TRANSPORTE','AJUDA DE CUSTO','13 SALÁRIO','FÉRIAS E/OU ENCARGOS','PREMIAÇÃO')


def rows(client, endpoint, params):
    result, visited = [], set()
    while endpoint:
        if endpoint in visited: raise RuntimeError('Repeated SharePoint page')
        visited.add(endpoint)
        payload=client._request('GET',endpoint,params=params)
        result.extend(client._values(payload))
        endpoint=payload.get('odata.nextLink') or payload.get('@odata.nextLink') or payload.get('d',{}).get('__next')
        params=None
    return result


def setup(client):
    from logic import normalize_text
    lists=rows(client,'web/lists',{'$select':'Id,Title,BaseTemplate','$top':5000})
    matches=[r for r in lists if r['Title']==LIST]
    if len(matches)>1: raise RuntimeError('Ambiguous catalog')
    created=False
    if not matches:
        client._request('POST','web/lists',json={'Title':LIST,'Description':'Tipos de pagamento da folha, cadastrados no aplicativo Energético.',
            'BaseTemplate':100,'EnableAttachments':False,'EnableVersioning':True})
        created=True
    endpoint=client._list_endpoint(LIST)
    metadata=client._request('GET',endpoint,params={'$select':'Id,Title,BaseTemplate'})
    if metadata.get('Title')!=LIST or metadata.get('BaseTemplate')!=100: raise RuntimeError('Catalog mismatch')
    fields=rows(client,endpoint+'/fields',{'$select':'InternalName,TypeAsString,Indexed,EnforceUniqueValues,Required'})
    existing={r['InternalName']:r for r in fields}
    for name in ['TIPOPGTO','CHAVE']:
        if name not in existing:
            attrs={'Type':'Text','Name':name,'StaticName':name,'DisplayName':name,'Required':'TRUE','MaxLength':'255'}
            if name=='CHAVE': attrs.update(Indexed='TRUE',EnforceUniqueValues='TRUE')
            client._request('POST',endpoint+'/fields/createfieldasxml',json={'parameters':{'SchemaXml':ET.tostring(ET.Element('Field',attrs),encoding='unicode'),'Options':0}})
    fields=rows(client,endpoint+'/fields',{'$select':'InternalName,TypeAsString,Indexed,EnforceUniqueValues,Required'})
    actual={r['InternalName']:r for r in fields}
    for name in ['TIPOPGTO','CHAVE']:
        f=actual[name]
        if f.get('TypeAsString')!='Text' or f.get('Required') is not True: raise RuntimeError('Incompatible catalog field '+name)
    if not (actual['CHAVE'].get('Indexed') is True and actual['CHAVE'].get('EnforceUniqueValues') is True):
        raise RuntimeError('CHAVE must enforce uniqueness before seeding')
    # Make both custom fields visible on the Microsoft Lists default view.
    visible=client._request('GET',endpoint+'/DefaultView/ViewFields')
    visible_fields=visible.get('Items') or visible.get('d',{}).get('Items',{}).get('results',[])
    for name in ['TIPOPGTO','CHAVE']:
        if name not in visible_fields:
            client._request('POST',endpoint+f"/DefaultView/ViewFields/addviewfield('{name}')")
    history=rows(client,client._list_endpoint('FOLHAPGTO')+'/items',{'$select':'Id,TIPOPGTO','$top':5000})
    names=list(DEFAULTS)+[str(r.get('TIPOPGTO') or '').strip() for r in history]
    seen=set(); seeded=[]
    for name in names:
        key=normalize_text(name)
        if not key or key in seen: continue
        if len(name)>255 or len(key)>255: raise RuntimeError('Historical type exceeds catalog capacity')
        seen.add(key)
        identifier=client.ensure_item(key,{'Title':name,'TIPOPGTO':name},target_list=LIST,idempotency_field='CHAVE',merge_existing=False)
        checked=client.verify_item(identifier,{'TIPOPGTO':name},[],target_list=LIST)
        if not (isinstance(checked,dict) and checked.get('fields') is True): raise RuntimeError('Seed verification failed')
        seeded.append({'id':identifier,'name':name})
    readback=rows(client,endpoint+'/items',{'$select':'Id,Title,TIPOPGTO,CHAVE','$top':5000})
    if not seen.issubset({r.get('CHAVE') for r in readback}): raise RuntimeError('Incomplete catalog')
    return {'list':LIST,'list_id':metadata['Id'],'site':client.site_url,'created':created,'seeded':seeded,'catalog_count':len(readback),'unique_key':True}


if __name__=='__main__':
    sys.path.insert(0,'/opt/energetica-whatsapp')
    import local_app
    local_app.load_env(Path('/etc/energetica-whatsapp.env'))
    print(json.dumps(setup(local_app.build_engine().sharepoint),ensure_ascii=False,indent=2))
