const COMMON = new Set(['FILIAL','FORNECEDOR','DATAPREVISTOPGTO','DATAPGTOEFETUADO','FORMAPGTO','OBS','PGTOAGENDADO','DATAPGTOAGENDADO','DATAEXECUCAOAGENDAMENTO','STATUS']);
const DATES = new Set(['DATAPREVISTOPGTO','DATAPGTOEFETUADO','PGTOAGENDADO','DATAPGTOAGENDADO','DATAEXECUCAOAGENDAMENTO']);
const CHILD_LISTS = ['PROVISÃO PGTOS','PROVISAO PGTOS','PROVISAO PAGAMENTOS'];
const key = value => String(value || '').replace(/_x([0-9a-f]{4})_/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16))).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toUpperCase();
const protectedDestination = name => /^(?:ID|VALOR)/.test(key(name))||new Set(['TITLE','CREATED','MODIFIED','AUTHOR','EDITOR','PRODUTO','QTD','QUANTIDADE','FRETE','TOTAL','VU','DESCRITIVOPROVISAO']).has(key(name));
const blank = value => value == null || value === '';
function id(value){const text=String(value??'').trim();if(!/^[1-9]\d{0,14}$/.test(text))throw new Error('O descritivo/provisão requer ID positivo.');return text;}
function version(item){const tag=String(item?.eTag||item?.['@odata.etag']||item?.['odata.etag']||'').trim();if(!tag||tag==='*')throw new Error('A versão ETag do descritivo/provisão não está disponível.');return tag;}
function column(columns,logical){
 const available=columns.filter(c=>c&&!c.readOnly&&!c.hidden&&!c.computed
  &&(!protectedDestination(c.name)||key(c.name)===key(logical))
  &&(!COMMON.has(key(c.name))||key(c.name)===key(logical)));
 const internal=available.filter(c=>key(c.name)===key(logical));
 const matches=internal.length?internal:available.filter(c=>key(c.displayName)===key(logical));
 if(matches.length!==1||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(matches[0].name))throw new Error(`Metadados únicos e editáveis de ${logical} não disponíveis.`);
 return matches[0];
}
function dateNumber(value){
 const text=String(value),day=text.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(text)
  ||!Number.isFinite(Date.parse(text))||new Date(`${day}T00:00:00Z`).toISOString().slice(0,10)!==day)throw new Error('Informe uma data válida para sincronizar o descritivo.');
 return Date.parse(text.includes('T')?(/(?:Z|[+-]\d{2}:\d{2})$/.test(text)?text:`${text}Z`):`${text}T00:00:00Z`);
}
function valueFor(value,source,target){
 if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new Error(`Valor inválido em ${source.name}.`);
 if(source.dateTime&&!blank(value))dateNumber(value);
 if(target.dateTime){if(!source.dateTime)throw new Error(`Tipos incompatíveis em ${source.name}.`);return blank(value)?null:String(value);}
 if(target.text||target.multilineText)return blank(value)?'':String(value);
 if(target.choice){if(blank(value))return null;const choices=target.choice.choices||[];if(!choices.includes(String(value)))throw new Error(`O valor de ${source.name} não pertence às opções da provisão.`);return String(value);}
 if(target.number||target.currency){const number=Number(value);if(blank(value))return null;if(!Number.isFinite(number))throw new Error(`Número inválido em ${source.name}.`);return number;}
 throw new Error(`Tipos de metadados incompatíveis em ${source.name}.`);
}
function equal(actual,expected,descriptor){
 if(blank(actual)&&blank(expected))return true;
 if(descriptor.dateTime&&!blank(actual)&&!blank(expected))try{return dateNumber(actual)===dateNumber(expected);}catch{return false;}
 return String(actual)===String(expected);
}
function matches(item,patch,columns){return Object.entries(patch).every(([name,value])=>equal(item.fields?.[name],value,columns.find(c=>c.name===name)||{}));}
const intent = patch => JSON.stringify(Object.keys(patch).sort().map(name=>[name,patch[name]]));

