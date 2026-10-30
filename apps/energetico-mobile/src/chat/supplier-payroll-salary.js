import Decimal from 'decimal.js';

const identity=value=>typeof value==='string'?value.trim().normalize('NFC').toLocaleLowerCase('pt-BR'):'';
const cargoKey=value=>identity(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
const sourceId=value=>/^[1-9]\d{0,14}$/.test(String(value??''))?String(value):'';
function day(value){
 if(typeof value!=='string')return '';
 let text=value.trim();const br=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
 if(br)text=`${br[3]}-${br[2]}-${br[1]}`;
 if(!/^\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?)?$/.test(text))return '';
 const parsed=new Date(text.slice(0,10)+'T12:00:00Z');
 return Number(text.slice(0,4))>0&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===text.slice(0,10)?text.slice(0,10):'';
}
function monthEnd(month){
 if(typeof month!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month)||Number(month.slice(0,4))<1)return '';
 const [year,m]=month.split('-').map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
 return `${month}-${[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1]}`;
}
function salaryCents(value){
 if(typeof value!=='number'&&typeof value!=='string')return null;
 if(typeof value==='number'&&!Number.isFinite(value))return null;
 let raw=String(value).trim().replace(/^R\$\s*/,'');
 if(!/^(?:\d+(?:[.,]\d+)?|\d{1,3}(?:\.\d{3})+(?:,\d+)?)$/.test(raw))return null;
 if(typeof value==='string'&&/^\d{1,3}\.\d{3}$/.test(raw)&&!String(value).trim().startsWith('R$'))return null;
 if(raw.includes(','))raw=raw.replace(/\./g,'').replace(',','.');
 else if(typeof value==='string'&&/^\d{1,3}(?:\.\d{3})+$/.test(raw))raw=raw.replace(/\./g,'');
 const cents=new Decimal(raw).mul(100).toDecimalPlaces(0,Decimal.ROUND_HALF_UP);
 return cents.gt(0)&&cents.lte(Number.MAX_SAFE_INTEGER)?cents.toNumber():null;
}
function index(rows,key){
 const result=new Map();
 for(const row of rows){const id=key(row);if(!id)continue;const found=result.get(id)||[];found.push(row);result.set(id,found);}
 return result;
}

/** Read-only RH origin-ID -> cargo -> effective monthly salary. Never match a profession or fuzzy name. */
export function buildPayrollSalaryExpectations({sheets,suppliers,employees,salaries}){
 if([sheets,suppliers,employees,salaries].some(rows=>!Array.isArray(rows)))throw new TypeError('Fontes completas de salário obrigatórias.');
 const vendors=index(suppliers,row=>identity(row.supplier)),people=index(employees,row=>sourceId(row.supplierId)),rates=index(salaries,row=>cargoKey(row.cargo));
 return Object.freeze(Object.fromEntries(sheets.map(sheet=>{
  const end=monthEnd(sheet.month),matches=vendors.get(identity(sheet.supplier))||[];
  let value=null;
  if(end&&matches.length===1){
   const supplierId=sourceId(matches[0].id),rh=people.get(supplierId)||[];
   if(supplierId&&rh.length===1&&cargoKey(rh[0].cargo)){
    const history=rates.get(cargoKey(rh[0].cargo))||[],dates=history.map(rate=>({rate,date:day(rate.effectiveDate)}));
    // An invalid reference could belong to the requested month; never guess its position.
    if(dates.every(entry=>entry.date)){
     const eligible=dates.filter(entry=>entry.date<=end).sort((a,b)=>b.date.localeCompare(a.date));
     if(eligible.length&&eligible.filter(entry=>entry.date===eligible[0].date).length===1)value=salaryCents(eligible[0].rate.salary);
    }
   }
  }
  return [sheet.id,value];
 })));
}

/** Multiple sheets for the same month represent one monthly expected salary. */
export function expectedPayrollSalaryForSheets(sheets,expectations){
 const months=new Map();let total=new Decimal(0);
 for(const sheet of sheets){
  const cents=expectations?.[sheet.id];
  if(!monthEnd(sheet.month)||!Number.isSafeInteger(cents)||cents<0)return null;
  if(months.has(sheet.month)&&months.get(sheet.month)!==cents)return null;
  months.set(sheet.month,cents);
 }
 if(!months.size)return null;
 for(const cents of months.values())total=total.plus(cents);
 return total.lte(Number.MAX_SAFE_INTEGER)?total.toNumber():null;
}
