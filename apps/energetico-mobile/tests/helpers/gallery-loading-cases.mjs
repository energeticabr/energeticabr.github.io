import { refreshRow } from './gallery-refresh-cases.mjs';

// Valid rows under each gallery's normal defaults, including its searchable fields.
export function loadingRow(entry, id = '901') {
  const row = refreshRow(entry, id), marker = 'SINTETICO CARREGAMENTO QA';
  Object.assign(row.fields, {
    IMOBILIZADO: marker, FUNCAO: marker, GRUPOIMOBILIZADOS: marker,
    ETAPA: marker, ATIVIDADEEXECUTADA: marker, 'DESCRIÇÃO': marker,
    'CONCLUÍDO': 'ATIVIDADE CRIADA',
  });
  if (entry.name === 'stageDemonstratives') row.fields.STATUS = 'ATIVIDADE INICIADA';
  if (entry.name === 'constructionStages') Object.assign(row.fields, { STATUS: 'INICIADO', TIPO: 'ATIVIDADE COMUM' });
  if (entry.name === 'measurementLines') row.fields.STATUS = 'PENDENTE PGTO';
  return row;
}