/** STATUS is currently Text on both lists. Discover values without changing its schema. */
export async function loadProvisionDescriptionStatusOptions({repository,siteKey='personal',signal}={}){
 const active=()=>{if(signal?.aborted)throw signal.reason||new DOMException('Consulta de STATUS cancelada.','AbortError');};
 const options=signal?{signal}:{};
 async function statusSource(aliases){
  active();const list=await repository.resolveList(siteKey,aliases,options);active();
  if(list?.status!=='resolved'||!list.id)throw new Error('A lista de opções de STATUS não foi comprovada.');
  const columns=await repository.getColumns(siteKey,list.id,options);active();
  if(!Array.isArray(columns))throw new Error('Metadados de STATUS indisponíveis.');
  const descriptor=column(columns,'STATUS');
  if(descriptor.choice){
   const choices=descriptor.choice.choices;
   if(descriptor.choice.allowMultipleValues||!Array.isArray(choices)||choices.some(value=>typeof value!=='string'||!value.trim()))throw new Error('As opções de STATUS não foram comprovadas nos metadados.');
   return {list,descriptor,choices};
  }
  if(!descriptor.text||descriptor.text.allowMultipleLines)throw new Error('STATUS requer metadados textuais ou de escolha simples.');
  return {list,descriptor};
 }
 const parent=await statusSource(['DESCRITIVOPROVISAO']);
 if(parent.choices)return Object.freeze([...new Set(parent.choices)]);
 const child=await statusSource(CHILD_LISTS);
 if(child.list.id===parent.list.id)throw new Error('A fonte de STATUS das provisões não corresponde à lista filha.');
 if(child.choices)return Object.freeze([...new Set(child.choices)]);
 const values=new Set();
 for(const source of [parent,child]){
  // Match the repository's Graph/REST safety limits rather than bypassing them.
  const query=`$select=id&$expand=fields($select=${source.descriptor.name})&$top=100`;
  let cursor='';const seen=new Set();let complete=false;
  for(let pageNumber=1;pageNumber<=100;pageNumber++){
   active();
   const page=typeof repository.getItemsPage==='function'
    ?await repository.getItemsPage(siteKey,source.list.id,query,{pageNumber,maxPages:100,...(cursor?{cursor}:{}),...options})
    :{items:await repository.getItems(siteKey,source.list.id,query,options),hasMore:false};
   active();
   if(!Array.isArray(page?.items)||typeof page.hasMore!=='boolean'||page.complete===false||page.partial||page.truncated||page.items.complete===false||page.items.partial||page.items.truncated)throw new Error('A consulta de opções de STATUS está incompleta.');
   for(const row of page.items){
    if(!row?.fields||typeof row.fields!=='object'||Array.isArray(row.fields))throw new Error('O registro de opções de STATUS é inválido.');
    const value=row.fields[source.descriptor.name];
    if(value==null||value==='')continue;
    if(typeof value!=='string')throw new Error('A fonte retornou uma opção de STATUS inválida.');
    if(value.trim())values.add(value);
   }
   if(!page.hasMore){if(page.nextLink)throw new Error('Cursor de opções de STATUS inconsistente.');complete=true;break;}
   if(typeof page.nextLink!=='string'||!page.nextLink.trim()||seen.has(page.nextLink))throw new Error('A paginação das opções de STATUS não retornou cursor único.');
   cursor=page.nextLink;seen.add(cursor);
  }
  if(!complete)throw new Error('A paginação das opções de STATUS excedeu o limite seguro.');
 }
 return Object.freeze([...values]);
}

