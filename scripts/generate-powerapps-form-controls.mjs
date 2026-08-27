import { readdir, readFile, writeFile } from "node:fs/promises";
import { generatedTextMatches } from "./generated-text-normalization.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ENTITIES from "../portal/catalog/entities.js";
import { POWERAPPS_ARTIFACTS } from "../portal/catalog/powerapps-matrix.js";
import { compilePowerAppsDefaultExpression } from "../portal/forms/powerapps-default-expression.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SOURCE_DIR = join(
  ROOT,
  "..",
  "_tmp",
  "powerapps-ui-inventory-20260826-1501",
  "ENERGETICA-current",
  "Src",
);
const DEFAULT_OUTPUT_PATH = join(ROOT, "portal", "catalog", "powerapps-form-controls.generated.js");

const CAPTURED_PROPERTIES = new Set([
  "AllowedValues",
  "Control",
  "DataField",
  "DataSource",
  "Default",
  "DefaultDate",
  "DefaultSelectedItems",
  "DisplayFields",
  "DisplayName",
  "DefaultMode",
  "IsSearchable",
  "Item",
  "Items",
  "OnSuccess",
  "SearchFields",
  "SelectMultiple",
  "Update",
  "Variant",
]);

const FIELD_CONTROL_NAMES = new Set([
  "Attachments",
  "CheckBox",
  "ComboBox",
  "DatePicker",
  "DropDown",
  "Radio",
  "Rating",
  "Slider",
  "TextInput",
  "Toggle",
]);

function canonicalSourceName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
}

function formulaIdentifier(value) {
  let source = String(value || "").trim().replace(/^=/, "").trim();
  if (source.startsWith("[@") && source.endsWith("]")) source = source.slice(2, -1).trim();
  if (source.startsWith("'") && source.endsWith("'")) return source.slice(1, -1).replace(/''/g, "'");
  return source;
}

function formulaString(value) {
  const source = String(value || "").trim().replace(/^=/, "").trim();
  if (!source.startsWith('"') || !source.endsWith('"')) return "";
  return source.slice(1, -1).replace(/""/g, '"');
}

function formulaBoolean(value) {
  const source = String(value || "").trim().replace(/^=/, "").trim().toLowerCase();
  if (source === "true") return true;
  if (source === "false") return false;
  return null;
}

function formulaDisplayName(value) {
  const literal = formulaString(value);
  if (literal) return literal;
  const source = normalizeFormula(value).replace(/^=/, "").trim();
  const match = source.match(/DataSourceInfo\s*\([\s\S]*,\s*(?:'((?:''|[^'])+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))\s*\)$/i);
  return String(match?.[1] || match?.[2] || "").replace(/''/g, "'");
}

function stripPowerFxLineComments(value) {
  const source = String(value || "");
  let result = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (doubleQuoted) {
      result += character;
      if (character === '"' && next === '"') {
        result += next;
        index += 1;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (singleQuoted) {
      result += character;
      if (character === "'" && next === "'") {
        result += next;
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      result += character;
      continue;
    }
    if (character === "'") {
      singleQuoted = true;
      result += character;
      continue;
    }
    if (character === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n" && source[index] !== "\r") index += 1;
      result += " ";
      continue;
    }
    result += character;
  }
  return result;
}

function normalizeFormula(value) {
  let source = String(value || "").trim();
  if (source.startsWith('"') && source.endsWith('"')) {
    try {
      source = JSON.parse(source);
    } catch {
      // Keep malformed quoted formulas literal so they remain safely unresolved.
    }
  }
  return stripPowerFxLineComments(source).trim().replace(/\s+/g, " ");
}

function literalStringArray(value) {
  const source = normalizeFormula(value).replace(/^=/, "").trim();
  if (!source.startsWith("[") || !source.endsWith("]")) return null;
  const values = [];
  let index = 1;
  let expectValue = true;
  while (index < source.length - 1) {
    while (/\s/.test(source[index] || "")) index += 1;
    if (index >= source.length - 1) break;
    if (!expectValue || source[index] !== '"') return null;
    index += 1;
    let current = "";
    let closed = false;
    while (index < source.length) {
      if (source[index] !== '"') {
        current += source[index];
        index += 1;
        continue;
      }
      if (source[index + 1] === '"') {
        current += '"';
        index += 2;
        continue;
      }
      index += 1;
      closed = true;
      break;
    }
    if (!closed) return null;
    values.push(current);
    while (/\s/.test(source[index] || "")) index += 1;
    if (source[index] === ",") {
      index += 1;
      expectValue = true;
      continue;
    }
    if (index < source.length - 1) return null;
    expectValue = false;
  }
  return values.length ? values : null;
}

function literalRecordArray(value) {
  const source = normalizeFormula(value).replace(/^=/, "").trim();
  if (!source.startsWith("[") || !source.endsWith("]")) return null;
  const body = source.slice(1, -1);
  const pattern = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*"((?:[^"]|"")*)"\s*\}/g;
  const choices = [];
  let valueField = "";
  let cursor = 0;
  let match;
  while ((match = pattern.exec(body))) {
    if (!/^[\s,]*$/.test(body.slice(cursor, match.index))) return null;
    if (valueField && valueField !== match[1]) return null;
    valueField = match[1];
    choices.push(match[2].replace(/""/g, '"'));
    cursor = pattern.lastIndex;
  }
  if (!choices.length || !/^[\s,]*$/.test(body.slice(cursor))) return null;
  return { choices, valueField };
}

