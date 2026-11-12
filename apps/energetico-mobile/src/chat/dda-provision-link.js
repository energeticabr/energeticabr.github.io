import {provisionTotal} from './pending-provision-dates.js';
import {provisionDescriptionLinkColumn} from './provision-description-detail-data.js';
import {provisionChildPaid,provisionDateKey as paymentDateKey,provisionDueFields,sameProvisionDue} from '../../../../portal/forms/provision-parent-due.js';

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
const itemVersion=item=>item?.eTag||item?.['@odata.etag']||item?.['odata.etag']||item?.fields?.['@odata.etag'];
function dueColumn(columns,names){
 const canonical=columns.find(column=>column.name===names.DATAPREVISTOPGTO);
 const legacy=columns.filter(column=>[column.name,column.displayName].some(name=>columnKey(name)==='DATAPGTOPREVISTO'));
 const column=canonical||(legacy.length===1?legacy[0]:null);
 if(!column?.dateTime||column.readOnly||column.hidden||column.computed)throw new Error('A data prevista de pagamento não está disponível para edição.');
 return column.name;
}
function hasRecordedPayment(fields,names){
 return Boolean(String(fields[names.DATAPGTOEFETUADO]??'').trim())||nameKey(fields[names.STATUS])==='PAGAMENTO EFETUADO'
  ||nameKey(fields[names.PGTOAGENDADO])==='PAGO';
}
export function rankDdaProvisionOptions(options,{supplier,amount,due}={}){
 const parts=tokens(supplier),wanted=amountKey(amount);
 const ddaDue=paymentDateKey(due),dueTime=Date.parse(ddaDue);
 const dueMatch=day=>Boolean(ddaDue)&&day===ddaDue;
 const proximity=day=>{const time=Date.parse(day);return Number.isFinite(dueTime)&&Number.isFinite(time)?0.25/(1+Math.abs(dueTime-time)/86400000):0;};
 const ranked=options.map(item=>{
  const similarity=supplierSimilarity(parts,tokens(item.supplier));
  const supplierMatch=similarity>=0.5;
  const totalMatch=wanted!=null&&amountKey(item.amount)===wanted;
  const matches=(item.provisions||[]).filter(line=>wanted!=null&&amountKey(line.amount)===wanted)
   .map(line=>({...line,due:paymentDateKey(line.due)}));
  const amountMatch=totalMatch||matches.length>0;
  const itemDue=paymentDateKey(item.due);
  matches.sort((a,b)=>proximity(b.due)-proximity(a.due)||Number(a.id)-Number(b.id));
  const line=matches[0];
  const matchedProvision=line&&{...line,dueMatch:dueMatch(line.due)};
  // A matching line's own due date is stronger evidence than its group's due date.
  const dueScore=amountMatch?Math.max(totalMatch?proximity(itemDue):0,...matches.map(line=>proximity(line.due))):supplierMatch?proximity(itemDue):0;
  return {...item,due:itemDue,dueMatch:dueMatch(itemDue),supplierMatch,totalMatch,amountMatch,matchedProvision,
   score:(supplierMatch?2+similarity:0)+(amountMatch?2:0)+dueScore};
 });
 const hasAmountMatch=ranked.some(item=>item.amountMatch);
 return ranked.sort((a,b)=>Number(b.amountMatch)-Number(a.amountMatch)||b.score-a.score||Number(a.id)-Number(b.id)).map((item,index)=>({
  ...item,recommended:index===0&&item.score>0,matchReason:item.amountMatch?'amount':!hasAmountMatch&&item.supplierMatch?'supplier':'',
 }));
}

