import { POWERAPPS_GALLERY_CONTRACTS } from "./powerapps-gallery-contracts.generated.js";
import { POWERAPPS_ARTIFACTS } from "./powerapps-matrix.js";

function unresolved(reason, extra = {}) {
  return { status: "unresolved", reason, ...extra };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identityFor(gallery) {
  return {
    fileName: gallery?.fileName || "",
    screenName: gallery?.screenName || "",
    galleryName: gallery?.galleryName || "",
  };
}

function splitTopLevelArguments(content) {
  const values = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (quote) {
      if (character === quote && content[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) return null;
    } else if (character === "," && depth === 0) {
      values.push(content.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote || depth !== 0) return null;
  values.push(content.slice(start).trim());
  return values;
}

function parseExactCall(literal, functionName) {
  const formula = String(literal || "").trim().replace(/^=/, "").trim();
  const prefix = new RegExp(`^${escapeRegExp(functionName)}\\s*\\(`, "iu").exec(formula);
  if (!prefix) return null;

  const openingIndex = prefix[0].lastIndexOf("(");
  let depth = 0;
  let quote = null;
  let closingIndex = -1;
  for (let index = openingIndex; index < formula.length; index += 1) {
    const character = formula[index];
    if (quote) {
      if (character === quote && formula[index + 1] === quote) {
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        closingIndex = index;
        break;
      }
    }
  }
  if (closingIndex < 0 || formula.slice(closingIndex + 1).trim()) return null;
  return splitTopLevelArguments(formula.slice(openingIndex + 1, closingIndex));
}

function parseFieldIdentifier(literal) {
  const value = String(literal || "").trim();
  const quoted = /^'((?:''|[^'])+)'$/u.exec(value);
  if (quoted) return quoted[1].replace(/''/g, "'");
  return /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(value) ? value : null;
}

function rootSourceFromItems(literal) {
  let expression = String(literal || "").trim().replace(/^=/, "").trim();
  const wrappers = [
    "Sort",
    "SortByColumns",
    "Filter",
    "Search",
    "FirstN",
    "LastN",
    "ShowColumns",
    "AddColumns",
  ];
  for (let depth = 0; depth < 12; depth += 1) {
    const aliased = topLevelLogicalParts(expression, ["As"]);
    if (aliased?.length === 2 && parseFieldIdentifier(aliased[1])) expression = aliased[0];
    const source = parseFieldIdentifier(expression);
    if (source) return source;
    const wrapper = wrappers
      .map(name => parseExactCall(expression, name))
      .find(args => Array.isArray(args) && args.length > 0);
    if (!wrapper) return null;
    expression = wrapper[0].trim();
  }
  return null;
}

function embeddedFunctionCalls(literal, functionName) {
  const value = stripPowerFxComments(String(literal || "").replace(/^=/, ""));
  const calls = [];
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    const match = new RegExp(`^${escapeRegExp(functionName)}\\s*\\(`, "iu").exec(value.slice(index));
    if (!match || /[\p{L}\p{N}_]/u.test(value[index - 1] || "")) continue;
    const opening = index + match[0].lastIndexOf("(");
    let depth = 0;
    let innerQuote = null;
    for (let cursor = opening; cursor < value.length; cursor += 1) {
      const inner = value[cursor];
      if (innerQuote) {
        if (inner === innerQuote && value[cursor + 1] === innerQuote) cursor += 1;
        else if (inner === innerQuote) innerQuote = null;
        continue;
      }
      if (inner === '"' || inner === "'") innerQuote = inner;
      else if (inner === "(") depth += 1;
      else if (inner === ")") {
        depth -= 1;
        if (depth === 0) {
          calls.push(value.slice(index, cursor + 1));
          break;
        }
      }
    }
  }
  return calls;
}

function embeddedFilterSources(literal) {
  return [...new Set(embeddedFunctionCalls(literal, "Filter").map(call => {
    const args = parseExactCall(call, "Filter");
    return args?.length ? rootSourceFromItems(args[0]) : null;
  }).filter(Boolean))];
}