function defaultSelectionForFormula(value, fieldName = "") {
  const formula = normalizeFormula(value);
  const source = formula.replace(/^=/, "").trim();
  if (!source) return null;
  const values = literalStringArray(formula);
  if (values) return { kind: "literal", values, formula };
  const scalar = scalarFormulaValue(source);
  if (scalar.translated) return { kind: "literal", values: [scalar.value], formula };
  if (/^\[?\s*(?:Parent\.Default|ThisItem\.(?:'[^']+'|[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]*))\s*\]?$/i.test(source)) {
    return { kind: "current", formula };
  }
  if (/^Blank\(\)$/i.test(source)) return { kind: "blank", formula };
  const expression = compilePowerAppsDefaultExpression(formula, fieldName);
  if (expression) return { kind: "computed", formula, expression };
  return { kind: "unresolved", formula, reason: "Default Power Apps não traduzível." };
}

function blockValue(lines, start, propertyIndent) {
  const raw = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    const indent = line.match(/^\s*/)?.[0].length || 0;
    if (line.trim() && indent <= propertyIndent) break;
    raw.push(line);
    index += 1;
  }
  const meaningful = raw.filter(line => line.trim());
  const commonIndent = meaningful.length
    ? Math.min(...meaningful.map(line => line.match(/^\s*/)?.[0].length || 0))
    : propertyIndent + 2;
  return {
    nextLine: index,
    value: raw.map(line => line.slice(Math.min(commonIndent, line.length))).join("\n").trim(),
  };
}

function parseComponents(content, fileName) {
  const components = [];
  const stack = [];
  const lines = String(content || "").split(/\r?\n/);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    const componentMatch = line.match(/^(\s*)-\s+(.+?):\s*$/);
    if (componentMatch) {
      const indent = componentMatch[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const component = {
        fileName,
        name: componentMatch[2].trim(),
        indent,
        lineNumber: lineNumber + 1,
        parent: stack.at(-1) || null,
        properties: {},
      };
      components.push(component);
      stack.push(component);
      continue;
    }

    const propertyMatch = line.match(/^(\s*)([A-Za-z][A-Za-z0-9]*):\s*(.*)$/);
    if (!propertyMatch || !stack.length || propertyMatch[1].length <= stack.at(-1).indent) continue;
    const propertyName = propertyMatch[2];
    if (!CAPTURED_PROPERTIES.has(propertyName)) continue;
    let value = propertyMatch[3];
    if (/^\|[+-]?$/.test(value.trim())) {
      const block = blockValue(lines, lineNumber + 1, propertyMatch[1].length);
      value = block.value;
      lineNumber = block.nextLine - 1;
    }
    stack.at(-1).properties[propertyName] = value;
  }
  return components;
}

function formModeCalls(content) {
  const source = String(content || "");
  const calls = [];
  const pattern = /\b(NewForm|EditForm)\s*\(\s*('(?:''|[^'])+'|[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_.]*)\s*\)/g;
  let match;
  while ((match = pattern.exec(source))) {
    calls.push({
      action: match[1] === "NewForm" ? "create" : "edit",
      formName: formulaIdentifier(match[2]),
      lineNumber: source.slice(0, match.index).split(/\r?\n/).length,
    });
  }
  return calls;
}

function controlName(component) {
  const match = String(component?.properties?.Control || "").match(/^(?:Classic\/)?([^@/]+)@/);
  return match?.[1] || "";
}

function isDescendantOf(component, ancestor) {
  let current = component?.parent;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function nearestAncestor(component, predicate) {
  let current = component?.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

function sourceOwners(entities) {
  const owners = new Map();
  for (const entity of entities || []) {
    for (const listName of entity.listNames || []) {
      const key = canonicalSourceName(listName);
      const existing = owners.get(key);
      if (existing && existing.entityId !== entity.id) {
        throw new Error(`Fonte Power Apps ambigua no catalogo: ${listName}.`);
      }
      if (!existing) owners.set(key, { entityId: entity.id, listName });
    }
  }
  return owners;
}

function splitTopLevel(value, delimiter = ",") {
  const source = String(value || "");
  const parts = [];
  let current = "";
  let depth = 0;
  let doubleQuoted = false;
  let singleQuoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (doubleQuoted) {
      current += character;
      if (character === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (character === '"') {
        doubleQuoted = false;
      }
      continue;
    }
    if (singleQuoted) {
      current += character;
      if (character === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (character === "'") {
        singleQuoted = false;
      }
      continue;
    }
    if (character === '"') {
      doubleQuoted = true;
      current += character;
      continue;
    }
    if (character === "'") {
      singleQuoted = true;
      current += character;
      continue;
    }
    if ("([{".includes(character)) depth += 1;
    if (")]}".includes(character)) depth -= 1;
    if (depth === 0 && source.startsWith(delimiter, index)) {
      parts.push(current.trim());
      current = "";
      index += delimiter.length - 1;
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts.filter(part => part.length > 0);
}

function unwrapGrouping(value) {
  let source = String(value || "").trim();
  let changed = true;
  while (changed && source.startsWith("(") && source.endsWith(")")) {
    changed = false;
    let depth = 0;
    let doubleQuoted = false;
    let singleQuoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (doubleQuoted) {
        if (character === '"' && next === '"') index += 1;
        else if (character === '"') doubleQuoted = false;
        continue;
      }
      if (singleQuoted) {
        if (character === "'" && next === "'") index += 1;
        else if (character === "'") singleQuoted = false;
        continue;
      }
      if (character === '"') doubleQuoted = true;
      else if (character === "'") singleQuoted = true;
      else if (character === "(") depth += 1;
      else if (character === ")") depth -= 1;
      if (depth === 0 && index < source.length - 1) return source;
    }
    if (depth === 0 && !doubleQuoted && !singleQuoted) {
      source = source.slice(1, -1).trim();
      changed = true;
    }
  }
  return source;
}

function callExpression(value) {
  const source = normalizeFormula(value).replace(/^=/, "").trim();
  const match = source.match(/^([A-Za-z][A-Za-z0-9]*)\s*\(/);
  if (!match) return null;
  const openIndex = source.indexOf("(", match.index);
  let depth = 0;
  let doubleQuoted = false;
  let singleQuoted = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (doubleQuoted) {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') doubleQuoted = false;
      continue;
    }
    if (singleQuoted) {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") singleQuoted = false;
      continue;
    }
    if (character === '"') doubleQuoted = true;
    else if (character === "'") singleQuoted = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth === 0) {
      return {
        name: match[1],
        args: splitTopLevel(source.slice(openIndex + 1, index)),
        suffix: source.slice(index + 1).trim(),
      };
    }
  }
  return null;
}

function nestedFunctionCalls(value, functionName) {
  const source = normalizeFormula(value).replace(/^=/, "");
  const expression = new RegExp(`\\b${functionName}\\s*\\(`, "gi");
  const calls = [];
  let match;
  while ((match = expression.exec(source))) {
    const call = callExpression(source.slice(match.index));
    if (call?.name.toLowerCase() === functionName.toLowerCase()) calls.push(call);
    expression.lastIndex = match.index + functionName.length;
  }
  return calls;
}

function multipleSerializationForField(field, control) {
  if (!control || !(control.selectMultiple === true || /\.SelectedItems\b/i.test(field?.update))) return null;
  const escapedControl = String(control.controlName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const selectedItems = new RegExp(`\\b${escapedControl}\\.SelectedItems\\b`, "i");
  const concat = nestedFunctionCalls(field.update, "Concat").find(call => selectedItems.test(call.args[0] || ""));
  if (!concat || concat.args.length < 2) return null;
  const explicitDelimiter = concat.args.length > 2
    ? scalarFormulaValue(concat.args[concat.args.length - 1])
    : scalarFormulaValue(splitTopLevel(concat.args[1], "&").at(-1));
  if (!explicitDelimiter.translated || typeof explicitDelimiter.value !== "string") return null;
  const specialValues = [...new Set([...String(field.update || "").matchAll(/"((?:""|[^"])*)"/g)]
    .map(match => match[1].replace(/""/g, '"'))
    .filter(value => value === "DISPENSADO"))];
  return {
    kind: "concat",
    delimiter: explicitDelimiter.value,
    specialValues,
  };
}

function valueTransformForField(field, control) {
  if (!control) return null;
  const escapedControl = String(control.controlName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const update = normalizeFormula(field.update).replace(/^=/, "").trim();
  const division = update.match(new RegExp(`^${escapedControl}\\.Selected\\.(?:Value|'Value')\\s*\\/\\s*(\\d+(?:\\.\\d+)?)$`, "i"));
  if (!division) return null;
  const divisor = Number(division[1]);
  if (!Number.isFinite(divisor) || divisor === 0) return null;
  const defaultFormula = normalizeFormula(control.defaultSelectedItems || field.default);
  const multiplication = defaultFormula.match(/\bThisItem\.(?:'[^']+'|[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)\s*\*\s*(\d+(?:\.\d+)?)/i);
  const multiplier = Number(multiplication?.[1]);
  if (!Number.isFinite(multiplier) || multiplier !== divisor) return null;
  return { kind: "scale", displayMultiplier: multiplier, submitDivisor: divisor };
}

function scalarFormulaValue(value) {
  const source = String(value || "").trim();
  const literal = formulaString(`=${source}`);
  if (source.startsWith('"') && source.endsWith('"')) return { translated: true, value: literal };
  if (/^(true|false)$/i.test(source)) return { translated: true, value: /^true$/i.test(source) };
  if (/^-?\d+(?:\.\d+)?$/.test(source)) return { translated: true, value: Number(source) };
  return { translated: false, value: null };
}

function fieldFormulaName(value) {
  const source = String(value || "").trim();
  const match = source.match(/^(?:'((?:''|[^'])+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]*))$/);
  return String(match?.[1] || match?.[2] || "").replace(/''/g, "'").trim();
}

function fixedFilter(value) {
  const predicate = callExpression(value);
  if (predicate?.name.toLowerCase() === "startswith" && predicate.args.length === 2) {
    const fieldName = fieldFormulaName(predicate.args[0]);
    const prefix = scalarFormulaValue(predicate.args[1]);
    if (fieldName && prefix.translated && typeof prefix.value === "string" && prefix.value) {
      return { fieldName, operator: "starts-with", value: prefix.value };
    }
    return null;
  }
  const parts = splitTopLevel(value, "=");
  if (parts.length !== 2) return null;
  const leftField = fieldFormulaName(parts[0]);
  const rightField = fieldFormulaName(parts[1]);
  const leftValue = scalarFormulaValue(parts[0]);
  const rightValue = scalarFormulaValue(parts[1]);
  if (leftField && rightValue.translated) {
    return { fieldName: leftField, operator: "eq", value: rightValue.value };
  }
  if (rightField && leftValue.translated) {
    return { fieldName: rightField, operator: "eq", value: leftValue.value };
  }
  return null;
}

function fixedBooleanGroups(value) {
  const alternatives = splitTopLevel(unwrapGrouping(value), "||");
  if (alternatives.length < 2) return null;
  const groups = alternatives.map(alternative => (
    splitTopLevel(unwrapGrouping(alternative), "&&").map(condition => fixedFilter(unwrapGrouping(condition)))
  ));
  return groups.every(group => group.length && group.every(Boolean)) ? groups : null;
}

function blankSelectedControl(value) {
  const blank = callExpression(value);
  if (blank?.name.toLowerCase() !== "isblank" || blank.args.length !== 1) return "";
  const wrapped = callExpression(blank.args[0]);
  const selected = wrapped?.name.toLowerCase() === "text" && wrapped.args.length
    ? normalizeFormula(wrapped.args[0]).replace(/^=/, "").trim()
    : normalizeFormula(blank.args[0]).replace(/^=/, "").trim();
  return selected.match(/^([A-Za-z_][A-Za-z0-9_]*)\.Selected(?:Items)?\.(?:'[^']+'|[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)$/)?.[1] || "";
}

function computedFieldParts(value) {
  const parts = [];
  for (const token of splitTopLevel(value, "&")) {
    const literal = scalarFormulaValue(token);
    if (literal.translated && typeof literal.value === "string") {
      parts.push({ kind: "literal", value: literal.value });
      continue;
    }
    const textCall = callExpression(token);
    if (textCall?.name.toLowerCase() === "coalesce") {
      const fieldName = fieldFormulaName(textCall.args[0]);
      const fallback = scalarFormulaValue(textCall.args[1]);
      if (!fieldName || !fallback.translated || fallback.value !== "") return null;
      parts.push({ kind: "field", fieldName });
      continue;
    }
    if (textCall?.name.toLowerCase() === "if" && textCall.args.length === 3) {
      const blank = callExpression(textCall.args[0]);
      const fieldName = blank?.name.toLowerCase() === "isblank" ? fieldFormulaName(blank.args[0]) : "";
      const fallback = scalarFormulaValue(textCall.args[1]);
      const resultField = fieldFormulaName(textCall.args[2]);
      if (!fieldName || resultField !== fieldName || !fallback.translated || typeof fallback.value !== "string") return null;
      parts.push({ kind: "field-fallback", fieldName, value: fallback.value });
      continue;
    }
    const fieldName = textCall?.name.toLowerCase() === "text"
      ? fieldFormulaName(textCall.args[0])
      : fieldFormulaName(token);
    if (!fieldName) return null;
    parts.push({ kind: "field", fieldName });
  }
  return parts.length ? parts : null;
}

function sourceFormulaAnalysis(formula, owners, dependencies) {
  const fixedFilters = [];
  const fixedFilterGroups = [];
  const computedFields = [];
  const unresolved = [];
  const seenFilters = new Set();
  const seenFilterGroups = new Set();
  const optionalDependencyControls = new Set();

  function appendUnique(values, target, seen) {
    for (const value of values || []) {
      const key = JSON.stringify(value);
      if (!seen.has(key)) target.push(value);
      seen.add(key);
    }
  }

  function visit(value) {
    const source = normalizeFormula(value).replace(/^=/, "").trim();
    const call = callExpression(source);
    if (call) {
      const name = call.name.toLowerCase();
      if (name === "if" && call.args.length === 3) {
        const controlName = blankSelectedControl(call.args[0]);
        const dependency = dependencies.find(candidate => candidate.controlName === controlName && candidate.targetField);
        if (dependency) {
          const blankBranch = sourceFormulaAnalysis(call.args[1], owners, dependencies);
          const selectedBranch = sourceFormulaAnalysis(call.args[2], owners, dependencies);
          const sameOwner = blankBranch.owner?.entityId === selectedBranch.owner?.entityId
            && blankBranch.owner?.listName === selectedBranch.owner?.listName;
          const sameSafeShape = sameOwner
            && !blankBranch.unresolved.length
            && !selectedBranch.unresolved.length
            && JSON.stringify(blankBranch.fixedFilters) === JSON.stringify(selectedBranch.fixedFilters)
            && JSON.stringify(blankBranch.fixedFilterGroups) === JSON.stringify(selectedBranch.fixedFilterGroups)
            && JSON.stringify(blankBranch.computedFields) === JSON.stringify(selectedBranch.computedFields);
          const blankUsesDependency = normalizeFormula(call.args[1]).includes(controlName);
          const selectedUsesDependency = normalizeFormula(call.args[2]).includes(controlName);
          if (sameSafeShape && !blankUsesDependency && selectedUsesDependency) {
            appendUnique(blankBranch.fixedFilters, fixedFilters, seenFilters);
            appendUnique(blankBranch.fixedFilterGroups, fixedFilterGroups, seenFilterGroups);
            for (const computed of blankBranch.computedFields) {
              if (!computedFields.some(candidate => JSON.stringify(candidate) === JSON.stringify(computed))) computedFields.push(computed);
            }
            optionalDependencyControls.add(controlName);
            return blankBranch.owner;
          }
        }
        unresolved.push(`Seletor nao traduzivel: ${call.name}`);
        return null;
      }
      if (name === "filter") {
        for (const argument of call.args.slice(1)) {
          const groups = fixedBooleanGroups(argument);
          if (groups) {
            const key = JSON.stringify(groups);
            if (!seenFilterGroups.has(key)) fixedFilterGroups.push(...groups);
            seenFilterGroups.add(key);
            continue;
          }
          for (const condition of splitTopLevel(argument, "&&")) {
          const filter = fixedFilter(condition);
          if (filter) {
            const key = JSON.stringify(filter);
            if (!seenFilters.has(key)) fixedFilters.push(filter);
            seenFilters.add(key);
            continue;
          }
          const supportsDependency = dependencies.some(dependency => (
            condition.includes(dependency.controlName)
            && dependency.targetField
          ));
          if (!supportsDependency) unresolved.push(`Filter nao traduzivel: ${condition}`);
          }
        }
      }
      if (name === "addcolumns") {
        const baseCall = callExpression(call.args[0]);
        const distinctParts = baseCall?.name.toLowerCase() === "distinct" && baseCall.args.length > 1
          ? computedFieldParts(baseCall.args[1])
          : null;
        for (let index = 1; index + 1 < call.args.length; index += 2) {
          const fieldName = fieldFormulaName(call.args[index]) || formulaString(`=${call.args[index]}`);
          const rawParts = computedFieldParts(call.args[index + 1]);
          const parts = rawParts && distinctParts
            ? rawParts.flatMap(part => (
              part.kind === "field" && /^(Value|Result)$/i.test(part.fieldName)
                ? distinctParts
                : [part]
            ))
            : rawParts;
          if (fieldName && parts) computedFields.push({ fieldName, parts });
          else unresolved.push(`AddColumns nao traduzivel: ${call.args[index + 1] || call.args[index]}`);
        }
      }
      if (["filter", "sort", "sortbycolumns", "addcolumns", "distinct", "showcolumns", "renamecolumns", "firstn", "groupby", "dropcolumns"].includes(name)) {
        return visit(call.args[0] || "");
      }
      unresolved.push(`Seletor nao traduzivel: ${call.name}`);
      return null;
    }

    const direct = source.match(/^(?:\[@([^\]]+)\]|'((?:''|[^'])+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]*?))(?=\s*\.|\s*$)/);
    const sourceName = String(direct?.[1] || direct?.[2] || direct?.[3] || "").replace(/''/g, "'").trim();
    return owners.get(canonicalSourceName(sourceName)) || null;
  }

  const owner = visit(formula);
  return {
    owner,
    fixedFilters,
    fixedFilterGroups,
    computedFields,
    unresolved,
    optionalDependencyControls: [...optionalDependencyControls],
  };
}

