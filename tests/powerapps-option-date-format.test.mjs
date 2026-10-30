import assert from 'node:assert/strict';
import test from 'node:test';
import ENTITIES from '../portal/catalog/entities.js';
import CONTROLS, { POWERAPPS_FORM_VARIANTS } from '../portal/catalog/powerapps-form-controls.generated.js';
import { extractPowerAppsFormControls } from '../scripts/generate-powerapps-form-controls.mjs';

function sourceFixture(expression, formName = 'FormDate', valueField = 'DisplayText', update = `PaymentCombo.Selected.${valueField}`) {
  return { fileName: `${formName}.pa.yaml`, content: `Screens:
  DateFixture:
    Children:
      - ${formName}:
          Control: Form@2.4.4
          Properties:
            DataSource: =DESCRITIVOPRESENCA
          Children:
            - PaymentCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="IDPGTO"
                  Update: =${update}
                Children:
                  - PaymentCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =AddColumns(Sort(LANCAMENTOS, ID, SortOrder.Descending), DisplayText, Text(ID) & " - " & FORNECEDOR & " - " & ${expression})
                        DisplayFields: =["DisplayText"]
                        SearchFields: =["DisplayText"]
` };
}

const datePart = { kind: 'field', fieldName: 'DATA PGTO EFETUADO', format: 'date-pt-BR' };
const expectedParts = [
  { kind: 'field', fieldName: 'ID' }, { kind: 'literal', value: ' - ' },
  { kind: 'field', fieldName: 'FORNECEDOR' }, { kind: 'literal', value: ' - ' }, datePart,
];

for (const format of ['[$-pt-BR]dd/mm/yyyy', 'dd/mm/yyyy', '[$-pt-BR]DD/MM/YYYY']) {
  test(`computed payment labels and persisted text retain proven date mask ${format} in merged and every form descriptor`, () => {
    const expression = `Text('DATA PGTO EFETUADO', "${format}")`;
    const result = extractPowerAppsFormControls([sourceFixture(expression, 'FirstForm'), sourceFixture(expression, 'SecondForm')], ENTITIES);
    const variants = result.variants['descricoes-de-presenca'];
    assert.equal(variants.length, 2);
    const fields = [result.contracts['descricoes-de-presenca'].IDPGTO, ...variants.map(variant => variant.fields.IDPGTO)];
    for (const field of fields) {
      assert.ok(field.optionSources.length > 0);
      for (const source of field.optionSources) {
        assert.equal(source.kind, 'related');
        assert.equal(source.valueField, 'DisplayText', 'formatted computed text is also the persisted value');
        assert.deepEqual(source.displayFields, ['DisplayText']);
        assert.deepEqual(source.searchFields, ['DisplayText']);
        assert.deepEqual(source.computedFields, [{ fieldName: 'DisplayText', parts: expectedParts }]);
      }
    }
  });
}

test('formatted display labels retain the trait when the persisted selection is the original ID', () => {
  const result = extractPowerAppsFormControls([sourceFixture('Text(\'DATA PGTO EFETUADO\', "dd/mm/yyyy")', 'IdForm', 'ID')], ENTITIES);
  const source = result.variants['descricoes-de-presenca'][0].fields.IDPGTO.optionSources[0];
  assert.equal(source.valueField, 'ID');
  assert.deepEqual(source.computedFields[0].parts, expectedParts);
});

for (const expression of [
  'Text(\'DATA PGTO EFETUADO\', "yyyy-mm-dd")',
  'Text(\'DATA PGTO EFETUADO\', "[$-en-US]mm/dd/yyyy")',
  'Text(\'DATA PGTO EFETUADO\', "dd/mm/yyyy hh:mm")',
  'Text(\'DATA PGTO EFETUADO\', FormatFromAnotherField)',
  'Text(\'DATA PGTO EFETUADO\', "dd/mm/yyyy", "en-US")',
]) {
  test(`unsupported or unproven Text format fails closed: ${expression}`, () => {
    const result = extractPowerAppsFormControls([sourceFixture(expression)], ENTITIES);
    for (const field of [result.contracts['descricoes-de-presenca'].IDPGTO, result.variants['descricoes-de-presenca'][0].fields.IDPGTO]) {
      assert.equal(field.failClosed, true);
      assert.ok(field.optionSources.length > 0);
      assert.ok(field.optionSources.every(source => source.kind === 'unresolved'), 'must not silently serialize the raw date');
      assert.match(field.optionSources[0].reason, /AddColumns nao traduzivel/);
    }
  });
}

