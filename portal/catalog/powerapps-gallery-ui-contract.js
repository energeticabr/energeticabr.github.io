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

function parseInputReference(literal) {
  const value = String(literal || "").trim();
  const identifier = "(?:'(?:''|[^'])+'|[\\p{L}_][\\p{L}\\p{N}_]*)";
  return new RegExp(`^${identifier}(?:\\.${identifier})+$`, "u").test(value) ? value : null;
}

function parseFixedValue(literal) {
  const value = String(literal || "").trim();
  if (/^(true|false)$/iu.test(value)) return { resolved: true, value: value.toLowerCase() === "true" };
  if (/^-?(?:\d+|\d*\.\d+)$/u.test(value)) return { resolved: true, value: Number(value) };
  const text = /^"((?:""|[^"])*)"$/u.exec(value);
  if (text) return { resolved: true, value: text[1].replace(/""/g, '"') };
  return { resolved: false };
}

function parseFilterClause(literal) {
  const evidence = stripOuterParentheses(literal);
  const optional = splitTopLevelOperator(evidence, "||");
  if (optional) {
    const blankArgs = parseExactCall(optional[0], "IsBlank");
    if (blankArgs?.length === 1) {
      const input = parseInputReference(blankArgs[0]);
      const startsWithArgs = parseExactCall(optional[1], "StartsWith");
      if (input && startsWithArgs?.length === 2) {
        const field = parseFieldIdentifier(startsWithArgs[0]);
        if (field && startsWithArgs[1].trim() === input) {
          return {
            channel: "search",
            value: { kind: "starts-with", field, input, optional: true, evidence },
          };
        }
      }

      const equality = splitTopLevelOperator(optional[1], "=");
      if (input && equality) {
        const field = parseFieldIdentifier(equality[0]);
        if (field && equality[1].trim() === input) {
          return {
            channel: "filter",
            value: { kind: "optional-equals", field, input, evidence },
          };
        }
      }
    }
  }

  const startsWithArgs = parseExactCall(evidence, "StartsWith");
  if (startsWithArgs?.length === 2) {
    const field = parseFieldIdentifier(startsWithArgs[0]);
    const input = parseInputReference(startsWithArgs[1]);
    if (field && input) {
      return {
        channel: "search",
        value: { kind: "starts-with", field, input, optional: false, evidence },
      };
    }
  }

  const equality = splitTopLevelOperator(evidence, "=");
  if (equality) {
    const field = parseFieldIdentifier(equality[0]);
    const fixed = parseFixedValue(equality[1]);
    if (field && fixed.resolved) {
      return {
        channel: "filter",
        value: { kind: "fixed-equals", field, value: fixed.value, evidence },
      };
    }
  }
  return { channel: "unresolved", evidence };
}

function translateFilterAndSearch(itemsLiteral, source) {
  const sortArgs = parseExactCall(itemsLiteral, "Sort")
    || parseExactCall(itemsLiteral, "SortByColumns");
  const dataExpression = sortArgs?.[0] || String(itemsLiteral || "").trim();
  const filterArgs = parseExactCall(dataExpression, "Filter");
  if (!filterArgs || filterArgs.length < 2 || parseFieldIdentifier(filterArgs[0]) !== source) {
    return {
      filter: unresolved("filter-not-proven", { values: [], unresolved: [] }),
      search: unresolved("search-not-proven", { values: [], unresolved: [] }),
    };
  }

  const translated = filterArgs.slice(1).map(parseFilterClause);
  const unresolvedClauses = translated
    .filter(item => item.channel === "unresolved")
    .map(item => ({ evidence: item.evidence, reason: "filter-clause-not-translatable" }));
  const resultFor = channel => {
    const values = translated.filter(item => item.channel === channel).map(item => item.value);
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
  const operationMatches = items?.status === "resolved"
    ? (artifact.operations || []).filter(operation => (
      typeof operation?.entityId === "string"
      && operation.entityId.length > 0
      && typeof operation?.source === "string"
      && operation.source === rootSource
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
