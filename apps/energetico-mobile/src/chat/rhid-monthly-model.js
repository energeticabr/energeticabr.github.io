import {buildRhidAttendanceTable,isValidRhidReportDate} from './rhid-attendance-table.js';

export const rhidNameKey=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR').replace(/\s+/g,' ').trim();
export function isRhidReportMonth(value){return /^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(String(value??''));}
const hours=minutes=>`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;

export function buildRhidMonthlyReport({month,supplier,snapshot}={}){
 if(!isRhidReportMonth(month))throw new TypeError('Selecione um mês e ano válidos para o período.');
 if(!supplier?.id||!rhidNameKey(supplier.name))throw new TypeError('Selecione um fornecedor válido.');
 if(snapshot?.month!==month||!Array.isArray(snapshot.rows)||snapshot.partial||snapshot.truncated||snapshot.error)throw new TypeError('Consulta mensal inválida ou incompleta. Atualize o app e tente novamente.');
 const matched=[],identities=new Set();
 for(const row of snapshot.rows){
  const date=String(row?.DATA_REFERENCIA??'').slice(0,10);
  if(!row||typeof row!=='object'||!isValidRhidReportDate(date)||date.slice(0,7)!==month)throw new TypeError('Dados mensais inválidos ou incompletos.');
  if(rhidNameKey(row.NOME_COLABORADOR)!==rhidNameKey(supplier.name))continue;
  const personId=String(row.ID_PESSOA_RHID??'').trim();
  if(!personId)throw new TypeError('Não foi possível confirmar a identidade RHID deste fornecedor.');
  identities.add(personId);matched.push(row);
 }
 if(identities.size>1)throw new TypeError('Identidade RHID ambígua: há pessoas diferentes com o mesmo nome. Corrija o cadastro antes de gerar.');
 const grouped=new Map();
 for(const row of matched){const date=String(row.DATA_REFERENCIA).slice(0,10);if(!grouped.has(date))grouped.set(date,[]);grouped.get(date).push(row);}
 const [year,number]=month.split('-').map(Number),length=new Date(Date.UTC(year,number,0)).getUTCDate();
 let minutes=0,recordedDays=0,incompleteDays=0;
 const days=Array.from({length},(_,index)=>{
  const date=`${month}-${String(index+1).padStart(2,'0')}`;
  const table=buildRhidAttendanceTable(grouped.get(date)||[]),person=table.people[0];
  const slots=person?Object.values(person.slots).map(slot=>slot.effective||'—'):['—','—','—','—'];
  const recorded=Boolean(person&&(person.rawPunches.length||slots.some(time=>time!=='—')));
  const rawTotal=String(table.rows[0]?.at(-1)??'');
  const total=recorded&&/^\d+:\d{2}$/.test(rawTotal)&&slots.every(time=>time!=='—')?rawTotal:null;
  if(recorded){recordedDays++;if(total===null)incompleteDays++;}
  if(total!==null){const [h,m]=total.split(':').map(Number);minutes+=h*60+m;}
  return {date,slots,total,recorded,adjusted:Boolean(person&&Object.values(person.slots).some(slot=>slot.adjustment)),issues:person?.issues||[]};
 });
 return {month,supplier:{id:String(supplier.id),name:supplier.name},days,total:hours(minutes),recordedDays,incompleteDays};
}
