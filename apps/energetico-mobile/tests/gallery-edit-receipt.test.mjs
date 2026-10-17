import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryEditChanges } from '../src/ui/gallery-edit-receipt.js';

test('receipt includes cleared fields and false/zero without unchanged dates or numbers', () => {
  const context = { item: { fields: { DATA: '2026-10-17T03:00:00Z', QTD: '2.00', VALOR: 50, ATIVO: true, OBS: 'Apagar', SECRET: 'x', LOCK: 1 } }, columns: [
    { name: 'DATA', control: 'date' }, { name: 'QTD', control: 'number' },
    { name: 'VALOR', label: 'Valor', control: 'number' }, { name: 'ATIVO', control: 'checkbox' },
    { name: 'OBS', control: 'text' }, { name: 'SECRET', hidden: true }, { name: 'LOCK', readOnly: true },
  ] };
  assert.deepEqual(galleryEditChanges(context, { DATA: '2026-10-17', QTD: 2, VALOR: 0, ATIVO: false, OBS: '', SECRET: 'y', LOCK: 2 }), [
    { label: 'Valor', before: '50', after: '0' }, { label: 'ATIVO', before: 'Sim', after: 'Não' },
    { label: 'OBS', before: 'Apagar', after: '—' },
  ]);
});

test('relationships show their names and IDs while attachment changes include filenames', () => {
  const context = { item: { fields: { CLIENTELookupId: 1, CLIENTE: 'Cliente antigo' } }, columns: [{ name: 'CLIENTE', label: 'Cliente', control: 'lookup' }] };
  assert.deepEqual(galleryEditChanges(context, { CLIENTELookupId: 2 }, { CLIENTE: 'Cliente novo' }, { uploads: [{ name: 'novo.pdf' }], deletions: ['antigo.pdf'] }), [
    { label: 'Cliente', before: 'Cliente antigo (ID: 1)', after: 'Cliente novo (ID: 2)' },
    { label: 'Anexo adicionado', before: '—', after: 'novo.pdf' },
    { label: 'Anexo removido', before: 'antigo.pdf', after: 'Removido' },
  ]);
});

test('unchanged multi selections do not become changes because the order or wrapper differs', () => {
  const context = { item: { fields: { PESSOASLookupId: { results: [1, 2] } } }, columns: [{ name: 'PESSOAS', control: 'person' }] };
  assert.deepEqual(galleryEditChanges(context, { PESSOASLookupId: ['2', '1'] }), []);
});

test('currency comparisons ignore storage formatting and display reais', () => {
  const context = { item: { fields: { VALOR: '250.00' } }, columns: [{ name: 'VALOR', control: 'currency' }] };
  assert.deepEqual(galleryEditChanges(context, { VALOR: 250 }), []);
  assert.match(galleryEditChanges(context, { VALOR: 300 })[0].after, /R\$\s*300,00/);
});
