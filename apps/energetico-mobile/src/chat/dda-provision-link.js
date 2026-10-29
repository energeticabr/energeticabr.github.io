export const DDA_PROVISION_FIELD='DESCRITIVOPROVIS_x00c3_O';
const validId=value=>/^[1-9]\d*$/.test(String(value??''))&&Number.isSafeInteger(Number(value));
const nameKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').trim();
const tokens=value=>new Set(nameKey(value).split(' ').filter(part=>part.length>2&&!['LTDA','EIRELI','S A','SA','ME','EMPRESA'].includes(part)));
const amountKey=value=>{let text=String(value??'').trim().replace(/R\$|\s/g,'');if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');const number=/^\d+(?:\.\d+)?$/.test(text)?Number(text):null;return number!=null&&Number.isFinite(number)?Math.round(number*100):null;};
export function rankDdaProvisionOptions(options,{supplier,amount}={}){
 const query=nameKey(supplier),parts=tokens(supplier),wanted=amountKey(amount);
 return options.map(item=>{
  const candidate=nameKey(item.supplier),other=tokens(item.supplier);
  const shared=[...parts].filter(part=>other.has(part)).length;
  const similarity=query&&candidate?(query===candidate?1:shared/Math.max(parts.size,other.size,1)):0;
  const supplierMatch=similarity>=0.5;
  const amountMatch=wanted!=null&&amountKey(item.amount)===wanted;
  return {...item,supplierMatch,amountMatch,score:(supplierMatch?2+similarity:0)+(amountMatch?2:0)};
 }).sort((a,b)=>b.score-a.score||Number(a.id)-Number(b.id)).map((item,index,all)=>({...item,recommended:item.score>0&&item.score===all[0].score}));
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
  return items.filter(item=>validId(item.id)&&item.fields&&!String(item.fields.DATAPGTOEFETUADO??'').trim()).map(item=>({
   id:String(item.id),supplier:String(item.fields.FORNECEDOR||'Fornecedor não informado'),amount:item.fields.VALORTOTAL??null,
   due:item.fields.DATAPREVISTOPGTO||'',label:`#${item.id} · ${item.fields.FORNECEDOR||'Fornecedor não informado'}`,
  }));
 }
 async function save({ddaId,provisionId,signal}){
  if(!validId(ddaId)||!validId(provisionId))throw new RangeError('ID de vínculo inválido.');
  assertSession();const {dda,provision}=await lists(signal);
  const target=await repository.getItem(siteKey,provision.id,provisionId,'?$expand=fields',{signal});
  if(!target?.fields||String(target.fields.DATAPGTOEFETUADO??'').trim())throw new Error('O descritivo já possui pagamento efetuado. Atualize as opções.');
  const current=await repository.getItem(siteKey,dda.id,ddaId,'?$expand=fields',{signal});
  const eTag=current?.eTag||current?.['@odata.etag']||current?.fields?.['@odata.etag'];
  if(!current?.fields||!eTag)throw new Error('Não foi possível verificar a versão atual do DDA.');
  if(String(current.fields[DDA_PROVISION_FIELD]??'')===String(provisionId))return {ddaId:String(ddaId),provisionId:String(provisionId)};
  const saved=await repository.updateItem(siteKey,dda.id,ddaId,{[DDA_PROVISION_FIELD]:String(provisionId)},{eTag,signal});assertSession();
  if(String(saved?.fields?.[DDA_PROVISION_FIELD]??'')!==String(provisionId))throw new Error('O vínculo não foi confirmado no SharePoint.');
  return {ddaId:String(ddaId),provisionId:String(provisionId)};
 }
 return Object.freeze({loadOptions,save});
}
