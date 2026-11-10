import {provisionDateKey,provisionTotal} from './pending-provision-dates.js';
import {provisionDescriptionLinkColumn} from './provision-description-detail-data.js';
import {provisionChildPaid,provisionDateKey as paymentDateKey,provisionDueFields} from '../../../../portal/forms/provision-parent-due.js';

export const DDA_PROVISION_FIELD='DESCRITIVOPROVIS_x00c3_O';
const validId=value=>/^[1-9]\d*$/.test(String(value??''))&&Number.isSafeInteger(Number(value));
const CHILD_LISTS=['PROVISÃO PGTOS','PROVISAO PGTOS','PROVISAO PAGAMENTOS'];
function hasItemIdentity(item,expectedId=String(item?.id)){
 const fields=item?.fields,fieldId=fields?.ID??fields?.id;
 return validId(item?.id)&&String(item.id)===expectedId&&fields&&typeof fields==='object'&&!Array.isArray(fields)
  &&(fieldId==null||String(fieldId).trim()===expectedId);
}
const nameKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const legalNameTokens=new Set(['LTDA','LIMITADA','EIRELI','SA','EPP','MEI','ME','DO','DA','DE','DOS','DAS','NO','NA','NOS','NAS','EM','AO','AOS','OS','AS','UM','UMA','S','A','E','O']);
const genericNameTokens=new Set(['EMPRESA','COMERCIO','COMERCIAL','COMERCIAIS','INDUSTRIA','INDUSTRIAL','SERVICOS','BRASIL','FORNECEDOR','NAO','INFORMADO','ENGENHARIA','CONSTRUCAO','CONSTRUCOES','CONCRETO','CONCRETOS','MATERIAL','MATERIAIS']);
const tokens=value=>new Set(nameKey(value).split(' ').filter(part=>part&&!legalNameTokens.has(part)));
function nameCoverage(parts,other){
 if(!parts.size||!other.size)return 0;
 const shared=[...parts].filter(part=>other.has(part)).length;
 return 0.7*shared/Math.min(parts.size,other.size)+0.3*shared/Math.max(parts.size,other.size);
}
function supplierSimilarity(parts,other){
 const distinctive=set=>new Set([...set].filter(part=>!genericNameTokens.has(part)));
 const left=distinctive(parts),right=distinctive(other);
 if(!left.size||!right.size)return 0;
 // A shortened supplier name can contain only the distinctive part of its legal name.
 const identity=[...left].join('')===[...right].join('')?1:nameCoverage(left,right);
 // Generic sector words may refine an existing name match, never establish one.
 return identity>=0.5?0.8*identity+0.2*nameCoverage(parts,other):0;
}
export function fiscalSupplierSimilarity(supplier, candidate) {
 const left=tokens(supplier),right=tokens(candidate);
 const exact=[...left].join(' ');
 if(left.size>1&&exact!=='FORNECEDOR NAO INFORMADO'&&exact===[...right].join(' '))return 1;
 return supplierSimilarity(left,right);
}
const amountKey=value=>{let text=String(value??'').trim().replace(/R\$|\s/g,'');if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');const number=/^\d+(?:\.\d+)?$/.test(text)?Number(text):null;return number!=null&&Number.isFinite(number)?Math.round(number*100):null;};
const columnKey=value=>nameKey(String(value??'').replace(/_x([0-9a-f]{4})_/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16)))).replace(/ /g,'');
function childField(fields,columns,...aliases){
 for(const alias of aliases){
  const key=columnKey(alias),column=columns.find(entry=>columnKey(entry.name)===key||columnKey(entry.displayName)===key);
  if(column&&fields[column.name]!=null)return fields[column.name];
  const direct=Object.entries(fields).find(([name,value])=>columnKey(name)===key&&value!=null);
  if(direct)return direct[1];
 }
}
export function rankDdaProvisionOptions(options,{supplier,amount,due}={}){
 const parts=tokens(supplier),wanted=amountKey(amount);
 const ranked=options.map(item=>{
  const similarity=supplierSimilarity(parts,tokens(item.supplier));
  const supplierMatch=similarity>=0.5;
  const totalMatch=wanted!=null&&amountKey(item.amount)===wanted;
  const matches=(item.provisions||[]).filter(line=>wanted!=null&&amountKey(line.amount)===wanted);
  const amountMatch=totalMatch||matches.length>0;
  const dueTime=Date.parse(String(due||'').slice(0,10));
  const proximity=value=>{const time=Date.parse(String(value||'').slice(0,10));return Number.isFinite(dueTime)&&Number.isFinite(time)?0.25/(1+Math.abs(dueTime-time)/86400000):0;};
  matches.sort((a,b)=>proximity(b.due)-proximity(a.due)||Number(a.id)-Number(b.id));
  const matchedProvision=matches[0];
  // A matching line's own due date is stronger evidence than its group's due date.
  const dueScore=amountMatch?Math.max(totalMatch?proximity(item.due):0,...matches.map(line=>proximity(line.due))):supplierMatch?proximity(item.due):0;
  return {...item,supplierMatch,amountMatch,matchedProvision,score:(supplierMatch?2+similarity:0)+(amountMatch?2:0)+dueScore};
 });
 const hasAmountMatch=ranked.some(item=>item.amountMatch);
 return ranked.sort((a,b)=>Number(b.amountMatch)-Number(a.amountMatch)||b.score-a.score||Number(a.id)-Number(b.id)).map((item,index)=>({
  ...item,recommended:index===0&&item.score>0,matchReason:item.amountMatch?'amount':!hasAmountMatch&&item.supplierMatch?'supplier':'',
 }));
}

