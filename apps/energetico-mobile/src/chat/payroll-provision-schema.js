import { payrollKey } from './supplier-payroll.js';

/** Idempotent setup; no financial rows are created by this migration. */
export async function ensurePayrollProvisionSchema({ repository, graph, assertSession = () => {} }) {
  for (const definition of [
    { lists: ['PROVISÃO PGTOS', 'PROVISAO PGTOS', 'PROVISAO PAGAMENTOS'], name: 'IDFOLHA', unique: false,
      description: 'ID da folha vinculada. Vazio quando a provisão não pertence a uma folha.' },
    { lists: ['FOLHAPGTO'], name: 'IDPROVISAO', unique: true,
      description: 'ID da provisão vinculada. Único quando preenchido; vazio para pagamentos por lançamento.' },
    ...[['DESCRITIVOPROVISAO'],['PROVISÃO PGTOS','PROVISAO PGTOS','PROVISAO PAGAMENTOS']].map(lists => ({ lists,
      name: 'FOLHAOPERACAO', unique: true, text: true,
      description: 'Identificador exclusivo da linha do desdobramento, usado para recuperar envios sem duplicação.' })),
  ]) {
    assertSession();
    const list = await repository.resolveList('personal', definition.lists);
    assertSession();
    if (list?.status !== 'resolved' || !list.id) throw new Error(`A lista ${definition.lists[0]} não está disponível.`);
    const verify = columns => {
      const found = columns.filter(c => !c.computed && [c.name,c.displayName].some(name => payrollKey(name) === definition.name));
      if (!found.length) return false;
      if (found.length !== 1 || found[0].readOnly || found[0].hidden || found[0].required || !(found[0].number || found[0].text)
        || definition.text && !found[0].text
        || definition.unique && (found[0].enforceUniqueValues !== true || found[0].indexed !== true))
        throw new Error(`${definition.name} deve ser uma coluna opcional de número ou texto${definition.unique ? ', indexada e com valores exclusivos' : ''} em ${definition.lists[0]}.`);
      return true;
    };
    const columns = await repository.getColumns('personal', list.id); assertSession();
    if (verify(columns)) continue;
    const sites = await repository.resolveSites(); assertSession();
    const site = sites.personal;
    if (!site?.id || site.status === 'unavailable') throw new Error('O site das provisões não está disponível para criar IDFOLHA.');
    let failure;
    try {
      await graph.request(`/sites/${site.id}/lists/${encodeURIComponent(list.id)}/columns`, {
        method: 'POST', scopes: ['Sites.Manage.All'], body: { name: definition.name, displayName: definition.name,
          description: definition.description, ...(definition.unique ? { enforceUniqueValues: true } : {}),
          required: false, indexed: true, ...(definition.text ? { text: { maxLength:255 } } : { number: { decimalPlaces: 'none', minimum: 1 } }) },
      });
    } catch (error) { failure = error; }
    assertSession(); repository.clearCache();
    // A lost response or concurrent migration is successful only after a fresh read.
    const confirmed = await repository.getColumns('personal', list.id); assertSession();
    if (!verify(confirmed)) throw failure || new Error(`O SharePoint não confirmou a criação da coluna ${definition.name}.`);
  }
}