function translateSort(itemsLiteral) {
  const formula = String(itemsLiteral || "").trim();
  const sortArgs = parseExactCall(formula, "Sort");
  const sortByColumnsArgs = parseExactCall(formula, "SortByColumns");
  const args = sortArgs || sortByColumnsArgs;
  if (!args) {
    return /^=?\s*Sort(?:ByColumns)?\s*\(/iu.test(formula)
      ? unresolved("sort-formula-not-translatable")
      : unresolved("sort-not-proven");
  }
  if (args.length !== 3) return unresolved("sort-formula-not-translatable");

  const columnValue = sortByColumnsArgs ? parseFixedValue(args[1]) : null;
  const field = sortByColumnsArgs
    ? (typeof columnValue?.value === "string" && columnValue.value ? columnValue.value : null)
    : parseFieldIdentifier(args[1]);
  const directionMatch = /^SortOrder\.(Ascending|Descending)$/iu.exec(args[2]);
  if (!field || !directionMatch) return unresolved("sort-formula-not-translatable");
  return {
    status: "resolved",
    field,
    direction: directionMatch[1].toLowerCase(),
    evidence: formula,
  };
}

function hasBalancedOuterParentheses(value) {
  if (!value.startsWith("(") || !value.endsWith(")")) return false;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0 && index < value.length - 1) return false;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !quote;
}

function stripOuterParentheses(literal) {
  let value = String(literal || "").trim();
  while (hasBalancedOuterParentheses(value)) value = value.slice(1, -1).trim();
  return value;
}

function splitTopLevelOperator(literal, operator) {
  const value = String(literal || "");
  let depth = 0;
  let quote = null;
  for (let index = 0; index <= value.length - operator.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (depth === 0 && value.slice(index, index + operator.length) === operator) {
      return [value.slice(0, index).trim(), value.slice(index + operator.length).trim()];
    }
  }
  return null;
}

function stripPowerFxComments(literal) {
  const value = String(literal || "");
  let result = "";
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      result += character;
      if (character === quote && value[index + 1] === quote) {
        result += value[index + 1];
        index += 1;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      continue;
    }
    if (character === "/" && value[index + 1] === "/") {
      while (index < value.length && value[index] !== "\n") index += 1;
      result += "\n";
      continue;
    }
    if (character === "/" && value[index + 1] === "*") {
      index += 2;
      while (index < value.length - 1 && !(value[index] === "*" && value[index + 1] === "/")) index += 1;
      index += 1;
      result += " ";
      continue;
    }
    result += character;
  }
  return result;
}

function topLevelLogicalParts(literal, operators) {
  const value = String(literal || "");
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  const candidates = [...operators].sort((left, right) => right.length - left.length);
  const isWord = operator => /^[A-Za-z]+$/.test(operator);
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (depth === 0) {
      const operator = candidates.find(candidate => {
        const slice = value.slice(index, index + candidate.length);
        if (slice.toLocaleLowerCase("pt-BR") !== candidate.toLocaleLowerCase("pt-BR")) return false;
        if (!isWord(candidate)) return true;
        return !/[\p{L}\p{N}_]/u.test(value[index - 1] || "")
          && !/[\p{L}\p{N}_]/u.test(value[index + candidate.length] || "");
      });
      if (operator) {
        parts.push(value.slice(start, index).trim());
        index += operator.length - 1;
        start = index + 1;
      }
    }
  }
  if (!parts.length) return null;
  parts.push(value.slice(start).trim());
  return parts;
}

function parseInputReference(literal) {
  const value = String(literal || "").trim();
  const identifier = "(?:'(?:''|[^'])+'|[\\p{L}_][\\p{L}\\p{N}_]*)";
  return new RegExp(`^${identifier}(?:\\.${identifier})+$`, "u").test(value) ? value : null;
}

function parseInputSymbol(literal) {
  const value = stripOuterParentheses(literal);
  return parseInputReference(value) || (/^_[\p{L}_][\p{L}\p{N}_]*$/u.test(value) ? value : null);
}

function parseInputOperand(literal) {
  const value = stripOuterParentheses(literal);
  const direct = parseInputReference(value);
  if (direct) return direct;
  for (const wrapper of ["Text", "DateValue", "Value"]) {
    const args = parseExactCall(value, wrapper);
    if (args?.length === 1) {
      const input = parseInputReference(args[0]);
      if (input) return input;
    }
  }
  return null;
}

