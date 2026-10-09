import {SHAREPOINT_SITES} from '../../../../portal/config.js';
import {createGraphClient} from '../../../../portal/data/graph-client.js';
import {createSharePointRepository} from '../../../../portal/data/sharepoint-repository.js';
import {rhidNameKey} from './rhid-monthly-model.js';

const key=value=>rhidNameKey(String(value??'').replace(/_x([0-9a-f]{4})_/gi,(_,code)=>String.fromCodePoint(parseInt(code,16)))).replace(/[^A-Z0-9]/g,'');
const cancelled=()=>new DOMException('Consulta cancelada.','AbortError');
function check(signal){if(signal?.aborted)throw cancelled();}
function wait(operation,signal){
 check(signal);if(!signal)return Promise.resolve().then(operation);
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(cancelled());signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{check(signal);return operation();}).then(value=>{check(signal);resolve(value);},reject).catch(reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
/** Only reads FORNECEDORES. Never borrows payroll write permissions. */
export function createRhidMonthlyData({tokenProvider,repository:suppliedRepository}={}){
 if(!suppliedRepository&&typeof tokenProvider!=='function')throw new TypeError('Uma sessão Microsoft é necessária.');
 const repository=suppliedRepository||createSharePointRepository(createGraphClient(tokenProvider),SHAREPOINT_SITES);
 return Object.freeze({async loadSuppliers({signal}={}){
  const list=await wait(()=>repository.resolveList('personal',['FORNECEDORES'],{signal}),signal);
  if(list?.status!=='resolved'||!list.id)throw new Error('Lista FORNECEDORES indisponível.');
  const columns=await wait(()=>repository.getColumns('personal',list.id,{signal}),signal);
  if(!Array.isArray(columns))throw new TypeError('Colunas de fornecedores incompletas.');
  const fields=['CADASTRO','EMPREITEIRO','STATUS'].map(label=>{
   const matches=columns.filter(c=>c?.computed!==true&&!/^LinkTitle(?:NoMenu|2)?$/i.test(c?.name||'')&&(key(c.name)===label||key(c.displayName)===label));
   if(matches.length!==1||!matches[0].name)throw new TypeError(`Coluna ${label} ausente ou ambígua em FORNECEDORES.`);
   return matches[0].name;
  });
  const rows=[],ids=new Set(),names=new Set(),cursors=new Set();let cursor='';
  for(let pageNumber=1;pageNumber<=10000;pageNumber++){
   const page=await wait(()=>repository.getItemsPage('personal',list.id,new URLSearchParams({$expand:'fields',$top:'100'}).toString(),{signal,pageNumber:(pageNumber-1)%100+1,maxPages:100,...(cursor?{cursor}:{})}),signal);
   if(!Array.isArray(page?.items)||typeof page.hasMore!=='boolean'||page.partial||page.error||page.truncated||page.aborted||page.nextLink!=null&&typeof page.nextLink!=='string')throw new TypeError('Paginação de fornecedores inválida ou incompleta.');
   const next=page.nextLink?.trim()||'';
   if(page.hasMore!==Boolean(next)||page.hasMore&&!page.items.length)throw new TypeError('Paginação de fornecedores incompleta.');
   for(const item of page.items){
    const id=String(item?.id??'');
    if(!/^[1-9]\d*$/.test(id)||!item.fields||typeof item.fields!=='object'||ids.has(id))throw new TypeError('Paginação de fornecedores inválida.');
    ids.add(id);
    if(rhidNameKey(item.fields[fields[1]])!=='SIM'||rhidNameKey(item.fields[fields[2]])!=='ATIVO')continue;
    const name=String(item.fields[fields[0]]??'').trim(),normalized=rhidNameKey(name);
    if(!normalized||names.has(normalized))throw new TypeError('CADASTRO de fornecedor vazio ou ambíguo. Corrija os nomes duplicados.');
    names.add(normalized);rows.push({id,name});
   }
   if(!page.hasMore)return rows.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
   if(cursors.has(next))throw new TypeError('Ciclo de paginação de fornecedores.');cursors.add(next);cursor=next;
  }
  throw new RangeError('Paginação de fornecedores incompleta: limite seguro excedido.');
 }});
}
