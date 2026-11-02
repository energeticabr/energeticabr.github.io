import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAssetReportData } from '../src/chat/asset-report-data.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';

const col = (name, displayName, type = 'text', extra = {}) => ({ name, displayName, [type]: {}, ...extra });
const assetColumns = [col('ITEM', 'IMOBILIZADO'), col('FILIAL', 'FILIAL'), col('VALORESTIMADO', 'VALOR ESTIMADO', 'currency'),
  col('VALORRESIDUAL', 'VALOR RESIDUAL', 'currency'), col('N_x00da_MEROIMOBILIZADO', 'NÚMEROIMOBILIZADO'),
  col('OData__x0025_DEPRECIACAO', '% DEPRECIAÇÃO', 'text'), col('FUNCAO', 'FUNÇÃO'), col('HTML', 'HTML', 'text'),
  col('LinkTitle', 'IMOBILIZADO', 'text', { computed: true }), col('ID', 'ID', 'number', { readOnly: true })];
const historyColumns = [col('Title', 'IMOBILIZADO'), col('FILIAL', 'FILIAL'), col('_x0025__x0020_DEPRECIA_x00c7__x0', '% DEPRECIAÇÃO', 'number'),
  col('DATA_x0020_DE_x0020_DEPRECIA_x00', 'DATA DE DEPRECIAÇÃO', 'dateTime'), col('VALOR_x0020_DEPRECIA_x00c7__x00c', 'VALOR DEPRECIAÇÃO', 'currency'),
  col('VALOR_x0020_RESIDUAL', 'VALOR RESIDUAL', 'currency'), col('ID_x0020_IMOBILIZADO', 'ID IMOBILIZADO', 'number'), col('IDLANCAMENTO', 'ID LANÇAMENTO', 'number'),
  col('IDPEDIDO', 'NÚMERO DO PEDIDO', 'number'), col('LinkTitle', 'IMOBILIZADO', 'text', { computed: false })];
const history = (id, assetId = 96) => ({ id: String(id), fields: { Title: '', FILIAL: 'FILIAL DE TESTE',
  _x0025__x0020_DEPRECIA_x00c7__x0: 0.03, DATA_x0020_DE_x0020_DEPRECIA_x00: '2026-11-01T03:00:00Z',
  VALOR_x0020_DEPRECIA_x00c7__x00c: 0.1, VALOR_x0020_RESIDUAL: 4723.9, ID_x0020_IMOBILIZADO: assetId, IDLANCAMENTO: null } });
function fixture({ count = 275, failPage, cycle = false, missingLink = false, otherParent = false, ambiguous = false } = {}) {
  const calls = [];
  const rows = Array.from({ length: count }, (_, i) => history(i + 1, i === 0 ? 95 : 96));
  if (rows[1]) { rows[1].fields.IDLANCAMENTO = 4321; rows[1].fields.IDPEDIDO = 494; rows[1].fields.VALOR_x0020_DEPRECIA_x00c7__x00c = 0.2; }
  const repository = {
    async resolveList(_site, aliases) { calls.push(['resolve', aliases[0]]); return { status: 'resolved', id: aliases[0] }; },
    async getColumns(_site, list) {
      if (list === 'IMOBILIZADOS') return assetColumns;
      return historyColumns.filter(c => !missingLink || c.displayName !== 'ID IMOBILIZADO')
        .concat(ambiguous ? [col('OUTRO', 'ID IMOBILIZADO', 'number')] : []);
    },
    async getItem(site, list, id, query, options) {
      calls.push(['item', site, list, id, query, options]);
      return { id: otherParent ? '275' : id, createdBy: { user: { displayName: 'Autor de teste' } }, createdDateTime: '2025-01-01T12:00:00Z',
        fields: { ITEM: 'NOME ATUAL DO GUINCHO', FILIAL: 'FILIAL ATUAL', VALORESTIMADO: 5000, VALORRESIDUAL: '4.723,90',
          N_x00da_MEROIMOBILIZADO: 'PATRIMÔNIO TESTE', OData__x0025_DEPRECIACAO: '3', FUNCAO: 'IÇAMENTO', HTML: '<script>não exibir</script>' } };
    },
    async getItemsPage(site, list, query, options) {
      calls.push(['page', site, list, query, options]);
      if (options.pageNumber === failPage) throw new Error('Falha de página');
      const start = Number(options.cursor || 0), end = start + 100;
      return { items: rows.slice(start, end), hasMore: end < rows.length, nextLink: end < rows.length ? cycle ? '100' : String(end) : null };
    },
  };
  return { repository, calls, rows, data: createAssetReportData({ repository }) };
}

