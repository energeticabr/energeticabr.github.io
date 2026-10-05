import Decimal from 'decimal.js';

export const CARGOS_FIELDS = ['CARGO','SALARIO','VALEALIMENTACAO','PREMIO','VALE TRANSPORTE'];
export const cargoKey = value => String(value ?? '').replace(/_x([0-9a-f]{4})_/gi,(_,hex)=>String.fromCodePoint(parseInt(hex,16))).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const ROLES = ['SERVENTE DE PEDREIRO I','SERVENTE DE PEDREIRO II','SERVENTE DE PEDREIRO III','PEDREIRO I','PEDREIRO II','PEDREIRO III','MESTRE DE OBRAS'];
export function cargosColumn(columns,label,required=true) {
  const matches=columns.filter(c=>cargoKey(c.name)===cargoKey(label)||cargoKey(c.displayName)===cargoKey(label));
  if(matches.length!==1){if(required||matches.length)throw new Error(`A coluna ${label} da lista CARGOS não pôde ser identificada.`);return null;}
  return matches[0].name;
}
export function parseCargosMoney(value) {
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
  if(typeof value!=='string')return null;
  let raw=value.trim().replace(/^R\$\s*/,'');
  if(/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw))raw=raw.replaceAll('.','').replace(',','.');
  else if(/^\d+(,\d{1,2})?$/.test(raw))raw=raw.replace(',','.');
  else if(!/^\d+\.\d{1,2}$/.test(raw))return null;
  const number=Number(raw);return Number.isFinite(number)?number:null;
}
function dateKey(value) {
  const raw=String(value??'').trim();
  if(!raw)return '';
  const iso=raw.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  if(!iso||!Number.isFinite(Date.parse(iso[1]))||new Date(iso[1]).toISOString().slice(0,10)!==iso[1])return null;
  return iso[1];
}
export function buildCargosTable(items,columns,today) {
  const names=CARGOS_FIELDS.map(label=>cargosColumn(columns,label));
  const reference=cargosColumn(columns,'DATAREFERENCIA',false);
  return ROLES.map(cargo=>{
    const rows=items.filter(item=>cargoKey(item.fields?.[names[0]])===cargoKey(cargo)).map(item=>{
      const date=reference?dateKey(item.fields?.[reference]):'';
      return {date,values:names.slice(1).map(name=>parseCargosMoney(item.fields?.[name]))};
    });
    const applicable=rows.filter(row=>row.date!==null&&(!row.date||row.date<=today));
    const newest=applicable.map(row=>row.date).sort().at(-1);
    const current=applicable.filter(row=>row.date===newest);
    const ambiguous=rows.some(row=>row.date===null)||new Set(current.map(row=>JSON.stringify(row.values))).size>1;
    const values=!ambiguous&&current.length?current[0].values:[null,null,null,null];
    const total=values.every(value=>value!==null)?values.reduce((sum,value)=>sum.plus(value),new Decimal(0)).toDecimalPlaces(2).toNumber():null;
    return {cargo,group:cargo.startsWith('SERVENTE')?'SERVENTE DE PEDREIRO':cargo.startsWith('PEDREIRO')?'PEDREIRO':'',salary:values[0],food:values[1],bonus:values[2],transport:values[3],total,reference:newest||''};
  });
}