function selectedOutputField(update, controlNameValue) {
  const escaped = String(controlNameValue || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalizeFormula(update).match(new RegExp(`${escaped}\\.Selected(?:Text)?\\.(?:'([^']+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))`, "i"));
  const value = match?.[1] || match?.[2] || "";
  return /^(Value|Result)$/i.test(value) ? "" : value;
}

function formulaValueField(formula, control, card) {
  const source = normalizeFormula(formula).replace(/^=/, "").trim();
  const choices = source.match(/^Choices\s*\(\s*\[@[^\]]+\]\s*\.\s*(?:'([^']+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))\s*\)$/i);
  if (choices) return choices[1] || choices[2];
  const outerCall = callExpression(source);
  const distinctCall = outerCall?.name.toLowerCase() === "distinct"
    ? outerCall
    : outerCall?.name.toLowerCase() === "addcolumns"
      ? callExpression(outerCall.args[0])
      : null;
  if (distinctCall?.name.toLowerCase() === "distinct" && distinctCall.args.length > 1) {
    const projection = distinctCall.args[1];
    const directField = fieldFormulaName(projection);
    if (directField) return directField;
    const parts = splitTopLevel(projection, "&");
    const firstField = fieldFormulaName(parts[0]);
    const separator = parts.length > 1 ? scalarFormulaValue(parts[1]) : { translated: false };
    const escapedControl = String(control.controlName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const splitSelection = normalizeFormula(card.update).match(new RegExp(
      `First\\s*\\(\\s*Split\\s*\\(\\s*${escapedControl}\\.Selected(?:Items)?\\.(?:'[^']+'|[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)\\s*,\\s*"((?:""|[^"])*)"`,
      "i",
    ));
    const splitSeparator = String(splitSelection?.[1] || "").replace(/""/g, '"');
    if (firstField && separator.translated && separator.value === splitSeparator) return firstField;
  }
  const distinct = source.match(/,\s*(?:'([^']+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))\s*\)\s*$/i);
  if (/^Distinct\s*\(/i.test(source) && distinct) return distinct[1] || distinct[2];
  const projected = source.match(/\.\s*(?:'([^']+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))\s*$/i);
  if (projected) return projected[1] || projected[2];
  const updated = selectedOutputField(card.update, control.controlName);
  if (updated) return updated;
  const displayed = control.displayFields.find(value => !/^(Value|Result)$/i.test(value));
  return displayed || "";
}