test('consulta cadastro por ID do bem e histórico completo por vínculo numérico comprovado, sem juntar por nome', async () => {
  const { data, calls } = fixture(); const result = await data.loadAssetReport('96');
  assert.equal(result.assetId, '96'); assert.equal(result.asset.id, '96');
  assert.equal(result.asset.fields.IMOBILIZADO, 'NOME ATUAL DO GUINCHO');
  assert.equal(result.history.length, 274); assert.equal(result.historyTotal, 27.5);
  assert.ok(result.history.every(row => row.fields['ID IMOBILIZADO'] === 96));
  assert.equal(result.history[0].id, '275');
  assert.equal(result.history.find(row => row.id === '2').fields['ID LANÇAMENTO'], 4321);
  assert.equal(result.history.find(row => row.id === '2').fields['NÚMERO DO PEDIDO'], 494);
  assert.equal(result.history.find(row => row.id === '3').fields['ID LANÇAMENTO'], null);
  const details = result.asset.details;
  assert.ok(details.some(field => field.label === 'FUNÇÃO' && field.value === 'IÇAMENTO'));
  assert.ok(details.some(field => field.label === '% DEPRECIAÇÃO' && field.type === 'percentWhole' && field.value === '3'));
  assert.ok(!details.some(field => /HTML|LinkTitle/i.test(field.name)));
  const pages = calls.filter(([kind]) => kind === 'page'); assert.equal(pages.length, 3);
  assert.ok(pages.every(call => call[3].includes('$filter=fields/ID_x0020_IMOBILIZADO eq 96')));
  assert.ok(pages.every(call => !call[3].includes("eq '96'")));
  assert.equal(calls.find(([kind]) => kind === 'item')[3], '96');
  assert.ok(!Object.keys(data).some(key => /save|create|delete|patch/i.test(key)));
});

test('as duas galerias carregam três páginas de histórico pela camada real SharePoint sem exceder os limites', async () => {
  for (const kind of ['asset', 'assetLaunches']) {
    const f = fixture({ count: 275 }), pages = [];
    const repository = createSharePointRepository({ async request(path) {
      const url = new URL(path, 'https://graph.microsoft.com/v1.0');
      if (path.includes('/columns')) return { value: path.includes('/IMOBILIZADOS/') ? assetColumns : historyColumns };
      if (path.includes('/items/96')) return f.repository.getItem('personal', 'IMOBILIZADOS', '96');
      if (path.includes('/LANCAMENTOSIMOBILIZADOS/items')) {
        pages.push(path);
        const start = Number(url.searchParams.get('$skiptoken') || 0);
        return { value: f.rows.slice(start, start + 100), ...(start + 100 < f.rows.length ? {
          '@odata.nextLink': `https://graph.microsoft.com/v1.0/sites/site-id/lists/LANCAMENTOSIMOBILIZADOS/items?$skiptoken=${start + 100}`,
        } : {}) };
      }
      if (path.includes('/lists')) return { value: ['IMOBILIZADOS', 'LANCAMENTOSIMOBILIZADOS'].map(name => ({ id: name, displayName: name, list: { template: 'genericList' } })) };
      return { id: 'site-id' };
    } }, { personal: { host: 'tenant.sharepoint.com', path: '/sites/test', readTransport: 'graph' } });
    const report = await createRegistrationGalleryData({ kind, repository }).loadAssetReport(96);
    assert.equal(report.history.length, 274); assert.equal(report.historyTotal, 27.5);
    assert.equal(report.assetId, '96'); assert.equal(pages.length, 3);
    assert.equal(report.history[0].id, '275');
    assert.ok(report.history.every(row => row.fields['ID IMOBILIZADO'] === 96));
  }
});

test('ordena competência antes do ID, conserva zero e cadastro sem depreciações', async () => {
  const f = fixture({ count: 3 });
  f.rows[1].fields.DATA_x0020_DE_x0020_DEPRECIA_x00 = '2026-12-01';
  f.rows[1].fields.VALOR_x0020_DEPRECIA_x00c7__x00c = 0;
  const result = await f.data.loadAssetReport(96);
  assert.deepEqual(result.history.map(row => row.id), ['2', '3']); assert.equal(result.historyTotal, 0.1);
  assert.deepEqual((await fixture({ count: 0 }).data.loadAssetReport(96)).history, []);
});