function parseFilterFieldOperand(literal) {
  const value = stripOuterParentheses(literal);
  const quotedField = /^'((?:''|[^'])+)'$/u.exec(value);
  if (quotedField) return quotedField[1].replace(/''/g, "'");
  const direct = parseFieldIdentifier(value);
  if (direct) {
    if (!value.includes(".")) return direct;
    if (!/\.(?:SelectedItems|SelectedText|Selected)(?:\.|$)/u.test(value)) {
      const segments = direct.split(".");
      const hasProjectedValue = segments.length >= 3 && ["LookupValue", "Result", "Value"].includes(segments.at(-1));
      return hasProjectedValue ? segments.at(-2) : segments.at(-1);
    }
  }
  const aliasedQuoted = /^(?:[\p{L}_][\p{L}\p{N}_]*)\.'((?:''|[^'])+)'$/u.exec(value);
  if (aliasedQuoted) return aliasedQuoted[1].replace(/''/g, "'");
  for (const wrapper of ["DateValue", "Value"]) {
    const args = parseExactCall(value, wrapper);
    if (args?.length === 1) return parseFieldIdentifier(args[0]);
  }
  return null;
}

function blankInputReference(literal) {
  const args = parseExactCall(stripOuterParentheses(literal), "IsBlank");
  return args?.length === 1 ? parseInputSymbol(args[0]) : null;
}

function inputsCorrespond(blankInput, comparedInput) {
  const controlRoot = value => /^(.*)\.(?:SelectedItems|SelectedText|Selected)(?:\.|$)/u.exec(String(value || ""))?.[1] || "";
  return Boolean(blankInput && comparedInput && (
    blankInput === comparedInput
    || comparedInput.startsWith(`${blankInput}.`)
    || (controlRoot(blankInput) && controlRoot(blankInput) === controlRoot(comparedInput))
  ));
}

function parseComparison(literal) {
  const value = stripOuterParentheses(literal);
  for (const [token, operator] of [[">=", "gte"], ["<=", "lte"], ["=", "eq"]]) {
    const parts = splitTopLevelOperator(value, token);
    if (!parts) continue;
    const leftField = parseFilterFieldOperand(parts[0]);
    const rightInput = parseInputOperand(parts[1]);
    if (leftField && rightInput) return { field: leftField, input: rightInput, operator };
    if (operator === "eq") {
      const rightField = parseFilterFieldOperand(parts[1]);
      const leftInput = parseInputOperand(parts[0]);
      if (rightField && leftInput) return { field: rightField, input: leftInput, operator };
    }
  }
  return null;
}

function parseMembership(literal) {
  const parts = topLevelLogicalParts(stripOuterParentheses(literal), ["in"]);
  if (parts?.length !== 2) return null;
  const field = parseFilterFieldOperand(parts[0]);
  const input = parseInputReference(parts[1]);
  return field && input ? { field, input } : null;
}

function parseContainsMembership(literal) {
  const parts = topLevelLogicalParts(stripOuterParentheses(literal), ["in"]);
  if (parts?.length !== 2) return null;
  const input = parseInputSymbol(parts[0]);
  const coalesce = parseExactCall(parts[1], "Coalesce");
  const field = parseFilterFieldOperand(coalesce?.[0] || parts[1]);
  return input && field ? { field, input } : null;
}

function parseFixedComparison(literal) {
  const equality = splitTopLevelOperator(stripOuterParentheses(literal), "=");
  if (!equality) return null;
  const field = parseFilterFieldOperand(equality[0]);
  const fixed = parseFixedValue(equality[1]);
  return field && fixed.resolved ? { field, value: fixed.value } : null;
}

function emptyInputReference(literal) {
  const value = stripOuterParentheses(literal);
  for (const functionName of ["IsBlank", "IsEmpty"]) {
    const args = parseExactCall(value, functionName);
    if (args?.length === 1) {
      const input = parseInputSymbol(args[0]);
      if (input) return input;
    }
  }
  const count = splitTopLevelOperator(value, "=");
  const countArgs = count ? parseExactCall(count[0], "CountRows") : null;
  return countArgs?.length === 1 && Number(count[1]) === 0 ? parseInputSymbol(countArgs[0]) : null;
}

