import assert from 'node:assert/strict';

/** Synthetic SharePoint transport shared by adapter and controller integration tests. */
export function createProvisionDueDateFixture() {
  const parentDue = 'field_17', childDue = 'field_23', link = 'field_9';
  const originalDate = '2026-10-12T03:00:00.000Z';
  const parent = { id: '42', eTag: '"p1"', fields: { [parentDue]: originalDate, FORNECEDOR: 'Fornecedor Exemplo', STATUS: 'PAGAMENTO PREVISTO', VALORTOTAL: '300' } };
  const children = [
    { id: '2', eTag: '"c2"', fields: { [link]: '42', [childDue]: originalDate, STATUS: 'PAGAMENTO PREVISTO', QTD: '1', VALORTOTAL: '50', FRETE: '0' } },
    { id: '42', eTag: '"c42"', fields: { [link]: '99', [childDue]: originalDate, STATUS: 'PAGAMENTO PREVISTO', QTD: '1', VALORTOTAL: '10', FRETE: '0' } },
    { id: '3', eTag: '"c3"', fields: { [link]: '42', [childDue]: originalDate, STATUS: 'PAGAMENTO PREVISTO', QTD: '1', VALORTOTAL: '250', FRETE: '0' } },
    { id: '77', eTag: '"c77"', fields: { [link]: '99', [childDue]: originalDate, STATUS: 'PAGAMENTO PREVISTO', QTD: '1', VALORTOTAL: '20', FRETE: '0' } },
  ];
  const writes = [], reads = [], pages = [];
  let failingChild = '', unconfirmedChild = '';
  const repository = {
    async resolveList(site, aliases) {
      assert.equal(site, 'personal');
      return { status: 'resolved', id: aliases[0] === 'DESCRITIVOPROVISAO' ? 'parents' : 'children' };
    },
    async getColumns(_site, list) {
      return [
        { name: list === 'parents' ? parentDue : childDue, displayName: 'DATA PREVISTO PGTO', dateTime: { format: 'dateTime' } },
        ...['STATUS', 'FORNECEDOR', 'VALORTOTAL', 'QTD', 'FRETE'].map(name => ({ name, displayName: name, text: {} })),
        ...(list === 'children' ? [{ name: link, displayName: 'DESCRITIVOPROVISAO', text: {} }] : []),
      ];
    },
    async getItem(_site, list, id) {
      reads.push([list, id]);
      const item = list === 'parents' ? parent : children.find(child => child.id === id);
      assert.equal(item?.id, id, 'only explicitly linked record identities may be read');
      return structuredClone(item);
    },
    async getItemsPage(_site, list, query, options = {}) {
      pages.push({ list, query, cursor: options.cursor });
      if (list === 'parents') return { items: [structuredClone(parent)], hasMore: false };
      return options.cursor
        ? { items: structuredClone(children.slice(2)), hasMore: false }
        : { items: structuredClone(children.slice(0, 2)), hasMore: true, nextLink: 'children-page-two' };
    },
    async listAttachments() { return []; },
    async downloadAttachment() { return new Blob(); },
    async updateItem(_site, list, id, fields, options) {
      const item = list === 'parents' ? parent : children.find(child => child.id === id);
      assert.equal(item?.id, id); assert.equal(options.eTag, item.eTag);
      writes.push({ list, id, fields: structuredClone(fields), eTag: options.eTag });
      if (list === 'children' && id === failingChild) throw new Error('synthetic child transport failure');
      if (!(list === 'children' && id === unconfirmedChild)) { Object.assign(item.fields, fields); item.eTag += 'n'; }
      return structuredClone(item);
    },
  };
  return { repository, parent, children, parentDue, childDue, link, writes, reads, pages, originalDate,
    failChild(id) { failingChild = id; }, leaveChildUnconfirmed(id) { unconfirmedChild = id; } };
}
