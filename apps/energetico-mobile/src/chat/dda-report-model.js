import Decimal from 'decimal.js';
import {REGISTRATION_GALLERY_MODELS,registrationRawField,registrationDateKey,registrationNumber} from './registration-gallery-data.js';
import {ddaTodayKey} from '../ui/dda-card.js';
import {ddaPaidManually} from './dda-payment-confirmation.js';
const Money=Decimal.clone({precision:40});
export const ddaSearchKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const text=value=>typeof value==='string'||typeof value==='number'?String(value).trim():'';
function supplierCnpj(value){
 const key=text(value).toUpperCase().replace(/[\s./-]/g,'');
 // An opaque identity key, not a tax-document validation or name-based guess.
 return /^[A-Z0-9]{14}$/.test(key)&&!/^([A-Z0-9])\1+$/.test(key)?key:null;
}
function status(value){
 const label=text(value),key=ddaSearchKey(label).replace(/\s+/g,' ');
 return ({'em aberto':'Em aberto',agendado:'Agendado',pago:'Pago','pago (liquidado)':'Pago',liquidado:'Pago',baixado:'Baixado','nao confirmado':'Não confirmado'})[key]||label||'Não informado';
}
export function normalizeDdaReportRows(snapshot){
 if(!Array.isArray(snapshot?.rows)||snapshot.hasMore===true||snapshot.complete===false)throw new TypeError('Consulta DDA incompleta.');
 const ids=new Set();
 const normalized=snapshot.rows.map(row=>{
  const id=text(row?.id);if(!/^\d+$/.test(id)||!row?.fields||typeof row.fields!=='object'||Array.isArray(row.fields)||ids.has(Number(id)))throw new TypeError('Registro DDA inválido.');ids.add(Number(id));
  const value=name=>registrationRawField(row.fields,name,REGISTRATION_GALLERY_MODELS.dda),number=registrationNumber(value('VALOR'));
  const amount=number!=null&&number>=0&&number<=Number.MAX_SAFE_INTEGER/100?new Money(number).toDecimalPlaces(2).toFixed(2):null;
  return {id,key:text(value('CHAVE_DDA')),paidManually:ddaPaidManually(value('PGTO_CONFIRMADO')),confirmedAt:text(value('PGTO_CONFIRMADO_EM')),supplier:text(value('FORNECEDOR'))||'Fornecedor não informado',supplierCnpj:supplierCnpj(value('CNPJ_FORNECEDOR')),due:registrationDateKey(value('VENCIMENTO')),amount,status:status(value('SITUACAO')),document:text(value('DOCUMENTO')),bank:text(value('BANCO')),payer:text(value('PAGADOR')),checkedAt:text(value('ULTIMA_CONSULTA'))};
 });
 const counts=new Map();
 for(const row of normalized)if(row.supplierCnpj)counts.set(row.supplierCnpj,(counts.get(row.supplierCnpj)||0)+1);
 return Object.freeze(normalized.map(row=>Object.freeze({...row,supplierDdaCount:row.supplierCnpj?counts.get(row.supplierCnpj):null})));
}
export function buildDdaReport(rows,{status='Em aberto',bank='',search=''}={},now=new Date()){
 const query=ddaSearchKey(search),today=ddaTodayKey(now);
 const filtered=rows.filter(row=>(!status||(status==='Não pagos'?['Em aberto','Agendado'].includes(row.status):row.status===status))&&(!bank||row.bank===bank)&&(!query||ddaSearchKey([row.id,row.supplier,row.document,row.bank].join(' ')).includes(query)))
  .sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||Number(a.id)-Number(b.id));
 const missingAmounts=filtered.filter(row=>row.amount==null).length;
 return {rows:filtered,total:missingAmounts?null:filtered.reduce((sum,row)=>sum.plus(row.amount),new Money(0)).toFixed(2),missingAmounts,
  overdue:filtered.filter(row=>row.due&&row.due<today).length,today:filtered.filter(row=>row.due===today).length,
  statuses:[...new Set(['Em aberto','Não pagos',...rows.map(row=>row.status)])].sort((a,b)=>a.localeCompare(b,'pt-BR')),
  banks:[...new Set(rows.map(row=>row.bank).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'))};
}