test('recusa histórico parcial, cursor repetido, vínculo ausente/ambíguo e cadastro de outro ID', async () => {
  await assert.rejects(fixture({ failPage: 2 }).data.loadAssetReport(96), /página/);
  await assert.rejects(fixture({ count: 400, cycle: true }).data.loadAssetReport(96), /pagina|cursor/i);
  await assert.rejects(fixture({ missingLink: true }).data.loadAssetReport(96), /ID IMOBILIZADO/);
  await assert.rejects(fixture({ ambiguous: true }).data.loadAssetReport(96), /ID IMOBILIZADO/);
  await assert.rejects(fixture({ otherParent: true }).data.loadAssetReport(96), /cadastro|solicitado/i);
});

test('não lê IDs inválidos, respeita cancelamento e sessão encerrada depois da resposta', async () => {
  const f = fixture();
  for (const id of ['', 0, '96 OR 1', '-2', '96.5']) await assert.rejects(f.data.loadAssetReport(id), /ID/);
  assert.equal(f.calls.length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.data.loadAssetReport(96, { signal: controller.signal }), /abort|cancel/i);
  let live = true;
  const repository = { ...f.repository, async getItem(...args) { const item = await f.repository.getItem(...args); live = false; return item; } };
  const data = createAssetReportData({ repository, assertSession() { if (!live) throw new Error('Sessão encerrada'); } });
  await assert.rejects(data.loadAssetReport(96), /Sessão encerrada/);
});

test('vínculo ausente no registro e nome físico inválido falham sem apresentar histórico vazio', async () => {
  const missing = fixture({ count: 2 }); missing.rows[1].fields.ID_x0020_IMOBILIZADO = null;
  await assert.rejects(missing.data.loadAssetReport(96), /vínculo|ID IMOBILIZADO/i);
  const invalid = fixture({ count: 2 });
  const getColumns = invalid.repository.getColumns;
  invalid.repository.getColumns = async (...args) => (await getColumns(...args)).map(c => c.displayName === 'ID IMOBILIZADO' ? { ...c, name: 'campo inválido' } : c);
  await assert.rejects(invalid.data.loadAssetReport(96), /coluna|ID IMOBILIZADO/i);
  assert.equal(invalid.calls.filter(([kind]) => kind === 'page').length, 0);
});

test('colunas opcionais de pedido e lançamento ausentes em metadados legados não inventam vínculos', async () => {
  const f = fixture({ count: 3 }), original = f.repository.getColumns;
  f.repository.getColumns = async (...args) => (await original(...args)).filter(c => !['IDPEDIDO', 'IDLANCAMENTO'].includes(c.name));
  const result = await f.data.loadAssetReport(96);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].fields['NÚMERO DO PEDIDO'], undefined);
});

test('as fábricas das duas galerias expõem o relatório sem habilitar edição no histórico', async () => {
  for (const kind of ['asset', 'assetLaunches']) {
    const f = fixture({ count: 0 }); const data = createRegistrationGalleryData({ kind, repository: f.repository });
    assert.equal(typeof data.loadAssetReport, 'function');
    assert.equal((await data.loadAssetReport(96)).asset.id, '96');
    if (kind === 'assetLaunches') { assert.equal(data.saveEditor, undefined); assert.equal(data.deleteItem, undefined); }
  }
});

test('tentar novamente recupera uma falha inicial de carregamento do serviço do relatório', () => {
  const code = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    import { createRegistrationGalleryData } from './src/chat/registration-gallery-data.js';
    let first = true;
    const hook = registerHooks({ resolve(specifier, context, next) {
      if (specifier === './asset-report-data.js' && first) { first = false; throw new Error('Chunk temporariamente offline'); }
      return next(specifier, context);
    } });
    const data = createRegistrationGalleryData({kind:'assetLaunches', repository:{
      resolveList(){throw new Error('Consulta recuperada');}, getColumns(){}, getItem(){}, getItemsPage(){}
    }});
    await assert.rejects(data.loadAssetReport(96), /Chunk temporariamente offline/);
    await assert.rejects(data.loadAssetReport(96), /Consulta recuperada/);
    hook.deregister();
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', code], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', windowsHide: true });
});
