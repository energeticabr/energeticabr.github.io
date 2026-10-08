import { galleryCases } from './gallery-create-cases.mjs';

export const refreshCases = galleryCases.filter(entry =>
  ['orders', 'tasks', 'payments', 'recurring', 'group', 'documents', 'IDFOLHA', 'FOLHAPGTO'].includes(entry.name));

export function refreshRow(entry, id = '901', marker = 'SINTETICO ANTERIOR', supplier = 'FORNECEDOR QA') {
  const status = entry.name === 'tasks' ? 'EM ATENDIMENTO' : entry.name === 'payments' ? 'PAGAMENTO PREVISTO' : 'ATIVO';
  const fields = { ID: id, Title: marker, GRUPO: marker, TAREFA: marker, OBS: marker,
    DESCRICAOPGTO: marker, 'NOTA FISCAL': marker, REFERENTE: supplier, FORNECEDOR: supplier, PESSOARELACIONADA: supplier,
    FILIAL: 'FILIAL QA', STATUS: status, MESREFERENCIA: '10/2026', TIPODOCUMENTO: marker,
    RECORRENCIA: 'Month', DATAINICIO: '2026-10-01', 'DATA PREVISTO PGTO': '2026-10-09' };
  return { id, fields, hasAttachments: false, attachmentCount: 0, ...fields,
    MESREFERENCIA: marker, TIPOPGTO: marker };
}

export function snapshot(entry, rows) {
  return { rows, gallery: entry.options?.gallery, page: 1, hasMore: false, nextCursor: null };
}

export function filterControl(root, entry) {
  return root.querySelector(entry.options?.gallery ? '[name="FORNECEDOR"]'
    : entry.name === 'group' ? '[data-filter-field="STATUS"]'
    : entry.name === 'documents' ? '[data-filter-field="FORNECEDOR"], [data-filter-field="PESSOARELACIONADA"]'
    : '[name="supplier"]');
}
