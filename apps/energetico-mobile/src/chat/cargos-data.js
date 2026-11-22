import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { buildCargosTable, cargoKey } from './cargos-model.js';

export function createCargosData({tokenProvider,repository:supplied,fetchImpl=globalThis.fetch,siteConfig=SHAREPOINT_SITES,now=()=>new Date()}={}) {
  if(!supplied&&typeof tokenProvider!=='function')throw new TypeError('A tabela de cargos requer a sessão Microsoft ativa.');
  const repository=supplied||createSharePointRepository(createGraphClient(tokenProvider,{fetch:fetchImpl}),siteConfig);
  const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Consulta cancelada.','AbortError');};
  async function resolveList(name, signal) {
    check(signal);const options=signal?{signal}:{};
    const list=await repository.resolveList('personal',[name],options);check(signal);
    if(list?.status!=='resolved'||!list.id)throw new Error(`A lista ${name} não está disponível nesta conta.`);
    return list.id;
  }
  async function readItems(listId, name, fields, signal) {
    check(signal);
    const query=new URLSearchParams({$expand:fields,$top:'100'}).toString();
    const items=[],seen=new Set();let cursor='';
    for(let pageNumber=1;pageNumber<=100;pageNumber++){
      const page=await repository.getItemsPage('personal',listId,query,{...(signal?{signal}:{}),pageNumber,maxPages:100,...(cursor?{cursor}:{})});check(signal);
      if(!Array.isArray(page?.items)||typeof page.hasMore!=='boolean')throw new Error(`A paginação de ${name} retornou dados incompletos.`);
      items.push(...page.items);
      if(!page.hasMore)return items;
      if(typeof page.nextLink!=='string'||!page.nextLink||seen.has(page.nextLink))throw new Error(`A paginação de ${name} está incompleta ou repetida.`);
      seen.add(page.nextLink);cursor=page.nextLink;
    }
    throw new Error(`A paginação de ${name} excedeu o limite.`);
  }

  async function loadSnapshot({signal}={}) {
    const listId=await resolveList('CARGOS',signal);
    const columns=await repository.getColumns('personal',listId,signal?{signal}:{});
    const items=await readItems(listId,'CARGOS','fields',signal);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
    return {rows:buildCargosTable(items,columns,today)};
  }

  async function loadAssignments({signal}={}) {
    const name='FUNCIONARIOSRH';
    const listId=await resolveList(name,signal);
    const items=await readItems(listId,name,'fields($select=Title,CARGO,FILIAL,STATUS)',signal);
    const assignments=new Map(), ids=new Set();
    for(const {id,fields} of items){
      if(!id||ids.has(String(id))||!fields)throw new Error('A consulta de vínculos de RH retornou registros incompletos ou repetidos.');
      ids.add(String(id));
      const cargo=cargoKey(fields.CARGO);
      if(!cargo)continue;
      if(!assignments.has(cargo))assignments.set(cargo,[]);
      assignments.get(cargo).push({
        name:fields.Title?.trim()||`Cadastro RH #${id}`,
        branch:fields.FILIAL?.trim()||'',
        status:fields.STATUS?.trim()||'',
      });
    }
    for(const people of assignments.values())people.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    return assignments;
  }

  return Object.freeze({loadSnapshot,loadAssignments});
}