function parseFixedValue(literal) {
  const value = String(literal || "").trim();
  if (/^(true|false)$/iu.test(value)) return { resolved: true, value: value.toLowerCase() === "true" };
  if (/^-?(?:\d+|\d*\.\d+)$/u.test(value)) return { resolved: true, value: Number(value) };
  const text = /^"((?:""|[^"])*)"$/u.exec(value);
  if (text) return { resolved: true, value: text[1].replace(/""/g, '"') };
  return { resolved: false };
}

function parseOptionalFilterClause(literal, evidence) {
  const parts = topLevelLogicalParts(literal, ["||", "Or"]);
  if (!parts) return null;
  const contains = parts.map(parseContainsMembership).find(Boolean);
  if (contains) {
    const emptyInputs = parts.map(emptyInputReference).filter(Boolean);
    if (emptyInputs.some(input => inputsCorrespond(input, contains.input))) {
      return { channel: "search", value: { kind: "contains", field: contains.field, input: contains.input, optional: true, evidence } };
    }
  }
  const membership = parts.map(parseMembership).find(Boolean);
  if (membership) {
    const emptyInputs = parts.map(emptyInputReference).filter(Boolean);
    if (emptyInputs.some(input => inputsCorrespond(input, membership.input))) {
      return { channel: "filter", value: { kind: "optional-in", field: membership.field, input: membership.input, evidence } };
    }
  }
  if (parts.length !== 2) return null;
  for (const [togglePart, valuePart] of [parts, [parts[1], parts[0]]]) {
    const toggle = /^!\s*([\s\S]+)$/u.exec(stripOuterParentheses(togglePart));
    const input = toggle ? parseInputSymbol(toggle[1]) : null;
    const fixed = parseFixedComparison(valuePart);
    if (input && fixed) {
      return { channel: "filter", value: { kind: "optional-fixed", field: fixed.field, input, value: fixed.value, evidence } };
    }
  }
  for (const [blankPart, valuePart] of [parts, [parts[1], parts[0]]]) {
    const blankInput = blankInputReference(blankPart);
    if (!blankInput) continue;
    const startsWithArgs = parseExactCall(stripOuterParentheses(valuePart), "StartsWith");
    if (startsWithArgs?.length === 2) {
      const field = parseFieldIdentifier(startsWithArgs[0]);
      const input = parseInputOperand(startsWithArgs[1]);
      if (field && inputsCorrespond(blankInput, input)) {
        return { channel: "search", value: { kind: "starts-with", field, input, optional: true, evidence } };
      }
    }
    const comparison = parseComparison(valuePart);
    if (comparison && inputsCorrespond(blankInput, comparison.input)) {
      return {
        channel: "filter",
        value: comparison.operator === "eq"
          ? { kind: "optional-equals", field: comparison.field, input: comparison.input, evidence }
          : { kind: "optional-range", field: comparison.field, input: comparison.input, operator: comparison.operator, evidence },
      };
    }
  }
  return null;
}

function parseIfFilterClause(literal, evidence) {
  const args = parseExactCall(literal, "If");
  if (args?.length !== 3) return null;
  const emptyInput = emptyInputReference(args[0]);
  const membership = /^true$/iu.test(args[1].trim()) ? parseMembership(args[2]) : null;
  if (emptyInput && membership && inputsCorrespond(emptyInput, membership.input)) {
    return { channel: "filter", value: { kind: "optional-in", field: membership.field, input: membership.input, evidence } };
  }
  const negatedBlank = /^!\s*(IsBlank\([\s\S]+\))$/iu.exec(stripOuterParentheses(args[0]));
  const positiveBlank = blankInputReference(args[0]);
  const blankInput = positiveBlank || (negatedBlank ? blankInputReference(negatedBlank[1]) : null);
  const comparisonLiteral = positiveBlank && /^true$/iu.test(args[1].trim())
    ? args[2]
    : negatedBlank && /^true$/iu.test(args[2].trim())
      ? args[1]
      : "";
  const comparison = comparisonLiteral ? parseComparison(comparisonLiteral) : null;
  if (!comparison || !inputsCorrespond(blankInput, comparison.input)) return null;
  return {
    channel: "filter",
    value: comparison.operator === "eq"
      ? { kind: "optional-equals", field: comparison.field, input: comparison.input, evidence }
      : { kind: "optional-range", field: comparison.field, input: comparison.input, operator: comparison.operator, evidence },
  };
}