export function createDdaProvisionLink({repository,siteKey='personal',assertSession=()=>{}}){
 if(!repository)throw new TypeError('Repositório SharePoint obrigatório.');
 let listPromise;
 async function lists(signal){
  listPromise??=Promise.all(['DDAS SICOOB','DESCRITIVOPROVISAO'].map(name=>repository.resolveList(siteKey,[name],{signal}))).then(([dda,provision])=>{
   if(dda?.status!=='resolved'||provision?.status!=='resolved')throw new Error('Listas DDA ou de provisão indisponíveis.');
   return {dda,provision};
  }).catch(error=>{listPromise=null;throw error;});
  return listPromise;
 }
 async function loadOptions({signal}={}){
  assertSession();const {dda,provision}=await lists(signal);
  const columns=await repository.getColumns(siteKey,dda.id,{signal});
  if(!columns.some(column=>column.name===DDA_PROVISION_FIELD&&!column.readOnly))throw new Error('Coluna de vínculo DDA indisponível.');
  const items=await repository.getItems(siteKey,provision.id,'?$expand=fields',{signal});assertSession();
  if(!Array.isArray(items))throw new Error('Consulta de provisões incompleta.');
  const children=await repository.resolveList(siteKey,CHILD_LISTS,{signal});assertSession();
  if(children?.status!=='resolved'||!children.id)throw new Error('Lista de provisões indisponível.');
  const childColumns=await repository.getColumns(siteKey,children.id,{signal});assertSession();
  const linkName=provisionDescriptionLinkColumn(childColumns);
  // getItems follows all repository pages, including children outside the visible gallery.
  const lines=await repository.getItems(siteKey,children.id,'?$expand=fields',{signal});assertSession();
  if(!Array.isArray(lines))throw new Error('Consulta de provisões incompleta.');
  const byParent=new Map();
  for(const line of lines){
   const fields=line?.fields,parent=String(fields?.[linkName]??'').trim();
   if(!validId(line?.id)||!validId(parent)||!fields)continue;
   const read=(...aliases)=>childField(fields,childColumns,...aliases);
   if(String(read('DATAPGTOEFETUADO')??'').trim()||nameKey(read('STATUS'))==='PAGAMENTO EFETUADO'||nameKey(read('PGTOAGENDADO'))==='PAGO')continue;
   const amount=provisionTotal(read('VALORTOTAL'),read('QTD','QUANTIDADE'),read('FRETE'));
   if(amountKey(amount)==null)continue;
   if(!byParent.has(parent))byParent.set(parent,[]);
   byParent.get(parent).push({id:String(line.id),amount,due:provisionDateKey(read('DATAPREVISTOPGTO','DATAPGTOPREVISTO'))});
  }
  return items.filter(item=>validId(item.id)&&item.fields&&!String(item.fields.DATAPGTOEFETUADO??'').trim()).map(item=>({
   id:String(item.id),supplier:String(item.fields.FORNECEDOR||'Fornecedor não informado'),amount:item.fields.VALORTOTAL??null,
   due:item.fields.DATAPREVISTOPGTO||'',label:`#${item.id} · ${item.fields.FORNECEDOR||'Fornecedor não informado'}`,provisions:byParent.get(String(item.id))||[],
  }));
 }
 async function loadSettledDdaIds(rows,{signal}={}){
  const candidates=new Map(),settled=new Set();
  for(const row of rows){
   if(!validId(row.id)||!validId(row.provisionId))continue;
   if(!candidates.has(row.provisionId))candidates.set(row.provisionId,[]);
   candidates.get(row.provisionId).push(row);
  }
  if(!candidates.size)return settled;
  const active=()=>{assertSession();signal?.throwIfAborted();};
  active();
  const [parents,children]=await Promise.all([
   repository.resolveList(siteKey,['DESCRITIVOPROVISAO'],{signal}),
   repository.resolveList(siteKey,CHILD_LISTS,{signal}),
  ]);
  active();
  if([parents,children].some(list=>list?.status!=='resolved'||!list.id))throw new Error('Listas de provisão indisponíveis.');
  const columns=await repository.getColumns(siteKey,children.id,{signal});active();
  const linkName=provisionDescriptionLinkColumn(columns),paymentFields=provisionDueFields(columns);
  // The repository follows every page and rejects partial or malformed collections.
  const lines=await repository.getItems(siteKey,children.id,'?$expand=fields',{signal});active();
  if(!Array.isArray(lines))throw new Error('Consulta de provisões incompleta.');
  const seen=new Set(),groups=new Map();
  for(const line of lines){
   if(!hasItemIdentity(line)||seen.has(String(line.id)))throw new Error('Consulta de provisões inválida.');
   seen.add(String(line.id));
   const rawLink=line.fields[linkName];
   if(rawLink!=null&&typeof rawLink!=='string'&&typeof rawLink!=='number')throw new Error('Vínculo de provisão inválido.');
   const parent=String(rawLink??'').trim();
   if(!candidates.has(parent))continue;
   if(!groups.has(parent))groups.set(parent,{count:0,hasDue:false,undatedUnpaid:false,unpaidDays:new Set()});
   const group=groups.get(parent),due=paymentDateKey(line.fields[paymentFields.DATAPREVISTOPGTO]
    ??childField(line.fields,columns,'DATAPGTOPREVISTO'));
   group.count++;
   if(due)group.hasDue=true;
   if(!provisionChildPaid(line.fields,paymentFields)){
    if(due)group.unpaidDays.add(due);
    else group.undatedUnpaid=true;
   }
  }
  const fullyPaidGroups=new Map();
  for(const [parent,group] of groups){
   for(const row of candidates.get(parent)){
    if(row.status==='Pago'&&group.count>1&&row.due&&group.hasDue){
     // A different due day under the same parent is a separate obligation.
     if(!group.undatedUnpaid&&!group.unpaidDays.has(row.due))settled.add(row.id);
    }else if(!group.undatedUnpaid&&!group.unpaidDays.size){
     // Retain the existing proof for single provisions, unpaid DDAs and missing dates.
     if(!fullyPaidGroups.has(parent))fullyPaidGroups.set(parent,[]);
     fullyPaidGroups.get(parent).push(row.id);
    }
   }
  }
  const checkParent=async ([id,ddaIds])=>{
   let item;
   try{item=await repository.getItem(siteKey,parents.id,id,'?$expand=fields',{signal});}
   catch{active();return;}
   active();
   if(hasItemIdentity(item,id)&&paymentDateKey(item.fields.DATAPGTOEFETUADO))for(const ddaId of ddaIds)settled.add(ddaId);
  };
  const paidGroups=[...fullyPaidGroups];
  for(let offset=0;offset<paidGroups.length;offset+=8)await Promise.all(paidGroups.slice(offset,offset+8).map(checkParent));
  return settled;
 }
 async function save({ddaId,provisionId,signal,sharedLinkETag}){
  if(!validId(ddaId)||!validId(provisionId))throw new RangeError('ID de vínculo inválido.');
  assertSession();const {dda,provision}=await lists(signal);
  const target=await repository.getItem(siteKey,provision.id,provisionId,'?$expand=fields',{signal});
  if(!target?.fields||String(target.fields.DATAPGTOEFETUADO??'').trim())throw new Error('O descritivo já possui pagamento efetuado. Atualize as opções.');
  const current=await repository.getItem(siteKey,dda.id,ddaId,'?$expand=fields',{signal});
  const eTag=current?.eTag||current?.['@odata.etag']||current?.fields?.['@odata.etag'];
  if(!current?.fields||!eTag)throw new Error('Não foi possível verificar a versão atual do DDA.');
  if(String(current.fields[DDA_PROVISION_FIELD]??'').trim()===String(provisionId))return {ddaId:String(ddaId),provisionId:String(provisionId)};
  if(sharedLinkETag&&eTag!==sharedLinkETag)throw new Error('O DDA foi alterado durante a confirmação do vínculo.');
  if(!sharedLinkETag){
   // Read all pages with only the link column, independently of the report filters.
   const items=await repository.getItems(siteKey,dda.id,`?$select=id&$expand=fields($select=${DDA_PROVISION_FIELD})`,{signal});
   if(!Array.isArray(items)||items.some(item=>!hasItemIdentity(item)))throw new Error('Consulta de vínculos DDA incompleta.');
   const shared=items.some(item=>String(item.id)!==String(ddaId)
    &&String(item.fields[DDA_PROVISION_FIELD]??'').trim()===String(provisionId));
   if(shared)return {requiresSharedConfirmation:true,eTag};
  }
  assertSession();signal?.throwIfAborted();
  const saved=await repository.updateItem(siteKey,dda.id,ddaId,{[DDA_PROVISION_FIELD]:String(provisionId)},{eTag,signal});assertSession();
  if(String(saved?.fields?.[DDA_PROVISION_FIELD]??'')!==String(provisionId))throw new Error('O vínculo não foi confirmado no SharePoint.');
  return {ddaId:String(ddaId),provisionId:String(provisionId)};
 }
 return Object.freeze({loadOptions,loadSettledDdaIds,save});
}
