export const MEAL_VOUCHER_CONTROL_COLUMN = 'VALECONTROLE';

export function mealVoucherControlColumn(columns) {
  const matches = columns.filter(c => c.name === MEAL_VOUCHER_CONTROL_COLUMN);
  if (!matches.length) return null;
  const c = matches[0];
  if (matches.length !== 1 || !c.hidden || c.readOnly || c.required || c.calculated || c.computed
    || !c.text?.allowMultipleLines || c.text.appendChangesToExistingText === true || c.text.textType === 'richText')
    throw new Error('VALECONTROLE deve ser texto simples multilinha, oculto, opcional e sem anexar alterações ao texto.');
  return c;
}

/** Schema setup only: never creates orders, launches or payroll records. */
export async function ensureMealVoucherSchema({ repository, graph, assertSession = () => {}, siteKey = 'personal' }) {
  assertSession();
  const list = await repository.resolveList(siteKey, ['NOTASPENDENTES']); assertSession();
  if (list?.status !== 'resolved' || !list.id) throw new Error('A lista NOTASPENDENTES não está disponível.');
  if (mealVoucherControlColumn(await repository.getColumns(siteKey, list.id, { includeHidden:true }))) { assertSession(); return; }
  assertSession(); const sites = await repository.resolveSites(); assertSession();
  const site = sites[siteKey];
  if (!site?.id || site.status === 'unavailable') throw new Error('O site do controle técnico do vale não está disponível.');
  let failure;
  try {
    await graph.request(`/sites/${site.id}/lists/${encodeURIComponent(list.id)}/columns`, {
      method:'POST', scopes:['Sites.Manage.All'], body:{ name:MEAL_VOUCHER_CONTROL_COLUMN, displayName:MEAL_VOUCHER_CONTROL_COLUMN,
        description:'Controle técnico de operações e revisões do vale-alimentação. Não editar manualmente.', hidden:true, required:false,
        text:{ allowMultipleLines:true, appendChangesToExistingText:false, textType:'plain' } },
    });
  } catch (cause) { failure = cause; }
  assertSession(); repository.clearCache();
  const confirmed = await repository.getColumns(siteKey, list.id, { includeHidden:true }); assertSession();
  if (!mealVoucherControlColumn(confirmed)) throw failure || new Error('O SharePoint não confirmou VALECONTROLE. Nenhum registro financeiro foi criado.');
}
