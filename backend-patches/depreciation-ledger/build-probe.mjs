import { HISTORY_ACTION } from './build-flow.mjs';

// Run the actual production expressions with fictitious items and Compose
// outputs in place of every external write. No SharePoint connector is present.
export function buildReadOnlyProbe(definition) {
  const original = definition.actions.Apply_to_each.actions;
  const fixtures = [
    { ID: 990001, ITEM: 'TESTE A', FILIAL: 'FILIAL FICTÍCIA', OData__x0025_DEPRECIACAO: '3', VALORRESIDUAL: '1000,00', DATADEPRECIA_x00c7__x00c3_O: '2026-11-01T03:00:00Z' },
    { ID: 990002, ITEM: '', FILIAL: 'FILIAL FICTÍCIA', OData__x0025_DEPRECIACAO: '2', VALORRESIDUAL: '4.338,02', DATADEPRECIA_x00c7__x00c3_O: '2026-03-01T03:00:00Z' },
    { ID: 990003, ITEM: 'TESTE ZERO', FILIAL: 'FILIAL FICTÍCIA', OData__x0025_DEPRECIACAO: '3', VALORRESIDUAL: '0,00', DATADEPRECIA_x00c7__x00c3_O: '2026-11-01T03:00:00Z' },
  ];
  const cloneCompose = name => ({ type: 'Compose', inputs: structuredClone(original[name].inputs), runAfter: structuredClone(original[name].runAfter || {}) });
  const actions = {
    Compose_3: { type: 'Compose', inputs: 'read-only runtime verification', runAfter: {} },
    Compose: cloneCompose('Compose'), Compose_1: cloneCompose('Compose_1'), Compose_2: cloneCompose('Compose_2'),
    Create_item: { type: 'Compose', runAfter: { Compose_2: ['Succeeded'] }, inputs: { body: { ID: "@add(int(items('Apply_to_each')?['ID']), 1000000)" } } },
    Compose_4: { type: 'Compose', inputs: {}, runAfter: { Create_item: ['Succeeded'] } },
    Compose_5: { type: 'Compose', inputs: 'report unchanged in production', runAfter: { Compose_4: ['Succeeded'] } },
    [HISTORY_ACTION]: { type: 'Compose', runAfter: { Compose_5: ['Succeeded'] }, inputs: structuredClone(original[HISTORY_ACTION].inputs.parameters) },
    Update_item: { type: 'Compose', runAfter: { [HISTORY_ACTION]: ['Succeeded'] }, inputs: structuredClone(original.Update_item.inputs.parameters) },
    Capture_result: { type: 'AppendToArrayVariable', runAfter: { Update_item: ['Succeeded'] }, inputs: { name: 'probeResults', value: `@addProperty(outputs('${HISTORY_ACTION}'), 'parent', outputs('Update_item'))` } },
  };
  const probe = {
    $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
    contentVersion: '1.0.0.0', parameters: {},
    triggers: { manual: { type: 'Request', kind: 'Button', inputs: { schema: { type: 'object', properties: {} } } } },
    actions: {
      Initialize_results: { type: 'InitializeVariable', inputs: { variables: [{ name: 'probeResults', type: 'array', value: [] }] }, runAfter: {} },
      Apply_to_each: { type: 'Foreach', foreach: fixtures, actions, runAfter: { Initialize_results: ['Succeeded'] } },
      Receipt: { type: 'Compose', inputs: "@variables('probeResults')", runAfter: { Apply_to_each: ['Succeeded'] } },
    },
  };
  assertProbeReadOnly(probe);
  return probe;
}

export function assertProbeReadOnly(definition) {
  const allowed = new Set(['Compose', 'Foreach', 'InitializeVariable', 'AppendToArrayVariable']);
  function inspect(actions) {
    for (const action of Object.values(actions || {})) {
      if (!allowed.has(action.type)) throw new Error(`Probe must not execute external actions: ${action.type}`);
      if (action.actions) inspect(action.actions);
    }
  }
  inspect(definition.actions); return true;
}
