import assert from 'node:assert/strict';
import { createContractorEmploymentData } from '../../src/chat/contractor-employment-data.js';

// Only the external SharePoint boundary is simulated; data and view tests share the real service.
const row = (id, fields, eTag = '"1"') => ({ id, fields, eTag });
export function createContractorEmploymentFixture() {
  const source = row('17', { Title: 'Funcionário Exemplo', EMPREITEIRO: 'SIM', STATUS: 'ATIVO', CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', FILIAL: 'Obra A' });
  const target = row('4', { ...source.fields, IDFORNECEDORORIGEM: '17', ORIGEMCRIADOEM: '2026-01-01', ORIGEMAUTORJSON: '{"Title":"Autor Exemplo"}', field_6: 31 });
  const writes = [], pages = [];
  let targetFailure = false;
  const repository = {
    async resolveList(site, names) { assert.equal(site, 'personal'); return { status: 'resolved', id: names[0] }; },
    async getColumns() { return [{ name: 'Title', displayName: 'CADASTRO', text: {} }, { name: 'field_6', displayName: 'ENDEREÇO', number: {} }]; },
    async getItemsPage(site, list, query, options) {
      pages.push(options.cursor || 'first');
      return options.cursor ? { items: [structuredClone(target)], hasMore: false } :
        { items: [row('3', { Title: 'Outro Exemplo', STATUS: 'INATIVO', CARGO: 'SERVENTE DE PEDREIRO I', FILIAL: 'Obra B', IDFORNECEDORORIGEM: '18' })], hasMore: true, nextLink: 'page-two' };
    },
    async getItem(site, list, id) { const item = list === 'FORNECEDORES' ? source : target; assert.equal(id, item.id); return structuredClone(item); },
    async updateItem(site, list, id, fields, options) {
      writes.push({ list, id, fields, eTag: options.eTag });
      if (list === 'FUNCIONARIOSRH' && targetFailure) throw new Error('synthetic transport failure');
      const item = list === 'FORNECEDORES' ? source : target;
      assert.equal(options.eTag, item.eTag);
      Object.assign(item.fields, fields); item.eTag = '"' + (Number(item.eTag.replaceAll('"', '')) + 1) + '"'; return structuredClone(item);
    },
    async createItem() { assert.fail('Gallery must never create a supplier or a mirror'); },
  };
  return { data: createContractorEmploymentData({ repository }), source, target, writes, pages, repository, failTarget: value => { targetFailure = value; } };
}
