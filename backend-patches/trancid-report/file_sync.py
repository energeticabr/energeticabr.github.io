"""Publica arquivos privados, sem ampliar as permissões do serviço SharePoint."""
import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit
from monitor import DB
from sharepoint_sync import client_from_environment

def clean(rows): return [{k:v for k,v in row.items() if k!='sharepoint_id'} for row in rows]

def publish_database(monitor):
    from pdf_report import build_pdf
    output=monitor.path.parent/'published'; output.mkdir(parents=True,exist_ok=True)
    # SELECT sozinho não inicia transação no sqlite3 do Python. A mesma
    # transação mantém posições e consultas na mesma revisão da base.
    monitor.db.execute('SAVEPOINT trancid_report_snapshot')
    try:
        positions=clean(monitor.positions()); runs=clean(monitor.runs())
    finally:
        monitor.db.execute('RELEASE SAVEPOINT trancid_report_snapshot')
    snapshot={'schema_version':1,'currency':'BRL','money_unit':'centavos','positions':positions,'runs':runs}
    snapshot_path=output/'.report_snapshot.json.tmp'
    try:
        snapshot_path.write_text(json.dumps(snapshot,ensure_ascii=False,indent=2),encoding='utf-8')
        snapshot_path.chmod(0o600)
        snapshot_path.replace(output/'report_snapshot.json')
    finally:
        snapshot_path.unlink(missing_ok=True)
    for filename,rows in [('posicoes.json',positions),('consultas.json',runs)]:
        (output/filename).write_text(json.dumps({'schema_version':1,'currency':'BRL','money_unit':'centavos','rows':rows},ensure_ascii=False,indent=2),encoding='utf-8')
    build_pdf(monitor,output/'Relatorio_cartoes_Trancid.pdf')
    backup=sqlite3.connect(output/'trancid.sqlite3')
    try: monitor.db.backup(backup)
    finally: backup.close()
    for f in output.iterdir(): f.chmod(0o600)
    client=client_from_environment()
    drive=client._request('GET','v2.0/drive')
    folder=urlsplit(drive['webUrl']).path.rstrip('/')+'/TRANCID'
    base="web/GetFolderByServerRelativeUrl('"+folder.replace("'","''")+"')"
    try: client._request('GET',base)
    except Exception as exc:
        if getattr(getattr(exc,'response',None),'status_code',None)!=404: raise
        client._request('POST','web/folders',json={'__metadata':{'type':'SP.Folder'},'ServerRelativeUrl':folder},headers={'Content-Type':'application/json;odata=verbose'})
    published=[]
    # Publicar o relatório por último, após a base e seus dados legíveis.
    for name in ['posicoes.json','consultas.json','trancid.sqlite3','report_snapshot.json','Relatorio_cartoes_Trancid.pdf']:
        content=(output/name).read_bytes()
        client._request('POST',base+f"/Files/add(url='{name}',overwrite=true)",data=content,headers={'Content-Type':'application/octet-stream'})
        readback=client._request('GET',"web/GetFileByServerRelativeUrl('"+folder+'/'+name+"')/$value",_return_response=True).content
        if hashlib.sha256(content).digest()!=hashlib.sha256(readback).digest(): raise ValueError('Conteúdo publicado diverge: '+name)
        published.append({'file':name,'url':'https://'+client.host+folder+'/'+name,'sha256':hashlib.sha256(content).hexdigest()})
    return {'files':published,'positions':len(positions),'runs':len(runs)}
