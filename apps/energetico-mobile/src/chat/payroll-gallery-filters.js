const COLUMNS = {
  IDFOLHA: ['id', 'FORNECEDOR', 'MESREFERENCIA'],
  FOLHAPGTO: ['id', 'FORNECEDOR', 'TIPOPGTO', 'VALORUNITARIO', 'QTD', 'DATA', 'IDFOLHA', 'IDLANCAMENTO'],
};
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
function numeric(value) {
  let raw = String(value ?? '').trim().replace(/R\$|\s/g, '');
  if (!raw) return NaN;
  if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
  return /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : NaN;
}
function day(value) {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const key = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : br ? `${br[3]}-${br[2]}-${br[1]}` : '';
  const date = key && new Date(`${key}T12:00:00Z`);
  return date && Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === key ? key : '';
}
export function validatePayrollFilters(gallery, filters = {}) {
  const columns = COLUMNS[gallery];
  if (!columns || !filters || typeof filters !== 'object' || Array.isArray(filters)) throw new RangeError('Filtros da galeria inválidos.');
  const allowed = new Set(['search', ...columns, 'VALORUNITARIOmin', 'VALORUNITARIOmax', 'QTDmin', 'QTDmax', 'DATAfrom', 'DATAto']);
  for (const [key,value] of Object.entries(filters)) {
    if (!allowed.has(key) || (gallery === 'IDFOLHA' && !['search',...columns].includes(key))
      || typeof value !== 'string' || value.length > 500) throw new RangeError('Filtro da galeria inválido.');
    if (!value) continue;
    if (['id','IDFOLHA','IDLANCAMENTO'].includes(key) && !/^\d+$/.test(value)) throw new RangeError('Informe um ID numérico no filtro.');
    if (/min$|max$/.test(key) && !Number.isFinite(numeric(value))) throw new RangeError('Informe um número válido no filtro.');
    if (/from$|to$/.test(key) && !day(value)) throw new RangeError('Informe uma data válida no filtro.');
  }
  for (const field of ['VALORUNITARIO','QTD']) if (filters[`${field}min`] && filters[`${field}max`]
    && numeric(filters[`${field}min`]) > numeric(filters[`${field}max`])) throw new RangeError('O mínimo do filtro deve ser menor ou igual ao máximo.');
  if (filters.DATAfrom && filters.DATAto && day(filters.DATAfrom) > day(filters.DATAto)) throw new RangeError('A data inicial deve ser anterior ou igual à final.');
}
export function filterPayrollRows(gallery, rows, filters = {}) {
  validatePayrollFilters(gallery, filters);
  const terms = fold(filters.search).split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const searchable = COLUMNS[gallery].filter(key=>!['VALORUNITARIO','QTD'].includes(key)).map(key => {
      if (key === 'DATA') { const value=day(row[key]); return `${row[key] ?? ''} ${value ? value.split('-').reverse().join('/') : ''}`; }
      return row[key] ?? '';
    }).join(' ');
    if (!terms.every(term => fold(searchable).includes(term))) return false;
    for (const key of COLUMNS[gallery]) {
      if (!filters[key]) continue;
      if (['id','IDFOLHA','IDLANCAMENTO'].includes(key) ? numeric(row[key]) !== numeric(filters[key]) : fold(row[key]) !== fold(filters[key])) return false;
    }
    for (const key of ['VALORUNITARIO','QTD']) {
      const value=numeric(row[key]);
      if (filters[`${key}min`] && (!Number.isFinite(value) || value < numeric(filters[`${key}min`]))) return false;
      if (filters[`${key}max`] && (!Number.isFinite(value) || value > numeric(filters[`${key}max`]))) return false;
    }
    const date = day(row.DATA);
    if (filters.DATAfrom && (!date || date < day(filters.DATAfrom))) return false;
    if (filters.DATAto && (!date || date > day(filters.DATAto))) return false;
    return true;
  });
}
export function payrollFilterOptions(gallery, rows) {
  return Object.fromEntries((gallery === 'IDFOLHA' ? ['FORNECEDOR','MESREFERENCIA'] : ['FORNECEDOR','TIPOPGTO']).map(key =>
    [key, [...new Set(rows.map(row=>String(row[key] ?? '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}))]));
}