function parseOptionalRangeGroup(literal, evidence) {
  const parts = topLevelLogicalParts(literal, ["||", "Or"]);
  if (!parts || parts.length < 3) return [];
  const emptyInputs = parts.map(emptyInputReference).filter(Boolean);
  const comparisons = parts.flatMap(part => {
    const conjunctions = topLevelLogicalParts(stripOuterParentheses(part), ["&&", "And"]);
    return (conjunctions || [part]).map(parseComparison).filter(Boolean);
  }).filter(comparison => comparison.operator !== "eq");
  if (!comparisons.length || comparisons.some(comparison => !emptyInputs.some(input => inputsCorrespond(input, comparison.input)))) return [];
  return comparisons.map(comparison => ({
    channel: "filter",
    value: { kind: "optional-range", field: comparison.field, input: comparison.input, operator: comparison.operator, evidence },
  }));
}

function rangeComparisons(literal) {
  const value = stripOuterParentheses(literal);
  const parts = topLevelLogicalParts(value, ["&&", "And"]) || [value];
  const comparisons = parts.map(parseComparison);
  return comparisons.every(comparison => comparison && comparison.operator !== "eq") ? comparisons : [];
}

function sameComparison(left, right) {
  return left?.field === right?.field
    && left?.input === right?.input
    && left?.operator === right?.operator;
}

function parseNestedOptionalRanges(literal, evidence) {
  const outer = parseExactCall(literal, "If");
  if (outer?.length !== 3 || !/^true$/iu.test(outer[1].trim())) return [];
  const blankParts = topLevelLogicalParts(stripOuterParentheses(outer[0]), ["&&", "And"]);
  const emptyInputs = blankParts?.map(emptyInputReference) || [];
  if (emptyInputs.length !== 2 || emptyInputs.some(input => !input) || new Set(emptyInputs).size !== 2) return [];

  const firstBranch = parseExactCall(stripOuterParentheses(outer[2]), "If");
  if (firstBranch?.length !== 3) return [];
  const firstBlank = emptyInputReference(firstBranch[0]);
  const otherInput = emptyInputs.find(input => input !== firstBlank);
  const firstComparisons = rangeComparisons(firstBranch[1]);
  if (!emptyInputs.includes(firstBlank) || firstComparisons.length !== 1 || !inputsCorrespond(otherInput, firstComparisons[0].input)) return [];

  const secondBranch = parseExactCall(stripOuterParentheses(firstBranch[2]), "If");
  if (secondBranch?.length !== 3 || emptyInputReference(secondBranch[0]) !== otherInput) return [];
  const secondComparisons = rangeComparisons(secondBranch[1]);
  if (secondComparisons.length !== 1 || !inputsCorrespond(firstBlank, secondComparisons[0].input)) return [];

  const comparisons = [firstComparisons[0], secondComparisons[0]];
  const finalComparisons = rangeComparisons(secondBranch[2]);
  if (
    finalComparisons.length !== comparisons.length
    || comparisons.some(comparison => !finalComparisons.some(candidate => sameComparison(candidate, comparison)))
    || new Set(comparisons.map(comparison => comparison.field)).size !== 1
    || new Set(comparisons.map(comparison => comparison.operator)).size !== 2
  ) return [];
  return comparisons.map(comparison => ({
    channel: "filter",
    value: { kind: "optional-range", field: comparison.field, input: comparison.input, operator: comparison.operator, evidence },
  }));
}

function parseFilterClauses(literal) {
  const evidence = stripOuterParentheses(stripPowerFxComments(literal));
  const conjunctions = topLevelLogicalParts(evidence, ["&&", "And"]);
  if (conjunctions?.length > 1) return conjunctions.flatMap(parseFilterClauses);
  const rangeGroup = parseOptionalRangeGroup(evidence, evidence);
  if (rangeGroup.length) return rangeGroup;
  const nestedRanges = parseNestedOptionalRanges(evidence, evidence);
  if (nestedRanges.length) return nestedRanges;
  const optional = parseOptionalFilterClause(evidence, evidence);
  if (optional) return [optional];
  const conditional = parseIfFilterClause(evidence, evidence);
  if (conditional) return [conditional];

  const startsWithArgs = parseExactCall(evidence, "StartsWith");
  if (startsWithArgs?.length === 2) {
    const field = parseFieldIdentifier(startsWithArgs[0]);
    const input = parseInputReference(startsWithArgs[1]);
    if (field && input) {
      return [{
        channel: "search",
        value: { kind: "starts-with", field, input, optional: false, evidence },
      }];
    }
  }

  const equality = splitTopLevelOperator(evidence, "=");
  if (equality) {
    const field = parseFieldIdentifier(equality[0]);
    const fixed = parseFixedValue(equality[1]);
    if (field && fixed.resolved) {
      return [{
        channel: "filter",
        value: { kind: "fixed-equals", field, value: fixed.value, evidence },
      }];
    }
  }
  return [{ channel: "unresolved", evidence }];
}

