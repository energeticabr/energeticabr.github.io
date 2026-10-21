import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { persistEntityRecord } from '../../../portal/forms/entity-submit.js';
import { createContractorEmploymentFixture as setup } from './helpers/contractor-employment-fixture.mjs';
const entity = { id: 'fornecedores', siteKey: 'personal' }, list = { id: 'FORNECEDORES' };
const tick = () => new Promise(resolve => setImmediate(resolve));
const edit = (f, fields, options = {}) => persistEntityRecord(f.repository, entity, list, { mode: 'edit', item: structuredClone(f.source), fields, ...options });

test('untracked legacy SIM supplier inactivation keeps old behavior without a prompt, RH creation or date writes', async () => {
  const f = setup();
  f.repository.getItemsPage = async (_site, target, query) => {
    assert.equal(target, 'FUNCIONARIOSRH'); assert.match(query, /IDFORNECEDORORIGEM eq '17'/); return { items: [], hasMore: false };
  };
  await edit(f, { STATUS: 'INATIVO', Title: 'Novo nome' });
  assert.deepEqual(f.writes, [{ list: 'FORNECEDORES', id: '17', fields: { STATUS: 'INATIVO', Title: 'Novo nome' }, eTag: '"1"' }]);
  assert.equal(f.target.fields.STATUS, 'ATIVO');
});
test('tracked inactivation checks the target admission and refuses missing, impossible and earlier discharge before writes', async () => {
  for (const date of ['', '2026-02-30', '2026-01-19']) {
    const f = setup(); assert.equal(f.source.fields.DATAADMISSAO, undefined);
    await assert.rejects(edit(f, { STATUS: 'INATIVO', ...(date ? { DATADESLIGAMENTO: date } : {}) }), /desligamento|admissão/i);
    assert.equal(f.writes.length, 0);
  }
});
test('tracked portal save writes source STATUS and other supplier edits, then target date/status, never source RH fields', async () => {
  const f = setup(), saved = await edit(f, { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-01-20', Title: 'Nome editado' });
  assert.deepEqual(f.writes.map(w => [w.list, w.id, w.eTag]), [['FORNECEDORES', '17', '"1"'], ['FUNCIONARIOSRH', '4', '"1"']]);
  assert.deepEqual(f.writes[0].fields, { STATUS: 'INATIVO', Title: 'Nome editado' });
  assert.deepEqual(f.writes[1].fields, { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-01-20' });
  assert.equal(saved.id, '17'); assert.equal(saved.fields.Title, 'Nome editado');
  assert.equal(f.target.fields.Title, 'Funcionário Exemplo'); assert.equal(f.target.fields.DATAADMISSAO, '2026-01-20');
});
test('cancelling a tracked portal discharge writes neither record', async () => {
  const f = setup(), dom = new JSDOM('<main></main>');
  try {
    const promise = edit(f, { STATUS: 'INATIVO' }, { document: dom.window.document }); await tick();
    assert.ok(dom.window.document.querySelector('[data-action="cancel-termination"]'));
    dom.window.document.querySelector('[data-action="cancel-termination"]').click();
    await assert.rejects(promise, e => e.name === 'AbortError'); assert.equal(f.writes.length, 0);
  } finally { dom.window.close(); }
});
test('tracked date picker uses RH admission and validates before synchronizing both statuses', async () => {
  const f = setup(), dom = new JSDOM('<main></main>'), doc = dom.window.document;
  try {
    const promise = edit(f, { STATUS: 'INATIVO' }, { document: doc }); await tick();
    const form = doc.querySelector('form'), date = form.querySelector('input');
    assert.equal(date.min, '2026-01-20'); date.value = '2026-01-19';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.match(doc.querySelector('[role="alert"]').textContent, /anterior à admissão/); assert.equal(f.writes.length, 0);
    date.value = '2026-01-21'; form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await promise;
    assert.deepEqual(f.writes[0].fields, { STATUS: 'INATIVO' }); assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-01-21');
    assert.equal(doc.querySelector('dialog'), null);
  } finally { dom.window.close(); }
});
test('tracked partial retry verifies the source and resumes only RH, without asking for another date', async () => {
  const f = setup(), selected = structuredClone(f.source), options = { mode: 'edit', item: selected, fields: { STATUS: 'INATIVO', DATADESLIGAMENTO: '2026-01-21' } };
  f.failTarget(true);
  await assert.rejects(persistEntityRecord(f.repository, entity, list, options), e => e.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
  f.failTarget(false);
  await persistEntityRecord(f.repository, entity, list, options);
  assert.deepEqual(f.writes.map(w => w.list), ['FORNECEDORES', 'FUNCIONARIOSRH', 'FUNCIONARIOSRH']);
  assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-01-21');
});
test('tracked portal source version changed during the date prompt is rejected without writes', async () => {
  const f = setup(), dom = new JSDOM('<main></main>'), doc = dom.window.document;
  try {
    const promise = edit(f, { STATUS: 'INATIVO' }, { document: doc }); await tick(); f.source.eTag = '"9"';
    doc.querySelector('input').value = '2026-01-21'; doc.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await assert.rejects(promise, /alterad|confer/i); assert.equal(f.writes.length, 0);
  } finally { dom.window.close(); }
});
test('tracked reactivation updates both statuses and clears only the RH termination', async () => {
  const f = setup(); f.target.fields.STATUS = f.source.fields.STATUS = 'INATIVO'; f.target.fields.DATADESLIGAMENTO = '2026-01-21';
  await edit(f, { STATUS: 'ATIVO' });
  assert.deepEqual(f.writes[0].fields, { STATUS: 'ATIVO' }); assert.equal(f.target.fields.STATUS, 'ATIVO'); assert.equal(f.target.fields.DATADESLIGAMENTO, null);
});
test('ambiguous or incomplete target lookup fails closed without any source scan or business write', async () => {
  for (const page of [{ items: [], hasMore: true }, { items: [{ id: '4' }, { id: '5' }], hasMore: false }]) {
    const f = setup(); f.repository.getItemsPage = async () => page;
    await assert.rejects(edit(f, { STATUS: 'INATIVO' }), /vínculo|confirmad/i); assert.equal(f.writes.length, 0);
  }
});
test('non-contractor edits and creates retain their original persistence path, never create an RH record', async () => {
  const writes = [], repository = {
    resolveList: async (_site, names) => { assert.deepEqual(names, ['FUNCIONARIOSRH']); return { status: 'resolved', id: 'FUNCIONARIOSRH' }; },
    getItemsPage: async () => ({ items: [], hasMore: false }),
    updateItem: async (...args) => { writes.push(args); return { id: '17' }; },
    createItem: async (...args) => { writes.push(args); return { id: '18' }; },
  };
  await persistEntityRecord(repository, entity, list, { mode: 'edit', item: { id: '17', eTag: '"1"', fields: { EMPREITEIRO: 'NÃO' } }, fields: { STATUS: 'INATIVO' } });
  await persistEntityRecord(repository, entity, list, { mode: 'create', fields: { EMPREITEIRO: 'SIM', STATUS: 'ATIVO', Title: 'Cadastro futuro' } });
  assert.deepEqual(writes[0][3], { STATUS: 'INATIVO' }); assert.equal(writes[1][1], 'FORNECEDORES'); assert.equal(writes.length, 2);
});

// The existing RH link, not an editable supplier classification, owns lifecycle validation.
for (const scenario of ['combined NO and inactive', 'NO in a previous edit']) {
  const prepare = async () => {
    const f = setup();
    if (scenario === 'NO in a previous edit') await edit(f, { EMPREITEIRO: 'NÃO' });
    return f;
  };
  const fields = () => ({ ...(scenario === 'combined NO and inactive' ? { EMPREITEIRO: 'NÃO' } : {}), STATUS: 'INATIVO' });
  test('tracked classification cannot bypass the discharge picker: ' + scenario, async () => {
    const f = await prepare(), dom = new JSDOM('<main></main>'), doc = dom.window.document;
    const sourceBefore = structuredClone(f.source), targetBefore = structuredClone(f.target), count = f.writes.length;
    try {
      const promise = edit(f, fields(), { document: doc }); await tick();
      const form = doc.querySelector('form'), date = doc.querySelector('input[type="date"]');
      assert.ok(form, 'a known RH link must request discharge even when EMPREITEIRO is NO');
      assert.equal(date.min, '2026-01-20'); assert.deepEqual(f.source, sourceBefore); assert.deepEqual(f.target, targetBefore);
      date.value = '2026-01-21'; form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      const saved = await promise;
      assert.equal(saved.id, '17'); assert.equal(f.source.fields.EMPREITEIRO, 'NÃO'); assert.equal(f.source.fields.STATUS, 'INATIVO');
      assert.equal(f.source.fields.DATAADMISSAO, undefined); assert.equal(f.source.fields.DATADESLIGAMENTO, undefined);
      assert.equal(f.target.fields.STATUS, 'INATIVO'); assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-01-21');
      assert.equal(f.target.fields.EMPREITEIRO, 'SIM', 'preserve the existing RH history instead of importing source fields');
      assert.deepEqual(f.writes.slice(count).map(w => [w.list, w.id, w.eTag]), [
        ['FORNECEDORES', '17', sourceBefore.eTag], ['FUNCIONARIOSRH', '4', targetBefore.eTag],
      ]);
      assert.deepEqual(f.writes[count].fields, fields(), 'keep the explicit EMPREITEIRO=NO user input');
    } finally { dom.window.close(); }
  });
  test('cancelling tracked NO discharge leaves both records unchanged: ' + scenario, async () => {
    const f = await prepare(), dom = new JSDOM('<main></main>');
    const sourceBefore = structuredClone(f.source), targetBefore = structuredClone(f.target), count = f.writes.length;
    try {
      const promise = edit(f, fields(), { document: dom.window.document }); await tick();
      const cancel = dom.window.document.querySelector('[data-action="cancel-termination"]');
      assert.ok(cancel); cancel.click(); await assert.rejects(promise, e => e.name === 'AbortError');
      assert.equal(f.writes.length, count); assert.deepEqual(f.source, sourceBefore); assert.deepEqual(f.target, targetBefore);
    } finally { dom.window.close(); }
  });
  for (const date of ['', '2026-01-19', '2026-02-30']) test('invalid tracked NO discharge prevents both writes: ' + scenario + ' ' + date, async () => {
    const f = await prepare(), sourceBefore = structuredClone(f.source), targetBefore = structuredClone(f.target), count = f.writes.length;
    await assert.rejects(edit(f, { ...fields(), DATADESLIGAMENTO: date }), /desligamento|admissão/i);
    assert.equal(f.writes.length, count); assert.deepEqual(f.source, sourceBefore); assert.deepEqual(f.target, targetBefore);
  });
  test('tracked NO partial inactivation retries only the same RH record: ' + scenario, async () => {
    const f = await prepare(), count = f.writes.length, selected = structuredClone(f.source);
    const options = { mode: 'edit', item: selected, fields: { ...fields(), DATADESLIGAMENTO: '2026-01-21' } };
    f.failTarget(true);
    await assert.rejects(persistEntityRecord(f.repository, entity, list, options), e => e.code === 'CONTRACTOR_EMPLOYMENT_PARTIAL');
    f.failTarget(false); await persistEntityRecord(f.repository, entity, list, options);
    assert.deepEqual(f.writes.slice(count).map(w => [w.list, w.id]), [['FORNECEDORES', '17'], ['FUNCIONARIOSRH', '4'], ['FUNCIONARIOSRH', '4']]);
    assert.equal(f.source.fields.EMPREITEIRO, 'NÃO'); assert.equal(f.source.fields.STATUS, 'INATIVO');
    assert.equal(f.target.fields.STATUS, 'INATIVO'); assert.equal(f.target.fields.DATADESLIGAMENTO, '2026-01-21');
  });
}