function selectedDependencies(formula, controlOwners) {
  const source = String(formula || "");
  const dependencies = [];
  const seen = new Set();
  const fieldPattern = "(?:'([^']+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))";
  function addDependency(match, pattern, controlName, metadata = {}) {
    const fieldName = controlOwners.get(controlName);
    const prefix = source.slice(0, match.index);
    const suffix = source.slice(pattern.lastIndex);
    const leftTarget = prefix.match(new RegExp(`${fieldPattern}\\s*=\\s*$`));
    const rightTarget = suffix.match(new RegExp(`^\\s*=\\s*${fieldPattern}`));
    const targetField = leftTarget?.[1] || leftTarget?.[2] || rightTarget?.[1] || rightTarget?.[2] || "";
    const key = `${controlName}\u0000${fieldName || ""}\u0000${targetField}`;
    if (!fieldName || seen.has(key)) return;
    dependencies.push({
      controlName,
      fieldName,
      ...(targetField ? { targetField } : {}),
      ...metadata,
    });
    seen.add(key);
  }

  const wrappedSelected = new RegExp(`Text\\s*\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\.Selected(?:Items)?\\.${fieldPattern}\\s*\\)`, "g");
  let match;
  while ((match = wrappedSelected.exec(source))) {
    addDependency(match, wrappedSelected, match[1]);
  }

  const selectedFieldPattern = "(?:'(?:''|[^'])+'|[A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*)";
  const splitFirst = new RegExp(`First\\s*\\(\\s*Split\\s*\\(\\s*([A-Za-z_][A-Za-z0-9_]*)\\.Selected(?:Items)?\\.${selectedFieldPattern}\\s*,\\s*\"((?:\"\"|[^\"])*)\"\\s*\\)\\s*\\)\\.Value`, "g");
  while ((match = splitFirst.exec(source))) {
    const separator = match[2].replace(/\"\"/g, '"');
    if (separator) addDependency(match, splitFirst, match[1], { transform: { kind: "split-first", separator } });
  }

  const selected = new RegExp(`([A-Za-z_][A-Za-z0-9_]*)\\.Selected(?:Items)?\\.${fieldPattern}`, "g");
  while ((match = selected.exec(source))) {
    addDependency(match, selected, match[1]);
  }

  const text = /([A-Za-z_][A-Za-z0-9_]*)\.Text\b/g;
  while ((match = text.exec(source))) addDependency(match, text, match[1]);

  return dependencies.filter(dependency => (
    dependency.targetField
    || !dependencies.some(candidate => (
      candidate.controlName === dependency.controlName
      && candidate.fieldName === dependency.fieldName
      && candidate.targetField
    ))
  ));
}

function optionSourcesForControl(control, card, owners, controlOwners) {
  const rawItems = control.items;
  const items = normalizeFormula(/^(=)?Parent\.AllowedValues$/i.test(rawItems)
    ? card.allowedValues
    : rawItems);
  const literal = literalStringArray(items);
  if (literal) return [{ kind: "literal", choices: literal, formula: items }];
  const literalRecords = literalRecordArray(items);
  if (literalRecords) return [{
    kind: "literal",
    choices: literalRecords.choices,
    valueField: literalRecords.valueField,
    formula: items,
  }];

  const choices = items.match(/^=?\s*Choices\s*\(\s*\[@([^\]]+)\]\s*\.\s*(?:'([^']+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_]*))\s*\)$/i);
  if (choices) {
    const owner = owners.get(canonicalSourceName(choices[1]));
    return [{
      kind: "sharepoint-choice",
      entityId: owner?.entityId || card.entityId,
      listName: owner?.listName || choices[1],
      valueField: choices[2] || choices[3],
      formula: items,
    }];
  }

  const dependencies = selectedDependencies(items, controlOwners);
  const sourceAnalysis = sourceFormulaAnalysis(items, owners, dependencies);
  if (sourceAnalysis.owner) {
    const valueField = formulaValueField(items, control, card);
    if (sourceAnalysis.unresolved.length) {
      return [{
        kind: "unresolved",
        entityId: sourceAnalysis.owner.entityId,
        listName: sourceAnalysis.owner.listName,
        valueField: valueField || null,
        formula: items,
        reason: sourceAnalysis.unresolved.join("; "),
      }];
    }
    const kind = dependencies.length
      ? "dependent"
      : sourceAnalysis.fixedFilters.length || sourceAnalysis.fixedFilterGroups.length
        ? "filtered-list"
        : "related";
    return [{
      kind,
      entityId: sourceAnalysis.owner.entityId,
      listName: sourceAnalysis.owner.listName,
      valueField,
      formula: items,
      ...(sourceAnalysis.fixedFilters.length ? { fixedFilters: sourceAnalysis.fixedFilters } : {}),
      ...(sourceAnalysis.fixedFilterGroups.length ? { fixedFilterGroups: sourceAnalysis.fixedFilterGroups } : {}),
      ...(dependencies.length ? {
        dependsOn: dependencies.map(dependency => sourceAnalysis.optionalDependencyControls.includes(dependency.controlName)
          ? { ...dependency, optional: true }
          : dependency),
      } : {}),
      ...(control.displayFields.length ? { displayFields: control.displayFields } : {}),
      ...(control.searchFields.length ? { searchFields: control.searchFields } : {}),
      ...(sourceAnalysis.computedFields.length ? { computedFields: sourceAnalysis.computedFields } : {}),
    }];
  }

  if (/\bOffice365Users\b/i.test(items)) {
    return [{
      kind: "person",
      entityId: null,
      listName: "Office365Users",
      valueField: formulaValueField(items, control, card) || "DisplayName",
      formula: items,
    }];
  }

  return [{
    kind: "unresolved",
    entityId: null,
    listName: null,
    valueField: formulaValueField(items, control, card) || null,
    formula: items,
    reason: "Fórmula Items não traduzível pelo provider seguro.",
  }];
}

