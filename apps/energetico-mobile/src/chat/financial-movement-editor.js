import Decimal from 'decimal.js';
import { createRegistrationGalleryFilterData } from './registration-gallery-filter-data.js';

const FIELDS = ['INSTITUICAO', 'DESCRICAO', 'OPERACAO', 'VALOR'];
const SOURCES = Object.freeze({
  INSTITUICAO: Object.freeze({ kind: 'related', listName: 'INSTITUICAOEMISSORA', valueField: 'INSTITUICAOEMISSORA' }),
  DESCRICAO: Object.freeze({ kind: 'dependent', listName: 'CADASTRO INVESTIMENTO', valueField: 'DESCRICAO',
    dependsOn: [{ fieldName: 'INSTITUICAO', targetField: 'INSTITUICAO' }] }),
});

function amount(value) {
  const text = String(value ?? '').trim();
  if (text.includes(',') && !/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d+$/.test(text)) {
    throw new Error('Informe um valor válido maior que zero.');
  }
  const canonical = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text;
  if (!/^\d+(?:\.\d+)?$/.test(canonical)) throw new Error('Informe um valor válido maior que zero.');
  const number = new Decimal(canonical);
  if (!number.isFinite() || !number.gt(0)) throw new Error('Informe um valor válido maior que zero.');
  return number.toFixed().replace('.', ',');
}

/** Keep the existing editor's session, ETag, allowlist and mutation protections. */
export function createFinancialMovementEditor(base, { repository, siteKey = 'personal', assertSession = () => {} }) {
  const contexts = new WeakMap();
  const catalogs = createRegistrationGalleryFilterData({ repository, siteKey, kind: 'financial_movement' });
  async function choices(field, dependencies, signal) {
    if (field === 'DESCRICAO' && !String(dependencies?.INSTITUICAO || '').trim()) return [];
    return catalogs.loadFilterOptions(field, { filters: dependencies, signal, refresh: true });
  }
  return Object.freeze({
    deleteItem: base.deleteItem,
    async loadEditor(id, options = {}) {
      const original = await base.loadEditor(id, options);
      const columns = FIELDS.map(name => {
        const column = original.columns.find(c => c.name === name);
        if (!column?.editable || column.readOnly) throw new Error(`O campo ${name} não está disponível para edição.`);
        return Object.freeze({ ...column, required: true,
          ...(SOURCES[name] ? { control: 'select', choices: [],
            powerApps: { closed: true, optionSources: [SOURCES[name]] } } : {}),
          ...(name === 'VALOR' ? { control: 'currency' } : {}),
        });
      });
      const context = Object.freeze({ ...original, columns,
        item: Object.freeze({ ...original.item, fields: Object.freeze({ ...original.item.fields,
          VALOR: amount(original.item.fields.VALOR).replace(',', '.'),
        }) }),
        contract: Object.freeze({ ...original.contract, formColumns: columns }),
        async powerAppsOptionSearch(_column, source, term, dependencies, { signal } = {}) {
          const field = Object.keys(SOURCES).find(name => JSON.stringify(source) === JSON.stringify(SOURCES[name]));
          if (!field) throw new Error('A origem das opções financeiras não foi reconhecida.');
          const available = await choices(field, dependencies, signal);
          const query = String(term || '').toLocaleLowerCase('pt-BR');
          return available.filter(option => option.label.toLocaleLowerCase('pt-BR').includes(query));
        },
      });
      contexts.set(context, { original, saving: false });
      return context;
    },
    async saveEditor(context, fields, options = {}) {
      const state = contexts.get(context);
      if (!state || state.saving) throw new Error('Reabra a edição da movimentação ou aguarde a gravação atual.');
      if (!fields || typeof fields !== 'object' || Array.isArray(fields) || Object.keys(fields).some(name => !FIELDS.includes(name))) {
        throw new Error('Os campos não pertencem à movimentação financeira.');
      }
      state.saving = true;
      try {
        const merged = { ...state.original.item.fields, ...fields };
        for (const name of FIELDS) if (!String(merged[name] ?? '').trim()) throw new Error(`Informe ${name}.`);
        const institutions = await choices('INSTITUICAO', {}, options.signal);
        if (!institutions.some(o => o.value === merged.INSTITUICAO)) throw new Error('Selecione uma instituição cadastrada.');
        const descriptions = await choices('DESCRICAO', merged, options.signal);
        if (!descriptions.some(o => o.value === merged.DESCRICAO)) throw new Error('Selecione uma descrição cadastrada para esta instituição.');
        const normalized = amount(merged.VALOR);
        assertSession();
        const result = await base.saveEditor(state.original, { ...fields, VALOR: normalized }, options);
        contexts.delete(context);
        return result;
      } finally { state.saving = false; }
    },
  });
}