/** One service retains incomplete operations for explicit retry, never rebasing stale edits. */
export function createProvisionDescriptionEditor({repository,siteKey='personal',assertSession=()=>{}}={}){
 const operations=new Map(),busy=new Set();
 function active(signal){assertSession();if(signal?.aborted)throw signal.reason||new DOMException('Sincronização cancelada.','AbortError');}
 async function read(list,itemId,signal){active(signal);const item=await repository.getItem(siteKey,list,itemId,'$expand=fields',signal?{signal}:{});active(signal);if(id(item?.id)!==itemId)throw new Error('A identidade do descritivo/provisão mudou.');version(item);return item;}
 async function linkedChildren(list,link,signal){
  let items=[];
  if(typeof repository.getItemsPage==='function'){
   let cursor='';const seen=new Set();
   for(let pageNumber=1;pageNumber<=400;pageNumber++){
    active(signal);const page=await repository.getItemsPage(siteKey,list,'$expand=fields&$top=200',{pageNumber,maxPages:400,...(cursor?{cursor}:{}),...(signal?{signal}:{})});active(signal);
    if(!Array.isArray(page?.items)||page.complete===false||page.partial||page.truncated)throw new Error('A consulta paginada das provisões está incompleta.');
    items.push(...page.items);
    if(page.hasMore!==true){if(page.nextLink)throw new Error('Cursor de paginação conflitante.');return items;}
    if(typeof page.nextLink!=='string'||!page.nextLink||seen.has(page.nextLink))throw new Error('A paginação das provisões não retornou cursor único.');
    seen.add(page.nextLink);cursor=page.nextLink;
   }
   throw new Error('A consulta completa das provisões excedeu o limite seguro de páginas.');
  }
  active(signal);items=await repository.getItems(siteKey,list,'$expand=fields',signal?{signal}:{});active(signal);
  if(!Array.isArray(items)||items.complete===false||items.partial||items.truncated)throw new Error('A consulta completa das provisões está indisponível.');
  return items;
 }
 async function contract(list,item,fields,signal){
  active(signal);const parent=await repository.resolveList(siteKey,['DESCRITIVOPROVISAO'],signal?{signal}:{});active(signal);
  if(parent?.status!=='resolved'||!parent.id||parent.id!==list?.id)throw new Error('A lista editada não corresponde ao descritivo de provisão.');
  const parentColumns=await repository.getColumns(siteKey,parent.id,signal?{signal}:{});active(signal);
  if(!Array.isArray(parentColumns))throw new Error('Metadados do descritivo indisponíveis.');
  const patch={},shared=[];
  for(const [name,value] of Object.entries(fields)){
   const candidates=parentColumns.filter(c=>c.name===name&&!c.readOnly&&!c.hidden&&!c.computed);
   const descriptor=candidates.length===1?candidates[0]:null;
   const logical=descriptor&&key(descriptor.name);
   const resolvedLogical=COMMON.has(logical)||logical==='VALORTOTAL'?logical:descriptor&&key(descriptor.displayName);
   if(!descriptor||['TITLE','ID','CREATED','MODIFIED','AUTHOR','EDITOR'].includes(key(name))||(!COMMON.has(resolvedLogical)&&resolvedLogical!=='VALORTOTAL'))throw new Error(`O campo ${name} não é editável no descritivo.`);
   if(DATES.has(resolvedLogical)&&!descriptor.dateTime)throw new Error(`O campo ${name} requer metadados de data do descritivo.`);
   if(resolvedLogical==='STATUS'){
    const choices=await loadProvisionDescriptionStatusOptions({repository,siteKey,signal});active(signal);
    if(!blank(value)&&!choices.includes(value)||blank(value)&&descriptor.required)throw new Error('Selecione uma opção de STATUS comprovada no SharePoint.');
   }
   patch[name]=valueFor(value,descriptor,descriptor);
   if(COMMON.has(resolvedLogical))shared.push({logical:resolvedLogical,descriptor,value:patch[name]});
  }
  let children=[],childList='',childColumns=[],link,childPatch={};
  if(shared.length){
   const resolved=await repository.resolveList(siteKey,CHILD_LISTS,signal?{signal}:{});active(signal);
   if(resolved?.status!=='resolved'||!resolved.id||resolved.id===parent.id)throw new Error('A lista de provisões filhas não foi localizada.');
   childList=resolved.id;childColumns=await repository.getColumns(siteKey,childList,signal?{signal}:{});active(signal);
   if(!Array.isArray(childColumns))throw new Error('Metadados das provisões indisponíveis.');
   link=column(childColumns,'DESCRITIVOPROVISAO');if(!link.text)throw new Error('O vínculo DESCRITIVOPROVISAO requer metadados textuais.');
   for(const change of shared){const target=column(childColumns,change.logical);childPatch[target.name]=valueFor(change.value,change.descriptor,target);}
   const seen=new Set();children=(await linkedChildren(childList,link,signal)).filter(row=>String(row.fields?.[link.name]??'').trim()===id(item.id)).map(row=>{
    const childId=id(row.id);if(seen.has(childId))throw new Error('A consulta paginada retornou identidade de provisão duplicada.');seen.add(childId);
    return {id:childId,eTag:version(row),patch:Object.freeze({...childPatch}),attempted:false,done:false};
   }).sort((a,b)=>Number(a.id)-Number(b.id));
  }
  return {parentList:parent.id,parentColumns,patch:Object.freeze(patch),childList,childColumns,childPatch:Object.freeze(childPatch),link,children};
 }
 async function apply(list,itemId,expectedTag,patch,columns,state,signal,check=()=>{}){
  const current=await read(list,itemId,signal);check(current);
  if(version(current)!==expectedTag){if(state.attempted&&matches(current,patch,columns))return current;throw new Error(`A versão da provisão/descritivo ${itemId} mudou. Recarregue e confira a sincronização.`);}
  if(matches(current,patch,columns))return current;
  active(signal);state.attempted=true;
  try{await repository.updateItem(siteKey,list,itemId,patch,{eTag:expectedTag,...(signal?{signal}:{})});}
  catch(error){
   // A lost PATCH response may already be committed; recover by readback, never by wildcard/rebase.
   const recovered=await read(list,itemId,signal);check(recovered);
   if(matches(recovered,patch,columns))return recovered;
   throw error;
  }
  const saved=await read(list,itemId,signal);check(saved);
  if(!matches(saved,patch,columns))throw new Error(`A sincronização do registro ${itemId} não foi confirmada na releitura.`);
  return saved;
 }
 async function save({list,item,fields,requestedFields,signal}={}){
  active(signal);const parentId=id(item?.id),originalTag=version(item);
  if(!fields||typeof fields!=='object'||Array.isArray(fields))throw new Error('Informe os campos editados do descritivo.');
  if(busy.has(parentId))throw new Error('A sincronização deste descritivo já está em andamento.');
  busy.add(parentId);let operation=operations.get(parentId);
  try{
   if(operation){
    const sameRequested=requestedFields&&typeof requestedFields==='object'&&!Array.isArray(requestedFields)
     &&matches({fields:requestedFields},operation.patch,operation.parentColumns);
    if((Object.keys(fields).length?operation.input!==intent(fields):!sameRequested)
     ||(requestedFields&&!sameRequested)||operation.parentList!==list?.id)throw new Error('Conclua a retentativa da sincronização anterior com os mesmos dados antes de trocar os dados do descritivo.');
   }
   else{
    const metadata=await contract(list,item,fields,signal);
    operation={...metadata,parentId,eTag:originalTag,input:intent(fields),attempted:false,saved:null};
    operations.set(parentId,operation);
   }
   if(!operation.saved)operation.saved=await apply(operation.parentList,parentId,operation.eTag,operation.patch,operation.parentColumns,operation,signal);
   async function confirmParent(){const current=await read(operation.parentList,parentId,signal);if(!matches(current,operation.patch,operation.parentColumns))throw new Error('O descritivo mudou durante a sincronização incompleta. Confira os dados antes de retomar.');return current;}
   await confirmParent();
   for(const child of operation.children){
    if(child.done)continue;
    await confirmParent();
    await apply(operation.childList,child.id,child.eTag,child.patch,operation.childColumns,child,signal,current=>{if(String(current.fields?.[operation.link.name]??'').trim()!==parentId)throw new Error(`A provisão ${child.id} mudou de vínculo; não foi alterada.`);});
    child.done=true;
   }
   if(operation.link){
    const rows=(await linkedChildren(operation.childList,operation.link,signal)).filter(row=>String(row.fields?.[operation.link.name]??'').trim()===parentId);
    const seen=new Set();let changed=false;
    for(const row of rows){
     const childId=id(row.id);if(seen.has(childId))throw new Error('A conferência final retornou provisão duplicada.');seen.add(childId);
     let child=operation.children.find(candidate=>candidate.id===childId);
     if(!child){child={id:childId,eTag:version(row),patch:operation.childPatch,attempted:false,done:false};operation.children.push(child);changed=true;}
     else if(!matches(row,child.patch,operation.childColumns)){child.done=false;changed=true;}
    }
    if(changed)throw new Error('Os itens vinculados mudaram durante a sincronização; confira os pendentes e retome com os mesmos dados.');
   }
   operation.saved=await confirmParent();
   operations.delete(parentId);return operation.saved;
  }catch(cause){
   if(operation?.saved){
    const pendingChildIds=operation.children.filter(c=>!c.done).map(c=>c.id);
    const error=new Error(`O descritivo ${parentId} foi salvo, mas a sincronização das provisões não foi concluída. Itens pendentes: ${pendingChildIds.join(', ')||'conferência do pai'}. Tente novamente com os mesmos dados. ${cause.message||''}`,{cause});
    error.code='PROVISION_DESCRIPTION_SYNC_INCOMPLETE';error.parentId=parentId;error.pendingChildIds=Object.freeze(pendingChildIds);throw error;
   }
   if((operation&&!operation.attempted)||[400,401,403,412].includes(cause?.status))operations.delete(parentId);
   throw cause;
  }finally{busy.delete(parentId);}
 }
 return Object.freeze({save});
}