function fieldControl(component) {
  const powerAppsControl = controlName(component);
  if (!FIELD_CONTROL_NAMES.has(powerAppsControl)) return null;
  const properties = component.properties;
  if (powerAppsControl === "ComboBox" || powerAppsControl === "DropDown") {
    return {
      controlName: component.name,
      powerAppsControl,
      lineNumber: component.lineNumber,
      items: normalizeFormula(properties.Items),
      defaultSelectedItems: normalizeFormula(properties.DefaultSelectedItems || properties.Default),
      searchFields: literalStringArray(properties.SearchFields) || [],
      displayFields: literalStringArray(properties.DisplayFields) || [],
      isSearchable: formulaBoolean(properties.IsSearchable),
      selectMultiple: formulaBoolean(properties.SelectMultiple),
    };
  }
  return {
    controlName: component.name,
    powerAppsControl,
    lineNumber: component.lineNumber,
    default: normalizeFormula(properties.DefaultDate || properties.Default),
  };
}

function controlsReferencedByUpdate(update, controls) {
  const source = normalizeFormula(update);
  return (controls || []).filter(control => {
    const escaped = String(control.controlName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped && new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=\\.|[^A-Za-z0-9_]|$)`).test(source);
  });
}

function primaryFieldControl(update, controls) {
  const referenced = controlsReferencedByUpdate(update, controls);
  if (referenced.length === 1) return referenced[0];
  if (!normalizeFormula(update) && controls.length === 1) return controls[0];
  return null;
}

function evidenceControl(control) {
  if (control.powerAppsControl !== "ComboBox" && control.powerAppsControl !== "DropDown") {
    return {
      controlName: control.controlName,
      powerAppsControl: control.powerAppsControl,
      lineNumber: control.lineNumber,
      default: control.default,
    };
  }
  return {
    controlName: control.controlName,
    powerAppsControl: control.powerAppsControl,
    lineNumber: control.lineNumber,
    items: control.items,
    defaultSelectedItems: control.defaultSelectedItems,
    displayFields: control.displayFields,
    searchFields: control.searchFields,
    isSearchable: control.isSearchable,
    selectMultiple: control.selectMultiple,
  };
}

function formsFromComponents(components, owners, modeCalls = []) {
  const forms = [];
  for (const form of components.filter(component => String(component.properties.Control || "").startsWith("Form@"))) {
    const dataSource = formulaIdentifier(form.properties.DataSource);
    const owner = owners.get(canonicalSourceName(dataSource));
    if (!owner) continue;
    const cards = components.filter(component => (
      String(component.properties.Control || "").startsWith("TypedDataCard@")
      && nearestAncestor(component, candidate => String(candidate.properties.Control || "").startsWith("Form@")) === form
    ));
    const formControls = components
      .filter(component => (
        isDescendantOf(component, form)
        && nearestAncestor(component, candidate => String(candidate.properties.Control || "").startsWith("Form@")) === form
      ))
      .map(fieldControl)
      .filter(Boolean);
    const fields = [];
    for (const card of cards) {
      const fieldName = formulaString(card.properties.DataField);
      if (!fieldName) continue;
      const localControls = components
        .filter(component => isDescendantOf(component, card)
          && nearestAncestor(component, candidate => String(candidate.properties.Control || "").startsWith("TypedDataCard@")) === card)
        .map(fieldControl)
        .filter(Boolean);
      if (!localControls.length) continue;
      const update = normalizeFormula(card.properties.Update);
      const localNames = new Set(localControls.map(control => control.controlName));
      const linkedControls = controlsReferencedByUpdate(update, formControls)
        .filter(control => !localNames.has(control.controlName))
        .map(control => ({ ...control, linkedFromSiblingCard: true }));
      const controls = [...localControls, ...linkedControls];
      const primaryControl = primaryFieldControl(update, controls);
      const hasClosed = primaryControl?.powerAppsControl === "ComboBox" || primaryControl?.powerAppsControl === "DropDown";
      const hasText = primaryControl?.powerAppsControl === "TextInput";
      fields.push({
        entityId: owner.entityId,
        fieldName,
        cardName: card.name,
        cardVariant: normalizeFormula(card.properties.Variant),
        lineNumber: card.lineNumber,
        mode: hasClosed ? "closed" : hasText ? "open-text" : primaryControl ? "other" : "computed",
        update,
        default: normalizeFormula(card.properties.Default),
        displayName: formulaDisplayName(card.properties.DisplayName),
        displayNameFormula: normalizeFormula(card.properties.DisplayName),
        primaryControlName: primaryControl?.controlName || "",
        allowedValues: normalizeFormula(card.properties.AllowedValues),
        controls,
      });
    }
    if (!fields.length) continue;
    forms.push({
      fileName: form.fileName,
      formName: form.name,
      lineNumber: form.lineNumber,
      entityId: owner.entityId,
      dataSource,
      item: normalizeFormula(form.properties.Item),
      defaultMode: normalizeFormula(form.properties.DefaultMode),
      onSuccess: normalizeFormula(form.properties.OnSuccess),
      modeEvidence: modeCalls.filter(call => call.formName === form.name),
      fields,
    });
  }
  return forms;
}

function orderedObject(value) {
  const ordered = {};
  for (const key of Object.keys(value || {}).sort((left, right) => left.localeCompare(right, "pt-BR"))) {
    ordered[key] = value[key];
  }
  return ordered;
}

function primaryControlForField(field) {
  return field.controls.find(control => control.controlName === field.primaryControlName) || null;
}

function defaultSelectionForField(field, control) {
  return defaultSelectionForFormula(control?.defaultSelectedItems || control?.default || field?.default, field?.fieldName);
}

function uniqueGlobalControlOwners(forms) {
  const candidates = new Map();
  for (const form of forms || []) {
    for (const field of form.fields || []) {
      for (const control of field.controls || []) {
        if (!candidates.has(control.controlName)) candidates.set(control.controlName, new Set());
        candidates.get(control.controlName).add(field.fieldName);
      }
    }
  }
  return new Map(
    [...candidates.entries()]
      .filter(([, fieldNames]) => fieldNames.size === 1)
      .map(([name, fieldNames]) => [name, [...fieldNames][0]]),
  );
}

function controlOwnersForForm(form, globalOwners) {
  const owners = new Map(globalOwners);
  for (const field of form.fields || []) {
    for (const control of field.controls || []) {
      if (control.linkedFromSiblingCard || owners.has(control.controlName)) continue;
      owners.set(control.controlName, field.fieldName);
    }
  }
  return owners;
}

function buildContracts(forms, owners) {
  const grouped = new Map();
  const globalOwners = uniqueGlobalControlOwners(forms);
  for (const form of forms) {
    const controlOwners = controlOwnersForForm(form, globalOwners);
    for (const field of form.fields) {
      const key = `${field.entityId}\u0000${field.fieldName}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ form, field, controlOwners });
    }
  }

  const contracts = {};
  for (const [key, occurrences] of grouped) {
    const closed = occurrences.flatMap(({ form, field, controlOwners }) => {
      const control = primaryControlForField(field);
      return control && (control.powerAppsControl === "ComboBox" || control.powerAppsControl === "DropDown")
        ? [{ form, field, control, controlOwners }]
        : [];
    });
    if (!closed.length) continue;
    const [entityId, fieldName] = key.split("\u0000");
    const choices = [];
    const seenChoices = new Set();
    const optionSources = [];
    const seenSources = new Set();
    const evidence = [];
    for (const occurrence of closed) {
      const sources = optionSourcesForControl(
        occurrence.control,
        { ...occurrence.field, entityId },
        owners,
        occurrence.controlOwners,
      );
      for (const source of sources) {
        for (const choice of source.choices || []) {
          if (seenChoices.has(choice)) continue;
          choices.push(choice);
          seenChoices.add(choice);
        }
        const sourceKey = JSON.stringify(source);
        if (!seenSources.has(sourceKey)) {
          optionSources.push(source);
          seenSources.add(sourceKey);
        }
      }
      evidence.push({
        fileName: occurrence.form.fileName,
        formName: occurrence.form.formName,
        cardName: occurrence.field.cardName,
        controlName: occurrence.control.controlName,
        lineNumber: occurrence.control.lineNumber,
        items: occurrence.control.items,
      });
    }
    const searchable = closed.every(({ control }) => (
      control.powerAppsControl === "ComboBox"
      && control.isSearchable !== false
      && control.searchFields.length > 0
    ));
    const allowMultipleValues = closed.some(({ field, control }) => (
      control.selectMultiple === true || /\.SelectedItems\b/i.test(field.update)
    ));
    const serializations = [...new Map(closed
      .map(({ field, control }) => multipleSerializationForField(field, control))
      .filter(Boolean)
      .map(serialization => [JSON.stringify(serialization), serialization])).values()];
    const valueTransforms = [...new Map(closed
      .map(({ field, control }) => valueTransformForField(field, control))
      .filter(Boolean)
      .map(transform => [JSON.stringify(transform), transform])).values()];
    const literalSets = new Set(optionSources
      .filter(source => source.kind === "literal")
      .map(source => JSON.stringify(source.choices)));
    contracts[entityId] ||= {};
    contracts[entityId][fieldName] = {
      closed: true,
      failClosed: true,
      preserveCurrentValue: true,
      searchable,
      ...(allowMultipleValues ? { allowMultipleValues: true } : {}),
      ...(serializations.length === 1 ? { multipleSerialization: serializations[0] } : {}),
      ...(valueTransforms.length === 1 ? { valueTransform: valueTransforms[0] } : {}),
      choices,
      optionSources,
      union: literalSets.size > 1 ? "same-entity-field" : null,
      modes: [...new Set(occurrences.map(({ field }) => field.mode))],
      evidence,
    };
  }

  const ordered = {};
  for (const entityId of Object.keys(contracts).sort()) {
    ordered[entityId] = orderedObject(contracts[entityId]);
  }
  return ordered;
}

