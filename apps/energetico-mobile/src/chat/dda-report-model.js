import Decimal from 'decimal.js';
import { includesSearchText, normalizeSearchText } from '../../../../portal/core/search-text.js';
import {REGISTRATION_GALLERY_MODELS,registrationRawField,registrationDateKey,registrationNumber} from './registration-gallery-data.js';
import {ddaTodayKey} from '../ui/dda-card.js';
import {ddaPaidManually} from './dda-payment-confirmation.js';
import {resolveDdaPaymentLine} from './dda-payment-line.js';
import {ddaBankSchedule,isDdaOpenStatus,normalizeDdaStatus} from './dda-bank-status.js';
const Money=Decimal.clone({precision:40});
export {ddaSearchKey} from './dda-bank-status.js';
const text=value=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
const provisionId=value=>{const id=text(value);return /^[1-9]\d*$/.test(id)&&Number.isSafeInteger(Number(id))?id:'';};
const auditTime=value=>/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;

export function ddaWasScheduledAt(row,confirmedAt){
 const observedAt=auditTime(row.scheduledAt);
 return Number.isFinite(observedAt)&&observedAt<=auditTime(confirmedAt);
}

export function ddaSettlementPending(row,settledProvisionIds){
 return Boolean(settledProvisionIds&&row.status==='Pago'
  &&(row.provisionId||row.paidBySchedule)&&!settledProvisionIds.has(row.provisionId));
}

export async function readDdaSettledProvisionIds(rows,provisionLink,signal){
 const ids=[...new Set(rows.filter(row=>row.status==='Pago'&&row.provisionId).map(row=>row.provisionId))];
 if(!ids.length)return new Set();
 if(typeof provisionLink?.loadSettledProvisionIds!=='function')return null;
 try{
  const settled=await provisionLink.loadSettledProvisionIds(ids,{signal});
  if(settled instanceof Set)return new Set(ids.filter(id=>settled.has(id)));
 }catch{/* Keep paid DDAs pending when SharePoint cannot verify settlement. */}
 return null;
}

function supplierCnpj(value){
 const key=text(value).toUpperCase().replace(/[\s./-]/g,'');
 // An opaque identity key, not a tax-document validation or name-based guess.
 return /^[A-Z0-9]{14}$/.test(key)&&!/^([A-Z0-9])\1+$/.test(key)?key:null;
}
export function normalizeDdaReportRows(snapshot){
 if(!Array.isArray(snapshot?.rows)||snapshot.hasMore===true||snapshot.complete===false)throw new TypeError('Consulta DDA incompleta.');
 const ids=new Set();
 const normalized=snapshot.rows.map(row=>{
  const id=text(row?.id);if(!/^\d+$/.test(id)||!row?.fields||typeof row.fields!=='object'||Array.isArray(row.fields)||ids.has(Number(id)))throw new TypeError('Registro DDA inválido.');ids.add(Number(id));
  const value=name=>registrationRawField(row.fields,name,REGISTRATION_GALLERY_MODELS.dda),number=registrationNumber(value('VALOR'));
  const amount=number!=null&&number>=0&&number<=Number.MAX_SAFE_INTEGER/100?new Money(number).toDecimalPlaces(2).toFixed(2):null;
  const paymentLine=resolveDdaPaymentLine(value('LINHA_DIGITAVEL'),value('CODIGO_BARRAS'));
  const schedule=Object.freeze(ddaBankSchedule(value));
  const scheduleLifecycle=text(value('DDA_CICLO_AGENDAMENTO'));
  const checkedAt=text(value('ULTIMA_CONSULTA')),statusCheckedAt=text(value('STATUS_CONSULTADO_EM'));
  const activeSchedule=(scheduleLifecycle==='AGENDADO'||normalizeDdaStatus(value('STATUS_DDA'))==='Agendado')
   &&auditTime(checkedAt)<=auditTime(statusCheckedAt);
  const scheduledAt=activeSchedule?statusCheckedAt:'';
  const paidManually=ddaPaidManually(value('PGTO_CONFIRMADO')),confirmedAt=text(value('PGTO_CONFIRMADO_EM'));
  const audited=paidManually&&text(value('PGTO_CONFIRMADO_POR'))&&Number.isFinite(auditTime(confirmedAt));
  const paidBySchedule=scheduleLifecycle==='PAGO_AGENDADO'||Boolean(audited&&ddaWasScheduledAt({scheduledAt},confirmedAt));
  return {id,paymentLine,key:text(value('CHAVE_DDA')),paidManually,confirmedAt,paidBySchedule,scheduledAt,supplier:text(value('FORNECEDOR'))||'Fornecedor não informado',supplierCnpj:supplierCnpj(value('CNPJ_FORNECEDOR')),due:registrationDateKey(value('VENCIMENTO')),issued:registrationDateKey(value('EMISSAO')),amount,status:paidBySchedule?'Pago':normalizeDdaStatus(value('SITUACAO')),schedule,document:text(value('DOCUMENTO')),bank:text(value('BANCO')),payer:text(value('PAGADOR')),checkedAt,provisionId:provisionId(value('DESCRITIVOPROVIS_x00c3_O'))};
 });
 const counts=new Map();
 for(const row of normalized)if(row.supplierCnpj)counts.set(row.supplierCnpj,(counts.get(row.supplierCnpj)||0)+1);
 return Object.freeze(normalized.map(row=>Object.freeze({...row,supplierDdaCount:row.supplierCnpj?counts.get(row.supplierCnpj):null})));
}
export function buildDdaReport(rows,{status='Em aberto',bank='',search='',settledProvisionIds}={},now=new Date()){
 const query=normalizeSearchText(search),today=ddaTodayKey(now);
 const seventhDay=new Date(Date.parse(today+'T12:00:00Z')+7*86400000).toISOString().slice(0,10);
 const openFilter=status==='Em aberto'||status==='Não pagos';
 const matchesStatus=row=>!status||(openFilter?isDdaOpenStatus(row.status):row.status===status);
 const filtered=rows.filter(row=>(matchesStatus(row)||(openFilter&&ddaSettlementPending(row,settledProvisionIds)))&&(!bank||row.bank===bank)&&(!query||includesSearchText(normalizeSearchText([row.id,row.supplier,row.document,row.bank].join(' ')),query)))
  .sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||Number(a.id)-Number(b.id));
 const inStatus=filtered.filter(matchesStatus);
 const missingAmounts=inStatus.filter(row=>row.amount==null).length;
 const dueToday=inStatus.filter(row=>row.due===today);
 const dueWithin7Days=inStatus.filter(row=>row.due&&row.due>=today&&row.due<=seventhDay);
 const totalAmount=items=>items.some(row=>row.amount==null)?null:items.reduce((sum,row)=>sum.plus(row.amount),new Money(0)).toFixed(2);
 return {rows:filtered,total:totalAmount(inStatus),missingAmounts,visibleOutsideStatus:filtered.length-inStatus.length,
  overdue:inStatus.filter(row=>row.due&&row.due<today).length,today:dueToday.length,
  dueWithin7Days:dueWithin7Days.length,totalDueWithin7Days:totalAmount(dueWithin7Days),totalDueToday:totalAmount(dueToday),
  statuses:[...new Set(['Em aberto','Não pagos',...rows.map(row=>row.status)])].sort((a,b)=>a.localeCompare(b,'pt-BR')),
  banks:[...new Set(rows.map(row=>row.bank).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'))};
}
