import {buildRhidAttendanceTable,isValidRhidReportDate} from './rhid-attendance-table.js';

export const rhidNameKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR').replace(/\s+/g,' ').trim();
export function isRhidReportMonth(value){return /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(String(value??''));}
export function rhidMonthDateBounds(month){
 if(!isRhidReportMonth(month))throw new TypeError('Selecione um mês e ano válidos para o período.');
 const [year,number]=month.split('-').map(Number);
 return {startDate:`${month}-01`,endDate:`${month}-${String(new Date(Date.UTC(year,number,0)).getUTCDate()).padStart(2,'0')}`};
}
export function isRhidReportDateRange(month,startDate,endDate){
 if(!isRhidReportMonth(month))return false;
 const bounds=rhidMonthDateBounds(month);
 return isValidRhidReportDate(startDate)&&isValidRhidReportDate(endDate)&&startDate>=bounds.startDate&&endDate<=bounds.endDate&&startDate<=endDate;
}
const hours=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;

export function buildRhidMonthlyReport({month,supplier,snapshot,startDate:requestedStart,endDate:requestedEnd}={}){
 const bounds=rhidMonthDateBounds(month),startDate=requestedStart??bounds.startDate,endDate=requestedEnd??bounds.endDate;
 if(!isRhidReportDateRange(month,startDate,endDate))throw new TypeError('Selecione datas válidas dentro do mês e em ordem para o período.');
 if(!supplier?.id||!rhidNameKey(supplier.name))throw new TypeError('Selecione um fornecedor válido.');
 if(snapshot?.month!==month||!Array.isArray(snapshot.rows)||!Array.isArray(snapshot.presentDates)||snapshot.partial||snapshot.truncated||snapshot.error||snapshot.aborted)throw new TypeError('Consulta mensal inválida ou incompleta. Atualize o app e tente novamente.');
 const identities=new Set(),dates=new Set();
 for(const row of snapshot.rows){
  const date=String(row?.DATA_REFERENCIA??'').slice(0,10);
  if(!row||typeof row!=='object'||!isValidRhidReportDate(date)||date.slice(0,7)!==month||!rhidNameKey(row.NOME_COLABORADOR))throw new TypeError('Dados mensais inválidos ou incompletos.');
  dates.add(date);
  if(rhidNameKey(row.NOME_COLABORADOR)!==rhidNameKey(supplier.name))continue;
  const personId=String(row.ID_PESSOA_RHID??'').trim();
  if(!personId)throw new TypeError('Não foi possível confirmar a identidade RHID deste fornecedor.');
  identities.add(personId);
 }
 if(identities.size>1)throw new TypeError('Identidade RHID ambígua: há pessoas diferentes com o mesmo nome. Corrija o cadastro antes de gerar.');
 if(snapshot.presentDates.some(date=>!isValidRhidReportDate(date)||date.slice(0,7)!==month||!dates.has(date)))throw new TypeError('Calendário mensal inconsistente ou incompleto. Atualize e tente novamente.');
 const identity=[...identities][0],matched=identity?snapshot.rows.filter(row=>String(row.ID_PESSOA_RHID??'').trim()===identity&&String(row.DATA_REFERENCIA).slice(0,10)>=startDate&&String(row.DATA_REFERENCIA).slice(0,10)<=endDate):[];
 const grouped=new Map();
 for(const row of matched){const date=String(row.DATA_REFERENCIA).slice(0,10);if(!grouped.has(date))grouped.set(date,[]);grouped.get(date).push(row);}
 const firstDay=Number(startDate.slice(-2)),dayCount=Number(endDate.slice(-2))-firstDay+1;
 let minutes=0,recordedDays=0,incompleteDays=0;
 const days=Array.from({length:dayCount},(_,index)=>{
  const date=`${month}-${String(firstDay+index).padStart(2,'0')}`;
  const table=buildRhidAttendanceTable(grouped.get(date)||[]),person=table.people[0];
  const slots=person?Object.values(person.slots).map(slot=>slot.effective||'—'):['—','—','—','—'];
  const recorded=Boolean(person&&(person.rawPunches.length||slots.some(time=>time!=='—')));
  const rawTotal=String(table.rows[0]?.at(-1)??'');
  const grossTotal=recorded&&/^\d+:\d{2}$/.test(rawTotal)&&slots.every(time=>time!=='—')?rawTotal:null;
  const grossMinutes=grossTotal===null?null:grossTotal.split(':').map(Number).reduce((value,part)=>value*60+part,0);
  const weekday=new Date(`${date}T00:00:00Z`).getUTCDay();
  const netMinutes=grossMinutes===null?null:Math.max(0,grossMinutes-(weekday>=1&&weekday<=4?30:15));
  const total=netMinutes===null?null:hours(netMinutes);
  if(recorded){recordedDays++;if(total===null)incompleteDays++;}
  if(netMinutes!==null)minutes+=netMinutes;
  const classifiedPunches=new Set(person?Object.values(person.slots).map(slot=>slot.rhid).filter(Boolean):[]);
  const unclassifiedPunches=person?.rawPunches.filter(time=>!classifiedPunches.has(time))||[];
  return {date,slots,total,recorded,adjusted:Boolean(person&&Object.values(person.slots).some(slot=>slot.adjustment)),issues:person?.issues||[],unclassifiedPunches};
 });
 return {month,startDate,endDate,supplier:{id:String(supplier.id),name:supplier.name},days,total:hours(minutes),recordedDays,incompleteDays};
}