function normalizedEvidenceName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function operationalModesForForm(form, submitEvidence) {
  const explicitModes = [...new Set((form.modeEvidence || []).map(evidence => evidence.action))];
  if (explicitModes.length) return explicitModes;
  const formName = normalizedEvidenceName(form.formName);
  const fileName = normalizedEvidenceName(form.fileName);
  const defaultMode = normalizedEvidenceName(form.defaultMode);
  const onlyAttachments = form.fields.length > 0 && form.fields.every(field => /^\{?ATTACHMENTS\}?$/i.test(field.fieldName));
  if (onlyAttachments) return ["auxiliary"];
  if (/FORMMODE\.VIEW/.test(defaultMode)) return ["history"];
  if (/\bEDITAR/.test(formName) || /(?:^|\W)EDITAR\b/.test(fileName) || /^E\d+\b/.test(fileName)) return ["edit"];
  if (String(form.item || "").trim()) return ["edit"];
  if (/\b(?:CADASTRO|ADICIONAR)\b/.test(formName)
    || /(?:^|\W)(?:CADASTRO|ADICIONAR)\b/.test(fileName)
    || /^F\d+\b/.test(fileName)) return ["create"];
  if (/HISTORICO/.test(formName) || /HISTORICO/.test(fileName) || /^G\d+\b/.test(fileName)) return ["history"];
  const submittedActions = [...new Set((submitEvidence?.actions || []).filter(action => action === "create" || action === "edit"))];
  return submittedActions.length === 1 ? submittedActions : ["unknown"];
}

