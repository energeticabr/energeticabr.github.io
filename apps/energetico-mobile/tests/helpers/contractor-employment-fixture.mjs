import assert from 'node:assert/strict';
import { createContractorEmploymentData } from '../../src/chat/contractor-employment-data.js';
import { memoryStorage } from './contractor-employment-transport.mjs';

// Only the external SharePoint boundary is simulated; data and view tests share the real service.
const row = (id, fields, eTag = '"1"') => ({ id, fields, eTag });
export function createContractorEmploymentFixture() {
  const source = row('17', { Title: 'Fornecedor — não copiar', EMPREITEIRO: 'SIM', STATUS: 'ATIVO', FILIAL: 'Outra filial' });
  const target = row('4', { Title: 'Funcionário Exemplo', EMPREITEIRO: 'SIM', STATUS: 'ATIVO', CARGO: 'PEDREIRO III', DATAADMISSAO: '2026-01-20', DATADESLIGAMENTO: null, FILIAL: 'Obra A', IDFORNECEDORORIGEM: '17', Created: '2026-01-01', Author: 'Autor Exemplo', field_6: 31 });
  const writes = [], pages = [], reads = [], resolved = [];
  let targetFailure = false;
  const repository = {
    getLifecycleContext: () => ({ storage, accountKey: 'synthetic-account', siteIdentity: 'synthetic-site' }),
    async resolveList(site, names) { assert.equal(site, 'personal'); resolved.push(names[0]); return { status: 'resolved', id: names[0] }; },
    async getColumns(_site, list) { assert.equal(list, 'FUNCIONARIOSRH', 'never inspect source schema'); return [{ name: 'Title', displayName: 'CADASTRO', text: {} }, { name: 'field_6', displayName: 'ENDEREÇO', number: {} }]; },
    async getItemsPage(site, list, query, options) {
      assert.equal(list, 'FUNCIONARIOSRH', 'never scan existing suppliers');
      pages.push(options.cursor || 'first');
      if (query.includes('$filter=')) return { items: [structuredClone(target)], hasMore: false };
      return options.cursor ? { items: [structuredClone(target)], hasMore: false } :
        { items: [row('3', { Title: 'Outro Exemplo', STATUS: 'INATIVO', CARGO: 'SERVENTE DE PEDREIRO I', FILIAL: 'Obra B', IDFORNECEDORORIGEM: '18' })], hasMore: true, nextLink: 'page-two' };
    },
    async getItem(site, list, id, query) { reads.push([list, id, query]); const item = list === 'FORNECEDORES' ? source : target; assert.equal(id, item.id); return structuredClone(item); },
    async updateItem(site, list, id, fields, options) {
      writes.push({ list, id, fields, eTag: options.eTag });
      if (list === 'FUNCIONARIOSRH' && targetFailure) throw new Error('synthetic transport failure');
      const item = list === 'FORNECEDORES' ? source : target;
      if (list === 'FORNECEDORES') for (const name of ['CARGO', 'DATAADMISSAO', 'DATADESLIGAMENTO']) assert.ok(!(name in fields), 'RH-only field in source PATCH: ' + name);
      assert.equal(options.eTag, item.eTag);
      Object.assign(item.fields, fields); item.eTag = '"' + (Number(item.eTag.replaceAll('"', '')) + 1) + '"'; return structuredClone(item);
    },
    async createItem() { assert.fail('Gallery must never create a supplier or a mirror'); },
  };
  const storage = memoryStorage();
  const context = { storage, accountKey: 'synthetic-account', siteIdentity: 'synthetic-site' };
  return { data: createContractorEmploymentData({ repository, ...context }), source, target, writes, pages, reads, resolved, repository, storage, context, failTarget: value => { targetFailure = value; } };
}
