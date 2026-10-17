import test from 'node:test';
import assert from 'node:assert/strict';
import { createPayrollSourceReader } from '../src/chat/payroll-editor-policy.js';
import { summarizePayrollPayments, buildPayrollReportCsv } from '../src/chat/supplier-payroll-report-model.js';

function fixture() {
  const provision = { id: '41', fields: { IDFOLHA: '19', FORNECEDOR: 'Ana', TIPOPGTO: 'SALÁRIO', QTD: '2', VALORTOTAL: '100', FRETE: '10', PGTOAGENDADO: 'PENDENTE', DATAPGTOEFETUADO: null, DATAPREVISTOPGTO: '2026-10-09' } };
  const fields = { Title: 'APP-folha-provisao-41', IDFOLHA: 19, FORNECEDOR: 'Ana', TIPOPGTO: 'SALÁRIO', IDLANCAMENTO: null };
  const repository = {
    resolveList: async () => ({ status: 'resolved', id: 'provisions' }),
    getColumns: async () => Object.keys(provision.fields).map(name => ({ name, displayName: name })),
    getItem: async (_site, _list, id) => { assert.equal(id, '41'); return structuredClone(provision); },
  };
  return { provision, fields, repository, read: createPayrollSourceReader(repository, 'personal') };
}

test('provisão pendente aparece com seu valor, mas contribui zero na apuração; baixa atualiza a mesma linha', async () => {
  const f = fixture();
  const pending = await f.read(f.fields);
  assert.equal(pending.PGTOAGENDADO, 'PENDENTE'); assert.equal(pending.VALORUNITARIO, 100); assert.equal(pending.QTD, 2);
  assert.equal(pending.IDPROVISAO, '41');
  assert.equal(summarizePayrollPayments([{ unitValue: pending.VALORUNITARIO, quantity: pending.QTD, paymentStatus: pending.PGTOAGENDADO }]).totalCents, 0);
  f.provision.fields.DATAPGTOEFETUADO = '2026-10-12'; f.provision.fields.PGTOAGENDADO = 'PAGO';
  const paid = await f.read(f.fields);
  assert.equal(paid.PGTOAGENDADO, 'PAGO'); assert.equal(paid.DATA, '2026-10-12'); assert.equal(paid.IDPROVISAO, '41');
  assert.equal(summarizePayrollPayments([{ totalCents: paid.TOTALCENTAVOS, paymentStatus: paid.PGTOAGENDADO }]).totalCents, 21000);
});

test('agendamento sem data de pagamento não compensa e mudança de folha ou rubrica falha fechada', async () => {
  const f = fixture(); f.provision.fields.PGTOAGENDADO = 'AGENDADO';
  assert.equal((await f.read(f.fields)).PGTOAGENDADO, 'PENDENTE');
  f.provision.fields.IDFOLHA = '20'; await assert.rejects(f.read(f.fields), /folha|vínculo/i);
  f.provision.fields.IDFOLHA = '19'; f.provision.fields.TIPOPGTO = 'VALE REFEIÇÃO';
  await assert.rejects(f.read(f.fields), /rubrica|tipo|vínculo/i);
});

test('pagamento com data inválida ou provisão removida não vira um total pago falso', async () => {
  const f = fixture(); f.provision.fields.DATAPGTOEFETUADO = '2026-02-30';
  await assert.rejects(f.read(f.fields), /data/i);
  f.repository.getItem = async () => null; await assert.rejects(f.read(f.fields), /provisão/i);
});

test('chave exclusiva divergente do vínculo da provisão bloqueia apuração', async () => {
  const f = fixture(); f.fields.IDPROVISAO = '42';
  await assert.rejects(f.read(f.fields), /identificador exclusivo/);
});

test('apuração mantém pagamentos antigos e exclui somente provisões pendentes', () => {
  assert.deepEqual(summarizePayrollPayments([{ unitValue: 25, quantity: 2 }, { totalCents: 9000, paymentStatus: 'PENDENTE' }]), { totalCents: 5000, uncalculated: 0 });
});

test('CSV identifica a provisão pendente sem incluí-la nos totais pagos exportados', () => {
  const csv = buildPayrollReportCsv([{ supplier: 'Ana', sheets: [{ id: '19', month: '2026-10' }], rows: [
    { id: '51', payrollId: '19', type: 'SALÁRIO', totalCents: 21000, unitValue: 100, quantity: 2, paymentStatus: 'PENDENTE' },
  ] }]);
  assert.match(csv, /PENDENTE/); assert.match(csv, /TOTAL GERAL[^\r\n]*"0,00"/);
});