export function createDdaProvisionLink({repository,siteKey='personal',assertSession=()=>{}}){
 if(!repository)throw new TypeError('Repositório SharePoint obrigatório.');
 function active(signal){assertSession();signal?.throwIfAborted();}
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
   byParent.get(parent).push({id:String(line.id),amount,due:paymentDateKey(read('DATAPREVISTOPGTO','DATAPGTOPREVISTO'))});
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
  active(signal);
  const [parents,children]=await Promise.all([
   repository.resolveList(siteKey,['DESCRITIVOPROVISAO'],{signal}),
   repository.resolveList(siteKey,CHILD_LISTS,{signal}),
  ]);
  active(signal);
  if([parents,children].some(list=>list?.status!=='resolved'||!list.id))throw new Error('Listas de provisão indisponíveis.');
  const columns=await repository.getColumns(siteKey,children.id,{signal});active(signal);
  const linkName=provisionDescriptionLinkColumn(columns),paymentFields=provisionDueFields(columns);
  // The repository follows every page and rejects partial or malformed collections.
  const lines=await repository.getItems(siteKey,children.id,'?$expand=fields',{signal});active(signal);
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
   catch{active(signal);return;}
   active(signal);
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
  const eTag=itemVersion(current);
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

 async function readItem(list,id,signal){
  active(signal);
  const item=await repository.getItem(siteKey,list,id,'?$expand=fields',{signal,includeVersion:true});
  active(signal);
  if(!hasItemIdentity(item,id))throw new Error('A identidade do registro não foi confirmada.');
  return item;
 }

 async function linkedChildren(list,linkName,provisionId,signal){
  active(signal);
  const lines=await repository.getItems(siteKey,list,`?$select=id&$expand=fields($select=${linkName})`,{signal});
  active(signal);
  const seen=new Set(),linked=[];
  if(!Array.isArray(lines))throw new Error('Consulta de provisões incompleta.');
  for(const line of lines){
   const id=String(line?.id),link=line?.fields?.[linkName];
   if(!hasItemIdentity(line)||seen.has(id)||(link!=null&&typeof link!=='string'&&typeof link!=='number')){
    throw new Error('Consulta de provisões inválida.');
   }
   seen.add(id);
   if(String(link??'').trim()===provisionId)linked.push(id);
  }
  return linked;
 }

 async function readLinkedDda(list,{ddaId,provisionId},signal){
  const dda=await readItem(list,ddaId,signal);
  if(String(dda.fields[DDA_PROVISION_FIELD]??'').trim()!==provisionId)throw new Error('O vínculo do DDA mudou.');
  return paymentDateKey(dda.fields.VENCIMENTO);
 }

 async function readDueContext({ddaId,provisionId},signal){
  if(!validId(ddaId)||!validId(provisionId))throw new RangeError('ID de vínculo inválido.');
  active(signal);
  const {dda,provision}=await lists(signal);
  const due=await readLinkedDda(dda.id,{ddaId,provisionId},signal);
  if(!due)return null;
  const children=await repository.resolveList(siteKey,CHILD_LISTS,{signal});
  active(signal);
  if(children?.status!=='resolved'||!children.id)throw new Error('Lista de provisões indisponível.');
  const childColumns=await repository.getColumns(siteKey,children.id,{signal});
  const linkName=provisionDescriptionLinkColumn(childColumns);
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(linkName))throw new Error('Coluna de vínculo da provisão inválida.');
  const ids=await linkedChildren(children.id,linkName,provisionId,signal);
  if(ids.length!==1)return null;
  const [child,parent,parentColumns]=await Promise.all([
   readItem(children.id,ids[0],signal),readItem(provision.id,provisionId,signal),repository.getColumns(siteKey,provision.id,{signal}),
  ]);
  active(signal);
  if(String(child.fields[linkName]??'').trim()!==provisionId)return null;
  const childNames=provisionDueFields(childColumns),parentNames=provisionDueFields(parentColumns);
  if(hasRecordedPayment(child.fields,childNames)||hasRecordedPayment(parent.fields,parentNames))return null;
  const childField=dueColumn(childColumns,childNames),parentField=dueColumn(parentColumns,parentNames);
  return {
   plan:{ddaId,provisionId,due,childId:ids[0],childDue:paymentDateKey(child.fields[childField]),parentDue:paymentDateKey(parent.fields[parentField]),
    childVersion:itemVersion(child),parentVersion:itemVersion(parent),childField,parentField},
   child,parent,linkName,childList:children.id,parentList:provision.id,ddaList:dda.id,
  };
 }

 async function prepareDueAdjustment(receipt,{signal}={}){
  const context=await readDueContext(receipt,signal);
  const plan=context?.plan;
  if(!plan||(plan.childDue===plan.due&&plan.parentDue===plan.due))return null;
  if([plan.childVersion,plan.parentVersion].some(tag=>!tag||tag==='*'))throw new Error('As versões das datas previstas não estão disponíveis.');
  return Object.freeze(plan);
 }

 async function writeDue(list,item,field,value){
  active();
  const eTag=itemVersion(item),id=String(item.id);
  if(!eTag||eTag==='*')throw new Error('A versão da data prevista não está disponível.');
  const matches=record=>hasItemIdentity(record,id)&&sameProvisionDue(record.fields[field],value);
  try{
   const saved=await repository.updateItem(siteKey,list,id,{[field]:value},{eTag,includeVersion:true,readbackFields:[field]});
   if(matches(saved))return {saved,canRestore:true};
  }catch(error){
   if(Number(error?.status)===412||error?.code==='concurrent_change')throw error;
   const observed=await readItem(list,id);
   if(matches(observed))return {saved:observed,canRestore:false};
   throw error;
  }
  const observed=await readItem(list,id);
  if(matches(observed))return {saved:observed,canRestore:false};
  throw new Error('A data prevista não foi confirmada na releitura.');
 }

 async function adjustDue(plan,{signal}={}){
  const context=await readDueContext(plan,signal);
  const latest=context?.plan;
  if(latest?.due===plan.due&&latest.childId===plan.childId&&latest.childDue===plan.due&&latest.parentDue===plan.due)return;
  if(!latest||Object.keys(latest).some(key=>latest[key]!==plan[key]))throw new Error('O vínculo ou a provisão mudou. Reabra o vínculo e confira as datas.');
  const {child,parent,childList,parentList,ddaList,linkName}=context;
  const {childId,provisionId,due,childField,parentField,childDue,parentDue}=latest;
  if([latest.childVersion,latest.parentVersion].some(tag=>!tag||tag==='*'))throw new Error('As versões das datas previstas não estão disponíveis.');
  // Preserve the same day in readers that convert SharePoint timestamps to São Paulo time.
  const value=`${due}T03:00:00Z`;
  active(signal);
  // Once approved and started, finish the paired write or compensate even if the dialog is closed.
  let childSaved,parentWriteStarted=false;
  try{
   if(childDue!==due)childSaved=await writeDue(childList,child,childField,value);
   const [ids,liveDue]=await Promise.all([linkedChildren(childList,linkName,provisionId),readLinkedDda(ddaList,latest)]);
   if(ids.length!==1||ids[0]!==childId||liveDue!==due)throw new Error('O vínculo ou a provisão mudou durante o ajuste.');
   if(parentDue!==due){
    parentWriteStarted=true;
    await writeDue(parentList,parent,parentField,value);
   }
  }catch(error){
   if(childSaved?.canRestore&&(!parentWriteStarted||paymentDateKey((await readItem(parentList,provisionId)).fields[parentField])!==due)){
    await writeDue(childList,childSaved.saved,childField,child.fields[childField]??null);
   }
   throw error;
  }
  const [currentChild,currentParent]=await Promise.all([readItem(childList,childId),readItem(parentList,provisionId)]);
  if(String(currentChild.fields[linkName]??'').trim()!==provisionId
   ||paymentDateKey(currentChild.fields[childField])!==due||paymentDateKey(currentParent.fields[parentField])!==due){
   throw new Error('As datas da provisão e do descritivo não foram confirmadas.');
  }
 }

 return Object.freeze({loadOptions,loadSettledDdaIds,save,prepareDueAdjustment,adjustDue});
}