function submitFormEvidenceByVariant(artifacts = POWERAPPS_ARTIFACTS) {
  const evidence = new Map();
  for (const artifact of artifacts || []) {
    for (const operation of artifact.operations || []) {
      for (const marker of operation.evidence || []) {
        const formName = String(marker).match(/^SubmitForm:(.+)$/)?.[1];
        if (!formName) continue;
        const id = `${artifact.artifact}#${formName}`;
        evidence.set(id, Object.freeze({
          artifact: artifact.artifact,
          formName,
          source: operation.source,
          entityId: operation.entityId,
          actions: Object.freeze((operation.actions || []).filter(action => action === "create" || action === "edit")),
          evidence: Object.freeze([...operation.evidence]),
        }));
      }
    }
  }
  return evidence;
}

function formFieldContract(form, fieldOccurrences, owners, controlOwners) {
  const controlVariants = fieldOccurrences.flatMap(field => {
    const control = primaryControlForField(field);
    if (!control) return [];
    const closed = control.powerAppsControl === "ComboBox" || control.powerAppsControl === "DropDown";
    return [{
      cardName: field.cardName,
      cardLineNumber: field.lineNumber,
      displayName: field.displayName,
      displayNameFormula: field.displayNameFormula,
      update: field.update,
      default: field.default,
      defaultSelection: defaultSelectionForField(field, control),
      allowedValues: field.allowedValues,
      control: evidenceControl(control),
      ...(closed && (control.selectMultiple === true || /\.SelectedItems\b/i.test(field.update))
        ? { allowMultipleValues: true }
        : {}),
      ...(multipleSerializationForField(field, control)
        ? { multipleSerialization: multipleSerializationForField(field, control) }
        : {}),
      ...(valueTransformForField(field, control)
        ? { valueTransform: valueTransformForField(field, control) }
        : {}),
      searchable: closed
        && control.powerAppsControl === "ComboBox"
        && control.isSearchable !== false
        && control.searchFields.length > 0,
      choices: [],
      optionSources: [],
    }];
  });

  const descriptorSignatures = new Map();
  for (const variant of controlVariants) {
    const signature = JSON.stringify({
      powerAppsControl: variant.control.powerAppsControl,
      displayName: variant.displayName,
      defaultSelection: variant.defaultSelection,
    });
    if (!descriptorSignatures.has(signature)) descriptorSignatures.set(signature, variant);
  }
  const descriptor = descriptorSignatures.size === 1 ? descriptorSignatures.values().next().value : null;
  const closedVariants = controlVariants
    .filter(variant => variant.control.powerAppsControl === "ComboBox" || variant.control.powerAppsControl === "DropDown")
    .map(variant => {
      const control = primaryControlForField(fieldOccurrences.find(field => (
        field.cardName === variant.cardName && field.lineNumber === variant.cardLineNumber
      )));
      const optionSources = optionSourcesForControl(
        control,
        {
          ...fieldOccurrences.find(field => (
            field.cardName === variant.cardName && field.lineNumber === variant.cardLineNumber
          )),
          entityId: form.entityId,
        },
        owners,
        controlOwners,
      );
      const choices = [...new Set(optionSources.flatMap(source => source.choices || []))];
      return {
        ...variant,
        choices,
        optionSources,
      };
    });

  if (!closedVariants.length) {
    return {
      closed: false,
      displayName: descriptor?.displayName || "",
      displayNameFormula: descriptor?.displayNameFormula || "",
      powerAppsControl: descriptor?.control.powerAppsControl || null,
      defaultSelection: descriptor?.defaultSelection || null,
      ambiguous: descriptorSignatures.size > 1,
      controlVariants,
    };
  }

  const signatures = new Map();
  for (const variant of closedVariants) {
    const signature = JSON.stringify({
      searchable: variant.searchable,
      allowMultipleValues: variant.allowMultipleValues,
      multipleSerialization: variant.multipleSerialization || null,
      valueTransform: variant.valueTransform || null,
      choices: variant.choices,
      optionSources: variant.optionSources,
    });
    if (!signatures.has(signature)) signatures.set(signature, variant);
  }
  const unambiguous = signatures.size === 1;
  const selected = unambiguous ? signatures.values().next().value : null;
  return {
    closed: true,
    failClosed: true,
    preserveCurrentValue: true,
    displayName: descriptor?.displayName || "",
    displayNameFormula: descriptor?.displayNameFormula || "",
    powerAppsControl: descriptor?.control.powerAppsControl || null,
    defaultSelection: selected?.defaultSelection || descriptor?.defaultSelection || null,
    searchable: selected?.searchable === true,
    ...(selected?.allowMultipleValues === true ? { allowMultipleValues: true } : {}),
    ...(selected?.multipleSerialization ? { multipleSerialization: selected.multipleSerialization } : {}),
    ...(selected?.valueTransform ? { valueTransform: selected.valueTransform } : {}),
    choices: selected?.choices || [],
    optionSources: selected?.optionSources || [],
    ambiguous: !unambiguous,
    controlVariants: closedVariants,
  };
}

