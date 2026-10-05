import { SHAREPOINT_SITES } from '../../../../portal/config.js';
import { createGraphClient } from '../../../../portal/data/graph-client.js';
import { createSharePointRepository } from '../../../../portal/data/sharepoint-repository.js';
import { buildCargosTable } from './cargos-model.js';

export function createCargosData({tokenProvider,repository:supplied,fetchImpl=globalThis.fetch,siteConfig=SHAREPOINT_SITES,now=()=>new Date()}={}) {
  if(!supplied&&typeof tokenProvider!=='function')throw new TypeError('A tabela de cargos requer a sessão Microsoft ativa.');
  const repository=supplied||createSharePointRepository(createGraphClient(tokenProvider,{fetch:fetchImpl}),siteConfig);
  const check=signal=>{if(signal?.aborted)throw signal.reason||new DOMException('Consulta cancelada.','AbortError');};
  return Object.freeze({async loadSnapshot({signal}={}) {
    check(signal);const options=signal?{signal}:{};
    const list=await repository.resolveList('personal',['CARGOS'],options);check(signal);
    if(list?.status!=='resolved'||!list.id)throw new Error('A lista CARGOS não está disponível nesta conta.');
    const columns=await repository.getColumns('personal',list.id,options);check(signal);
    const items=[],seen=new Set();let cursor='';
    for(let pageNumber=1;pageNumber<=100;pageNumber++){
      const page=await repository.getItemsPage('personal',list.id,new URLSearchParams({$expand:'fields',$top:'100'}).toString(),{...options,pageNumber,maxPages:100,...(cursor?{cursor}:{})});check(signal);
      if(!Array.isArray(page?.items)||typeof page.hasMore!=='boolean')throw new Error('A paginação de CARGOS retornou dados incompletos.');
      items.push(...page.items);
      if(!page.hasMore){
        const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now());
        return {rows:buildCargosTable(items,columns,today)};
      }
      if(typeof page.nextLink!=='string'||!page.nextLink||seen.has(page.nextLink))throw new Error('A paginação de CARGOS está incompleta ou repetida.');
      seen.add(page.nextLink);cursor=page.nextLink;
    }
    throw new Error('A paginação de CARGOS excedeu o limite; a tabela não será exibida parcialmente.');
  }});
}