function queryPipeline(itemsLiteral) {
  let expression = String(itemsLiteral || "").trim().replace(/^=/, "").trim();
  const filterClauses = [];
  const searchClauses = [];
  for (let depth = 0; depth < 12; depth += 1) {
    const source = parseFieldIdentifier(expression);
    if (source) return { source, filterClauses, searchClauses };
    const aliased = topLevelLogicalParts(expression, ["As"]);
    if (aliased?.length === 2 && parseFieldIdentifier(aliased[1])) {
      expression = aliased[0];
      continue;
    }
    const sortArgs = parseExactCall(expression, "Sort") || parseExactCall(expression, "SortByColumns");
    if (sortArgs?.length) {
      expression = sortArgs[0];
      continue;
    }
    const filterArgs = parseExactCall(expression, "Filter");
    if (filterArgs?.length >= 2) {
      filterClauses.push(...filterArgs.slice(1));
      expression = filterArgs[0];
      continue;
    }
    const searchArgs = parseExactCall(expression, "Search");
    if (searchArgs?.length >= 3) {
      const input = parseInputReference(searchArgs[1]);
      for (const declaration of searchArgs.slice(2)) {
        const field = parseFieldIdentifier(declaration);
        if (input && field) searchClauses.push({ kind: "contains", field, input, optional: true, evidence: expression });
      }
      expression = searchArgs[0];
      continue;
    }
    return { source: null, filterClauses, searchClauses };
  }
  return { source: null, filterClauses, searchClauses };
}

function translateFilterAndSearch(itemsLiteral, source) {
  let pipeline = queryPipeline(itemsLiteral);
  if (pipeline.source !== source) {
    const candidates = embeddedFunctionCalls(itemsLiteral, "Filter")
      .map(queryPipeline)
      .filter(candidate => candidate.source === source && candidate.filterClauses.length);
    if (candidates.length) pipeline = candidates[0];
  }
  if (pipeline.source !== source || !pipeline.filterClauses.length) {
    return {
      filter: unresolved("filter-not-proven", { values: [], unresolved: [] }),
      search: pipeline.searchClauses.length
        ? { status: "resolved", values: pipeline.searchClauses, unresolved: [] }
        : unresolved("search-not-proven", { values: [], unresolved: [] }),
    };
  }

  const translated = pipeline.filterClauses.flatMap(parseFilterClauses);
  const unresolvedClauses = translated
    .filter(item => item.channel === "unresolved")
    .map(item => ({ evidence: item.evidence, reason: "filter-clause-not-translatable" }));
  const resultFor = channel => {
    const values = [
      ...translated.filter(item => item.channel === channel).map(item => item.value),
      ...(channel === "search" ? pipeline.searchClauses : []),
    ];
    if (unresolvedClauses.length && values.length === 0) {
      return unresolved(`${channel}-clauses-not-translatable`, {
        values,
        unresolved: unresolvedClauses,
      });
    }
    return {
      status: unresolvedClauses.length ? "partial" : "resolved",
      values,
      unresolved: unresolvedClauses,
    };
  };
  return { filter: resultFor("filter"), search: resultFor("search") };
}

function splitTopLevelStatements(literal) {
  const formula = String(literal || "").trim().replace(/^=/, "");
  const values = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index];
    if (quote) {
      if (character === quote && formula[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === ";" && depth === 0) {
      const statement = formula.slice(start, index).trim();
      if (statement) values.push(statement);
      start = index + 1;
    }
  }
  const statement = formula.slice(start).trim();
  if (statement) values.push(statement);
  return values;
}

