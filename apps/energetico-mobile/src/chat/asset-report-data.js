import Decimal from 'decimal.js';
import { REGISTRATION_GALLERY_MODELS, registrationFieldKey as key, registrationNumber, registrationDateKey } from './registration-gallery-data.js';
import { createAcquisitionProgress } from './acquisition-progress.js';

const HISTORY = REGISTRATION_GALLERY_MODELS.assetLaunches;
const ASSET = REGISTRATION_GALLERY_MODELS.asset;
const validId = value => /^[1-9]\d{0,14}$/.test(String(value ?? ''));
const realColumns = columns => columns.filter(c => c?.name && c.computed !== true && !/^LinkTitle(?:NoMenu|2)?$/i.test(c.name));
const system = new Set(['id', 'html', 'attachments', 'contenttype', 'contenttypeid', 'author', 'editor', 'created', 'modified', 'appauthor', 'appeditor', 'complianceassetid', 'owshiddenversion', 'guid']);

export function createAssetReportData({ repository, siteKey = 'personal', assertSession = () => {} } = {}) {
  function check(signal) {
    assertSession();
    if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError');
  }
  async function contract(model, prefix, signal, progress) {
    check(signal);
    const list = await repository.resolveList(siteKey, model.aliases, { signal }); check(signal);
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${model.listName} não está disponível.`);
    progress.step(`${prefix}:list`);
    const raw = await repository.getColumns(siteKey, list.id, { signal }); check(signal);
    if (!Array.isArray(raw)) throw new Error(`Metadados inválidos de ${model.listName}.`);
    const columns = realColumns(raw), mapping = new Map();
    for (const label of model.fields.filter(label => !model.computedFields?.[label])) {
      const accepted = [label, ...(model.fieldAliases?.[label] || [])].map(key);
      const matches = columns.filter(c => [c.name, c.displayName].some(value => accepted.includes(key(value))));
      const names = [...new Set(matches.map(c => c.name))];
      if (names.length > 1 || names.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        || prefix === 'history' && label !== 'ID LANÇAMENTO' && names.length !== 1) {
        throw new Error(`A coluna ${label} da lista ${model.listName} não pôde ser comprovada ou está ambígua.`);
      }
      if (names.length === 1) mapping.set(label, names[0]);
    }
    if (prefix === 'history') {
      const link = columns.find(c => c.name === mapping.get('ID IMOBILIZADO'));
      if (!link?.number) throw new Error('A coluna ID IMOBILIZADO precisa ser numérica.');
    }
    progress.step(`${prefix}:schema`); return { id: list.id, columns, mapping };
  }
  function normalize(item, mapping) {
    if (!validId(item?.id) || !item?.fields || typeof item.fields !== 'object' || Array.isArray(item.fields)) throw new Error('Registro inválido no relatório do imobilizado.');
    return { id: String(item.id), fields: Object.fromEntries([...mapping].map(([label, name]) => [label, item.fields[name] ?? null])) };
  }
  function assetDetails(item, schema) {
    const labels = new Map([...schema.mapping].map(([label, name]) => [name, label]));
    const details = schema.columns.filter(c => !c.hidden && !c.readOnly && !system.has(key(c.name))).map(c => {
      const canonical = labels.get(c.name), label = ASSET.fieldLabels?.[canonical] || canonical || c.displayName || c.name;
      let type = ASSET.fieldTypes?.[canonical] || (c.currency ? 'currency' : c.dateTime ? 'date' : c.number ? 'number' : c.boolean ? 'boolean' : 'text');
      if (label.includes('%') && key(label).includes('depreciacao')) type = 'percentWhole';
      return { name: c.name, label, type, value: item.fields[c.name] ?? null };
    });
    for (const [label, value, type] of [
      ['Criado por', item.createdBy?.user?.displayName, 'text'], ['Criado', item.createdDateTime, 'datetime'],
      ['Modificado por', item.lastModifiedBy?.user?.displayName, 'text'], ['Modificado', item.lastModifiedDateTime, 'datetime'],
    ]) if (value) details.push({ name: label, label, value, type });
    return details;
  }
  async function readHistory(assetId, schema, signal, progress) {
    const link = schema.mapping.get('ID IMOBILIZADO');
    const query = `$select=id&$expand=fields&$filter=fields/${link} eq ${assetId}&$top=200`;
    const rows = new Map(), visited = new Set(); let cursor;
    for (let pageNumber = 1; pageNumber <= 1000; pageNumber++) {
      check(signal);
      const page = await repository.getItemsPage(siteKey, schema.id, query, { signal, pageNumber, maxPages: 1000,
        headers: { Prefer: 'HonorNonIndexedQueriesWarningMayFailRandomly' }, ...(cursor ? { cursor } : {}) }); check(signal);
      if (!Array.isArray(page?.items) || typeof page.hasMore !== 'boolean' || !page.hasMore && page.nextLink) throw new Error('A paginação do histórico está incompleta.');
      for (const item of page.items) {
        const row = normalize(item, schema.mapping);
        const linkedId = registrationNumber(row.fields['ID IMOBILIZADO']);
        if (!validId(linkedId)) throw new Error(`O histórico #${row.id} não contém vínculo ID IMOBILIZADO válido.`);
        if (String(linkedId) !== assetId) continue;
        for (const name of ['VALOR DEPRECIAÇÃO', 'VALOR RESIDUAL', '% DEPRECIAÇÃO']) {
          if (registrationNumber(row.fields[name]) == null) throw new Error(`O histórico #${row.id} tem ${name} inválido.`);
        }
        if (!registrationDateKey(row.fields['DATA DE DEPRECIAÇÃO'])) throw new Error(`O histórico #${row.id} tem data inválida.`);
        if (rows.has(row.id) && JSON.stringify(rows.get(row.id)) !== JSON.stringify(row)) throw new Error('O histórico mudou durante a paginação; tente novamente.');
        rows.set(row.id, row);
      }
      progress.report('history:items', { pages: pageNumber, records: rows.size, listName: HISTORY.listName });
      if (!page.hasMore) { progress.step('history:items'); return [...rows.values()]; }
      if (typeof page.nextLink !== 'string' || !page.nextLink || visited.has(page.nextLink)) throw new Error('O cursor da paginação do histórico é inválido ou repetido.');
      visited.add(page.nextLink); cursor = page.nextLink;
    }
    throw new Error('O histórico excedeu o limite de páginas; nenhum relatório parcial foi exibido.');
  }
  async function loadAssetReport(rawId, { signal, onProgress } = {}) {
    const assetId = String(rawId ?? '').trim();
    if (!validId(assetId)) throw new RangeError('O ID do imobilizado não é válido.');
    check(signal);
    if (['resolveList', 'getColumns', 'getItem', 'getItemsPage'].some(method => typeof repository?.[method] !== 'function')) throw new Error('A consulta do relatório não está disponível.');
    const progress = createAcquisitionProgress({ signal, onProgress }, ['asset:list', 'asset:schema', 'asset:item', 'history:list', 'history:schema', 'history:items'], assertSession);
    const [assetSchema, historySchema] = await Promise.all([contract(ASSET, 'asset', signal, progress), contract(HISTORY, 'history', signal, progress)]);
    const [item, history] = await Promise.all([
      repository.getItem(siteKey, assetSchema.id, assetId, '$select=id,createdBy,lastModifiedBy,createdDateTime,lastModifiedDateTime&$expand=fields', { signal }),
      readHistory(assetId, historySchema, signal, progress),
    ]); check(signal);
    if (String(item?.id) !== assetId) throw new Error('O cadastro não corresponde ao imobilizado solicitado ou foi removido.');
    const asset = normalize(item, assetSchema.mapping); asset.details = assetDetails(item, assetSchema);
    progress.step('asset:item');
    history.sort((a, b) => registrationDateKey(b.fields['DATA DE DEPRECIAÇÃO']).localeCompare(registrationDateKey(a.fields['DATA DE DEPRECIAÇÃO'])) || Number(b.id) - Number(a.id));
    const historyTotal = history.reduce((sum, row) => sum.plus(registrationNumber(row.fields['VALOR DEPRECIAÇÃO'])), new Decimal(0)).toDecimalPlaces(2).toNumber();
    check(signal); return Object.freeze({ assetId, asset, history: Object.freeze(history), historyTotal });
  }
  return Object.freeze({ loadAssetReport });
}
