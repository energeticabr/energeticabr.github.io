import POWERAPPS_FORM_CONTROLS from "../portal/catalog/powerapps-form-controls.generated.js";

function addReference(target, source, computed, reference) {
  const field = String(reference || "").trim();
  if (!field) return;
  if (/^(Value|Result)$/i.test(field)) {
    target.add(String(source.valueField || "").trim());
    return;
  }
  const descriptor = computed.get(field.toLocaleLowerCase("pt-BR"));
  if (!descriptor) {
    target.add(field);
    return;
  }
  for (const part of descriptor.parts || []) {
    if (part?.kind === "field" || part?.kind === "field-fallback") {
      addReference(target, source, computed, part.fieldName);
    }
  }
}

const sources = [];
for (const [entityId, controls] of Object.entries(POWERAPPS_FORM_CONTROLS)) {
  for (const [fieldName, control] of Object.entries(controls)) {
    for (const source of control.optionSources || []) {
      if (!["related", "filtered-list", "dependent"].includes(source?.kind)) continue;
      const computed = new Map((source.computedFields || []).map(field => [
        String(field.fieldName || "").toLocaleLowerCase("pt-BR"), field,
      ]));
      const fields = new Set();
      addReference(fields, source, computed, source.valueField);
      for (const field of source.searchFields?.length ? source.searchFields : [source.valueField]) {
        addReference(fields, source, computed, field);
      }
      for (const dependency of source.dependsOn || []) addReference(fields, source, computed, dependency.targetField);
      for (const filter of source.fixedFilters || []) addReference(fields, source, computed, filter.fieldName);
      for (const group of source.fixedFilterGroups || []) {
        for (const filter of group || []) addReference(fields, source, computed, filter.fieldName);
      }
      sources.push({
        entityId,
        fieldName,
        listName: String(source.listName || "").trim(),
        kind: source.kind,
        fields: [...fields].filter(Boolean).sort((left, right) => left.localeCompare(right, "pt-BR")),
      });
    }
  }
}

process.stdout.write(`${JSON.stringify(sources)}\n`);