function annotateSharedControlFields(form, fields) {
  const groups = new Map();
  for (const field of form.fields) {
    const control = primaryControlForField(field);
    if (!control || (control.powerAppsControl !== "ComboBox" && control.powerAppsControl !== "DropDown")) continue;
    const sourceField = selectedOutputField(field.update, control.controlName);
    if (!sourceField) continue;
    if (!groups.has(control.controlName)) groups.set(control.controlName, []);
    const group = groups.get(control.controlName);
    if (!group.some(output => output.fieldName === field.fieldName)) {
      group.push({ fieldName: field.fieldName, sourceField });
    }
  }
  for (const outputs of groups.values()) {
    if (outputs.length < 2) continue;
    const [anchor, ...secondary] = outputs;
    const additionalFields = [...new Set(secondary.map(output => output.sourceField))];
    fields[anchor.fieldName] = {
      ...fields[anchor.fieldName],
      sharedOutputs: outputs,
      optionSources: (fields[anchor.fieldName]?.optionSources || []).map(source => ({
        ...source,
        ...(additionalFields.length ? { additionalFields } : {}),
      })),
    };
    for (const output of secondary) {
      fields[output.fieldName] = {
        ...fields[output.fieldName],
        sharedControlAnchor: anchor.fieldName,
      };
    }
  }
}

function buildFormVariants(forms, owners) {
  const variants = {};
  const submitEvidence = submitFormEvidenceByVariant();
  const globalOwners = uniqueGlobalControlOwners(forms);
  for (const form of forms) {
    const controlOwners = controlOwnersForForm(form, globalOwners);
    const fieldsByName = new Map();
    for (const field of form.fields) {
      if (!fieldsByName.has(field.fieldName)) fieldsByName.set(field.fieldName, []);
      fieldsByName.get(field.fieldName).push(field);
    }
    const fields = {};
    for (const [fieldName, occurrences] of fieldsByName) {
      const contract = formFieldContract(form, occurrences, owners, controlOwners);
      if (contract) fields[fieldName] = contract;
    }
    annotateSharedControlFields(form, fields);
    variants[form.entityId] ||= [];
    const id = `${form.fileName}#${form.formName}`;
    const submission = submitEvidence.get(id);
    const modes = operationalModesForForm(form, submission);
    variants[form.entityId].push({
      id,
      mode: modes[0],
      modes,
      modeEvidence: form.modeEvidence,
      fileName: form.fileName,
      formName: form.formName,
      lineNumber: form.lineNumber,
      entityId: form.entityId,
      dataSource: form.dataSource,
      item: form.item,
      defaultMode: form.defaultMode,
      onSuccess: form.onSuccess,
      submitEvidence: submission || null,
      formFields: [...new Set(form.fields.map(field => field.fieldName))],
      fields: orderedObject(fields),
      cards: form.fields.map(field => ({
        fieldName: field.fieldName,
        cardName: field.cardName,
        cardVariant: field.cardVariant,
        lineNumber: field.lineNumber,
        mode: field.mode,
        update: field.update,
        default: field.default,
        displayName: field.displayName,
        displayNameFormula: field.displayNameFormula,
        primaryControlName: field.primaryControlName,
        allowedValues: field.allowedValues,
        controls: field.controls.map(evidenceControl),
      })),
    });
  }
  return orderedObject(variants);
}

export function extractPowerAppsFormControls(files, entities = ENTITIES) {
  const owners = sourceOwners(entities);
  const forms = [...(files || [])]
    .sort((left, right) => String(left.fileName).localeCompare(String(right.fileName), "pt-BR"))
    .flatMap(file => formsFromComponents(
      parseComponents(file.content, file.fileName),
      owners,
      formModeCalls(file.content),
    ))
    .sort((left, right) => left.fileName.localeCompare(right.fileName, "pt-BR") || left.lineNumber - right.lineNumber);
  const evidenceForms = forms.map(form => ({
    fileName: form.fileName,
    formName: form.formName,
    lineNumber: form.lineNumber,
    entityId: form.entityId,
    dataSource: form.dataSource,
    item: form.item,
    defaultMode: form.defaultMode,
    onSuccess: form.onSuccess,
    modeEvidence: form.modeEvidence,
    fields: form.fields.map(field => ({
      fieldName: field.fieldName,
      cardName: field.cardName,
      cardVariant: field.cardVariant,
      lineNumber: field.lineNumber,
      mode: field.mode,
      update: field.update,
      default: field.default,
      displayName: field.displayName,
      displayNameFormula: field.displayNameFormula,
      primaryControlName: field.primaryControlName,
      controls: field.controls.map(evidenceControl),
    })),
  }));
  return {
    contracts: buildContracts(forms, owners),
    variants: buildFormVariants(forms, owners),
    evidence: {
      schemaVersion: 1,
      forms: evidenceForms,
    },
  };
}

export async function extractPowerAppsFormControlsFromDirectory(sourceDir, entities = ENTITIES) {
  const names = (await readdir(sourceDir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && entry.name.endsWith(".pa.yaml"))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right, "pt-BR"));
  const files = await Promise.all(names.map(async fileName => ({
    fileName,
    content: await readFile(join(sourceDir, fileName), "utf8"),
  })));
  return extractPowerAppsFormControls(files, entities);
}

export function renderPowerAppsFormControls(result) {
  return [
    "// Generated by scripts/generate-powerapps-form-controls.mjs.",
    "// Source: Power Apps .pa.yaml forms; contracts are keyed by entity and exact internal field.",
    "",
    "function deepFreeze(value) {",
    "  if (!value || typeof value !== \"object\" || Object.isFrozen(value)) return value;",
    "  for (const child of Object.values(value)) deepFreeze(child);",
    "  return Object.freeze(value);",
    "}",
    "",
    `const POWERAPPS_FORM_CONTROLS = deepFreeze(${JSON.stringify(result.contracts, null, 2)});`,
    "",
    `const POWERAPPS_FORM_VARIANTS = deepFreeze(${JSON.stringify(result.variants, null, 2)});`,
    "",
    `const POWERAPPS_FORM_CONTROL_EVIDENCE = deepFreeze(${JSON.stringify(result.evidence, null, 2)});`,
    "",
    "export { POWERAPPS_FORM_CONTROL_EVIDENCE, POWERAPPS_FORM_VARIANTS };",
    "export default POWERAPPS_FORM_CONTROLS;",
    "",
  ].join("\n");
}

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? resolve(process.argv[index + 1]) : fallback;
}

async function main() {
  const sourceDir = optionValue("--source", process.env.POWERAPPS_SOURCE_DIR || DEFAULT_SOURCE_DIR);
  const outputPath = optionValue("--output", DEFAULT_OUTPUT_PATH);
  const result = await extractPowerAppsFormControlsFromDirectory(sourceDir, ENTITIES);
  const output = renderPowerAppsFormControls(result);
  if (process.argv.includes("--check")) {
    const current = await readFile(outputPath, "utf8").catch(() => "");
    if (!generatedTextMatches(current, output)) {
      process.stderr.write("Power Apps form control contracts are out of date.\n");
      process.exitCode = 1;
    }
    return;
  }
  await writeFile(outputPath, output, "utf8");
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) await main();
