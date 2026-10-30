import { createRegistrationGalleryData } from '../../src/chat/registration-gallery-data.js';

/** In-memory SharePoint boundary only: the actual metadata/catalog/save pipeline runs. */
export function parentEditorFixture() {
  const records = { parents: [{ id: '7', eTag: 'p1', fields: { FILIAL: '001 — OBRA FICTÍCIA', FORNECEDOR: 'FORNECEDOR DEMONSTRAÇÃO',
    FORMAPGTO: 'PIX DEMONSTRAÇÃO', STATUS: 'PAGAMENTO PREVISTO', OBS: '  observação original  ', VALORTOTAL: '60', DATAPREVISTOPGTO: '2026-11-01T03:00:00Z' } }],
    children: ['11', '12'].map(id => ({ id, eTag: `c${id}`, fields: { DESCRITIVOPROVISAO: '7', FILIAL: '001 — OBRA FICTÍCIA',
      OBS: 'ANTIGA', STATUS: 'PAGAMENTO PREVISTO', VALORTOTAL: '30' } })) };
  const columns = ['FILIAL', 'FORNECEDOR', 'FORMAPGTO', 'STATUS', 'OBS'].map(name => ({ name, displayName: name,
    text: {}, ...(name === 'FILIAL' ? { required: true } : {}) }));
  columns.push({ name: 'VALORTOTAL', currency: {} }, { name: 'DATAPREVISTOPGTO', dateTime: { format: 'dateTime' } },
    { name: 'Title', text: {} }, { name: 'Modified', readOnly: true, dateTime: {} });
  const catalogs = { FILIAIS: { name: 'FILIAL', values: ['001 — OBRA FICTÍCIA', '002 — UNIDADE DE TESTE'] },
    FORNECEDORES: { name: 'CADASTRO', values: ['FORNECEDOR DEMONSTRAÇÃO', 'FORNECEDOR ALTERNATIVO'] },
    CADASTROCONTA: { name: 'CONTA', values: ['PIX DEMONSTRAÇÃO', 'CONTA FICTÍCIA'] } };
  const writes = [], reads = []; let failChild = false;
  const repository = {
    async resolveList(_site, aliases) { const alias = aliases[0]; return { status: 'resolved', id: catalogs[alias] ? alias : alias === 'DESCRITIVOPROVISAO' ? 'parents' : 'children' }; },
    async getColumns(_site, list) { return structuredClone(catalogs[list] ? [{ name: catalogs[list].name, text: {} }] :
      list === 'parents' ? columns : [...columns.filter(c => !['Title', 'Modified', 'VALORTOTAL'].includes(c.name)), { name: 'DESCRITIVOPROVISAO', text: {} }]); },
    async getItem(_site, list, id) { reads.push([list, id]); return structuredClone(records[list].find(row => row.id === id)); },
    async getItemsPage(_site, list) { return { items: structuredClone(catalogs[list] ? catalogs[list].values.map((value, i) => ({ id: String(i + 1), fields: { [catalogs[list].name]: value } })) : records[list]), hasMore: false }; },
    async updateItem(_site, list, id, fields, options) {
      if (failChild && list === 'children' && id === '12') { failChild = false; throw new Error('Sincronização fictícia indisponível'); }
      const row = records[list].find(row => row.id === id);
      if (row.eTag !== options.eTag) throw new Error('ETag fictícia mudou');
      writes.push({ list, id, fields: structuredClone(fields) }); Object.assign(row.fields, fields); row.eTag += 'n'; return structuredClone(row);
    },
  };
  return { records, writes, reads, repository, failNextChild() { failChild = true; },
    data: createRegistrationGalleryData({ kind: 'provisionDescription', repository }) };
}