test('unformatted Text(ID) and ordinary unformatted fields retain their legacy descriptors', () => {
  const result = extractPowerAppsFormControls([sourceFixture("Text('DATA PGTO EFETUADO')")], ENTITIES);
  const parts = result.variants['descricoes-de-presenca'][0].fields.IDPGTO.optionSources[0].computedFields[0].parts;
  assert.deepEqual(parts, expectedParts.map(({ format, ...part }) => part));
  assert.ok(parts.every(part => !Object.hasOwn(part, 'format')));
});

test('checked-in computed payment choices retain date formatting in all proven merged/variant sources', () => {
  const proven = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.formula === 'string' && /Text\('DATA PGTO EFETUADO',\s*"\[\$-pt-BR\]dd\/mm\/yyyy"\)/.test(value.formula) && Array.isArray(value.computedFields)) proven.push(value);
    for (const child of Object.values(value)) visit(child);
  }
  visit(CONTROLS); visit(POWERAPPS_FORM_VARIANTS);
  assert.ok(proven.length >= 2, 'must inspect merged and form-specific audited metadata');
  for (const source of proven) {
    const parts = source.computedFields.flatMap(field => field.parts);
    assert.deepEqual(parts.filter(part => part.fieldName === 'DATA PGTO EFETUADO'), [datePart]);
    assert.ok(parts.filter(part => part.fieldName === 'ID').every(part => !Object.hasOwn(part, 'format')));
  }
});

for (const [update, delimiter] of [
  ['Concat(PaymentCombo.SelectedItems, Text(ID), ",")', ','],
  ['Concat(PaymentCombo.SelectedItems, ID, ", ")', ', '],
  ['If(IsEmpty(PaymentCombo.SelectedItems), Blank(), Concat(PaymentCombo.SelectedItems, Text(\'ID\'), ", "))', ', '],
  ['Concat(Filter(PaymentCombo.SelectedItems, ID > 0), Text(ID), ",")', ','],
  ['Concat(PaymentCombo.SelectedItems, Text(ID) & ",")', ','],
]) {
  test(`authoritative Update persists comma-separated IDs while preserving formatted labels: ${update}`, () => {
    const result = extractPowerAppsFormControls([sourceFixture('Text(\'DATA PGTO EFETUADO\', "dd/mm/yyyy")', 'IdListForm', 'DisplayText', update)], ENTITIES);
    const variant = result.variants['descricoes-de-presenca'][0].fields.IDPGTO;
    for (const field of [result.contracts['descricoes-de-presenca'].IDPGTO, variant, ...variant.controlVariants]) {
      assert.equal(field.allowMultipleValues, true);
      assert.deepEqual(field.multipleSerialization, { kind: 'concat', delimiter, specialValues: [] });
      for (const source of field.optionSources) {
        assert.equal(source.valueField, 'ID', 'Update ID must win over computed DisplayText');
        assert.deepEqual(source.displayFields, ['DisplayText']);
        assert.deepEqual(source.computedFields[0].parts, expectedParts);
      }
    }
  });
}

test('checked-in Concat SelectedItems Text(ID) sources persist IDs across every field and descriptor', () => {
  let inspected = 0;
  for (const [entity, forms] of Object.entries(POWERAPPS_FORM_VARIANTS)) for (const form of forms) {
    for (const [fieldName, field] of Object.entries(form.fields)) for (const control of field.controlVariants || []) {
      if (!/Concat\([\s\S]*SelectedItems[\s\S]*Text\(ID\)\s*,\s*", ?"/i.test(control.update || '')) continue;
      const sources = control.optionSources || [];
      const concrete = sources.filter(source => ['related', 'dependent', 'filtered-list'].includes(source.kind));
      if (!concrete.length) continue;
      inspected++;
      for (const descriptor of [CONTROLS[entity][fieldName], field, control]) {
        assert.equal(descriptor.allowMultipleValues, true, `${form.id}/${fieldName}`);
        assert.ok([',', ', '].includes(descriptor.multipleSerialization.delimiter));
        assert.ok(descriptor.optionSources.every(source => source.valueField === 'ID'), `${form.id}/${fieldName}: source must persist ID, not its display label`);
      }
    }
  }
  assert.ok(inspected >= 7, 'includes both reported fields and equivalent property-editor fields');
});