function translateAction(action, operation, artifact) {
  const evidence = String(action?.onSelect || "").trim();
  const controlName = action?.controlName || "";
  const statements = splitTopLevelStatements(evidence);

  if (action?.kind === "select-parent") {
    const selectArgs = parseExactCall(statements[0], "Select");
    if (statements.length === 1 && selectArgs?.length === 1 && selectArgs[0] === "Parent") {
      return { status: "resolved", value: { kind: "select", controlName, evidence } };
    }
  }

  if (statements.length !== 1) {
    return unresolved("action-not-translatable", { controlName, evidence });
  }

  const editStatement = parseExactCall(statements[0], "EditForm") ? statements[0] : null;
  if (editStatement) {
    const editArgs = parseExactCall(editStatement, "EditForm");
    const formName = editArgs?.length === 1 ? parseFieldIdentifier(editArgs[0]) : null;
    if (!operation.actions?.includes("edit")) {
      return unresolved("action-not-proven-by-operation", { controlName, evidence });
    }
    if (formName) {
      return {
        status: "resolved",
        value: { kind: "edit", controlName, formName, evidence },
      };
    }
  }

  const navigateStatement = parseExactCall(statements[0], "Navigate") ? statements[0] : null;
  if (navigateStatement) {
    const navigateArgs = parseExactCall(navigateStatement, "Navigate");
    const target = navigateArgs?.length >= 1 ? parseFieldIdentifier(navigateArgs[0]) : null;
    if (!artifact.actions?.includes("navigate")) {
      return unresolved("action-not-proven-by-artifact", { controlName, evidence });
    }
    if (target) {
      return {
        status: "resolved",
        value: { kind: "navigate", controlName, target, evidence },
      };
    }
  }

  return unresolved("action-not-translatable", { controlName, evidence });
}

function translatePrimaryAction(primaryAction, operation) {
  if (primaryAction?.status !== "resolved") return null;
  const evidence = String(primaryAction.onSelect || "").trim();
  const controlName = primaryAction.controlName || "";
  const setArgs = parseExactCall(evidence, "Set");
  if (
    operation.actions?.includes("view")
    && setArgs?.length === 2
    && parseFieldIdentifier(setArgs[0])
    && setArgs[1].trim() === "ThisItem"
  ) {
    return {
      status: "resolved",
      value: { kind: "select", controlName, evidence },
    };
  }
  const contextArgs = parseExactCall(evidence, "UpdateContext");
  if (operation.actions?.includes("view") && contextArgs?.length === 1) {
    const record = contextArgs[0].trim();
    if (record.startsWith("{") && record.endsWith("}")) {
      const assignment = splitTopLevelOperator(record.slice(1, -1), ":");
      if (
        assignment
        && parseFieldIdentifier(assignment[0])
        && assignment[1].trim() === "ThisItem"
      ) {
        return {
          status: "resolved",
          value: { kind: "select", controlName, evidence },
        };
      }
    }
  }
  return unresolved("action-not-translatable", { controlName, evidence });
}

function translateActions(actions, primaryAction, operation, artifact) {
  const primary = translatePrimaryAction(primaryAction, operation);
  const translated = [
    ...(primary ? [primary] : []),
    ...(Array.isArray(actions) ? actions : [])
      .map(action => translateAction(action, operation, artifact)),
  ];
  const values = translated.filter(item => item.status === "resolved").map(item => item.value);
  const unresolvedActions = translated
    .filter(item => item.status === "unresolved")
    .map(({ controlName, reason, evidence }) => ({ controlName, reason, evidence }));
  if (!values.length) {
    return unresolved("actions-not-translatable", { values, unresolved: unresolvedActions });
  }
  return {
    status: unresolvedActions.length ? "partial" : "resolved",
    values,
    unresolved: unresolvedActions,
  };
}

function visibleFieldsContract(fields) {
  const values = [...new Set(
    (Array.isArray(fields) ? fields : [])
      .filter(field => typeof field === "string")
      .map(field => field.trim())
      .filter(Boolean),
  )];
  if (!values.length) {
    return unresolved("visible-fields-not-proven", { values });
  }
  return {
    status: "resolved",
    values,
    evidence: "ThisItem field references extracted from the exact Gallery",
  };
}

export function resolvePowerAppsGalleryUiContract(gallery, artifacts = POWERAPPS_ARTIFACTS) {
  const identity = identityFor(gallery);
  const artifactMatches = (Array.isArray(artifacts) ? artifacts : [])
    .filter(entry => entry?.artifact === identity.fileName);

  if (artifactMatches.length !== 1) {
    const reason = artifactMatches.length === 0
      ? "exact-artifact-not-found"
      : "exact-artifact-ambiguous";
    return {
      status: "unresolved",
      identity,
      artifact: unresolved(reason),
      binding: unresolved(reason),
      visibleFields: unresolved("binding-unresolved", { values: [] }),
      sort: unresolved("binding-unresolved"),
      filter: unresolved("binding-unresolved", { values: [] }),
      search: unresolved("binding-unresolved", { values: [] }),
      actions: unresolved("binding-unresolved", { values: [], unresolved: [] }),
    };
  }

  const artifact = artifactMatches[0];
  const artifactContract = {
    status: "resolved",
    artifact: artifact.artifact,
    moduleId: artifact.moduleId,
  };
  const items = gallery?.formulas?.items;
  const rootSource = items?.status === "resolved" ? rootSourceFromItems(items.literal) : null;
  const embeddedSources = items?.status === "resolved" ? embeddedFilterSources(items.literal) : [];
  const operationMatches = items?.status === "resolved"
    ? (artifact.operations || []).filter(operation => (
      typeof operation?.entityId === "string"
      && operation.entityId.length > 0
      && typeof operation?.source === "string"
      && (operation.source === rootSource || (!rootSource && embeddedSources.length === 1 && operation.source === embeddedSources[0]))
    ))
    : [];

  if (operationMatches.length !== 1) {
    const reason = items?.status !== "resolved"
      ? "items-formula-unresolved"
      : operationMatches.length === 0
        ? "operation-not-proven-by-items"
        : "operation-ambiguous-for-items";
    return {
      status: "unresolved",
      identity,
      artifact: artifactContract,
      binding: unresolved(reason),
      visibleFields: unresolved("binding-unresolved", { values: [] }),
      sort: unresolved("binding-unresolved"),
      filter: unresolved("binding-unresolved", { values: [] }),
      search: unresolved("binding-unresolved", { values: [] }),
      actions: unresolved("binding-unresolved", { values: [], unresolved: [] }),
    };
  }

  const operation = operationMatches[0];
  const translatedQueries = translateFilterAndSearch(items.literal, operation.source);
  return {
    status: "resolved",
    identity,
    artifact: artifactContract,
    binding: {
      status: "resolved",
      source: operation.source,
      entityId: operation.entityId,
      actions: [...(operation.actions || [])],
      evidence: [...(operation.evidence || [])],
    },
    visibleFields: visibleFieldsContract(gallery.visibleFields),
    sort: translateSort(items.literal),
    filter: translatedQueries.filter,
    search: translatedQueries.search,
    actions: translateActions(gallery.actions, gallery.primaryAction, operation, artifact),
  };
}

export function buildPowerAppsGalleryUiContracts({
  galleryCatalog = POWERAPPS_GALLERY_CONTRACTS,
  artifacts = POWERAPPS_ARTIFACTS,
} = {}) {
  const galleries = Array.isArray(galleryCatalog?.galleries) ? galleryCatalog.galleries : [];
  const matrixArtifacts = Array.isArray(artifacts) ? artifacts : [];
  return deepFreeze({
    schemaVersion: 1,
    source: {
      gallerySchemaVersion: galleryCatalog?.schemaVersion ?? null,
      galleryCount: galleries.length,
      artifactCount: matrixArtifacts.length,
    },
    galleries: galleries.map(gallery => (
      resolvePowerAppsGalleryUiContract(gallery, matrixArtifacts)
    )),
  });
}

export const POWERAPPS_GALLERY_UI_CONTRACTS = buildPowerAppsGalleryUiContracts();

export function galleryUiContractsForEntity(
  entityId,
  catalog = POWERAPPS_GALLERY_UI_CONTRACTS,
) {
  if (typeof entityId !== "string" || !entityId) return Object.freeze([]);
  return Object.freeze((catalog?.galleries || []).filter(contract => (
    contract?.binding?.status === "resolved"
    && contract.binding.entityId === entityId
  )));
}

export default POWERAPPS_GALLERY_UI_CONTRACTS;
