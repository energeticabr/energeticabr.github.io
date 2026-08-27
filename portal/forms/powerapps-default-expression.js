function normalize(value) {
  return String(value || "").trim().replace(/^=/, "").trim().replace(/\s+/g, " ");
}

function canonical(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function quotedField(value) {
  const source = String(value || "").trim();
  const match = source.match(/^(?:'((?:''|[^'])+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]*))$/u);
  return String(match?.[1] || match?.[2] || "").replace(/''/g, "'").trim();
}

function splitTopLevel(value, delimiter) {
  const source = String(value || "");
  const parts = [];
  let start = 0;
  let depth = 0;
  let single = false;
  let double = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (double) {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') double = false;
      continue;
    }
    if (single) {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") single = false;
      continue;
    }
    if (character === '"') double = true;
    else if (character === "'") single = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth === 0 && source.startsWith(delimiter, index)) {
      parts.push(source.slice(start, index).trim());
      start = index + delimiter.length;
      index += delimiter.length - 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function call(value) {
  const source = normalize(value);
  const match = source.match(/^([A-Za-z][A-Za-z0-9]*)\s*\(/);
  if (!match) return null;
  const open = source.indexOf("(", match[0].length - 1);
  let depth = 0;
  let single = false;
  let double = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (double) {
      if (character === '"' && next === '"') index += 1;
      else if (character === '"') double = false;
      continue;
    }
    if (single) {
      if (character === "'" && next === "'") index += 1;
      else if (character === "'") single = false;
      continue;
    }
    if (character === '"') double = true;
    else if (character === "'") single = true;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth === 0) return { name: match[1].toLowerCase(), args: splitTopLevel(source.slice(open + 1, index), ","), suffix: source.slice(index + 1).trim() };
  }
  return null;
}

function stringLiteral(value) {
  const source = String(value || "").trim();
  return source.startsWith('"') && source.endsWith('"') ? source.slice(1, -1).replace(/""/g, '"') : null;
}

function recordReference(value) {
  const source = String(value || "").trim();
  const match = source.match(/^(?:(?:Gallery[A-Za-z0-9_]*\.Selected)|ThisItem)\.(?:'((?:''|[^'])+)'|([A-Za-zÀ-ÖØ-öø-ÿ_][A-Za-zÀ-ÖØ-öø-ÿ0-9_ ]*))$/iu);
  const field = String(match?.[1] || match?.[2] || "").replace(/''/g, "'").trim();
  return field ? { type: "record", field } : null;
}

function unwrapCollection(value) {
  let source = String(value || "").trim();
  if (source.startsWith("[") && source.endsWith("]")) source = source.slice(1, -1).trim();
  const wrapper = call(source);
  if (wrapper?.name === "table" && wrapper.args.length === 1 && !wrapper.suffix) source = wrapper.args[0];
  return source;
}

function identitySelection(value, fieldName) {
  const expression = call(unwrapCollection(value));
  if (!expression || !["lookup", "filter"].includes(expression.name) || expression.args.length !== 2) return null;
  const predicate = splitTopLevel(expression.args[1], "=");
  if (predicate.length !== 2 || expression.args[1].includes("&&") || expression.args[1].includes("||")) return null;
  const leftReference = recordReference(predicate[0]);
  const rightReference = recordReference(predicate[1]);
  const reference = leftReference || rightReference;
  const comparedField = quotedField(leftReference ? predicate[1] : predicate[0]);
  const expectedFields = Array.isArray(fieldName) ? fieldName : [fieldName];
  if (!reference || !comparedField || !expectedFields.some(field => canonical(reference.field) === canonical(field))) return null;
  if (expression.suffix) {
    const suffixField = quotedField(expression.suffix.replace(/^\./, ""));
    if (!suffixField || canonical(suffixField) !== canonical(reference.field)) return null;
  }
  return reference;
}

function parse(value, fieldName, depth = 0) {
  const source = normalize(value);
  if (!source || depth > 10) return null;
  if (/^Today\(\)$/i.test(source)) return { type: "today" };
  if (/^Now\(\)$/i.test(source)) return { type: "now" };
  const arithmetic = source.match(/^(Today|Now)\(\)\s*([+-])\s*(\d+)$/i);
  if (arithmetic) return { type: "date-add", base: { type: arithmetic[1].toLowerCase() }, amount: Number(arithmetic[3]) * (arithmetic[2] === "-" ? -1 : 1), unit: "days" };
  const session = source.match(/^User\(\)\.(Email|FullName)$/i);
  if (session) return { type: "session", field: session[1].toLowerCase() === "email" ? "email" : "name" };
  const directRecord = recordReference(source);
  if (directRecord) return directRecord;
  const expression = call(source);
  if (expression?.name === "if" && expression.args.length === 3 && !expression.suffix) {
    const condition = splitTopLevel(expression.args[0], "=");
    if (condition.length === 2) {
      const blankIndex = condition.findIndex(part => /^Blank\(\)$/i.test(normalize(part)));
      const reference = blankIndex === 0
        ? recordReference(condition[1])
        : blankIndex === 1
          ? recordReference(condition[0])
          : null;
      const fallback = stringLiteral(expression.args[1]);
      const alternate = recordReference(expression.args[2]);
      const expectedFields = Array.isArray(fieldName) ? fieldName : [fieldName];
      if (
        reference
        && alternate
        && canonical(reference.field) === canonical(alternate.field)
        && expectedFields.some(field => canonical(reference.field) === canonical(field))
        && fallback !== null
      ) {
        return { type: "record-blank-fallback", field: reference.field, fallback };
      }
    }
  }
  if (expression?.name === "param" && expression.args.length === 1 && !expression.suffix) {
    const field = stringLiteral(expression.args[0]);
    return field && field.length <= 128 ? { type: "route", field } : null;
  }
  if (["upper", "lower"].includes(expression?.name) && expression.args.length === 1 && !expression.suffix) {
    const inner = parse(expression.args[0], fieldName, depth + 1);
    return inner ? { type: "transform", operation: expression.name, value: inner } : null;
  }
  if (expression?.name === "dateadd" && expression.args.length === 3 && !expression.suffix) {
    const base = parse(expression.args[0], fieldName, depth + 1);
    const amount = Number(expression.args[1]);
    const unit = String(expression.args[2]).match(/^(?:TimeUnit\.)?(Days|Months|Years)$/i)?.[1]?.toLowerCase();
    return base && ["today", "now", "date-add"].includes(base.type) && Number.isInteger(amount) && Math.abs(amount) <= 10000 && unit
      ? { type: "date-add", base, amount, unit }
      : null;
  }
  if (!source.includes("&&")) {
    const parts = splitTopLevel(source, "&");
    if (parts.length > 1 && parts.length <= 24) {
      const parsed = parts.map(part => {
        const literal = stringLiteral(part);
        return literal === null ? parse(part, fieldName, depth + 1) : { type: "literal", value: literal };
      });
      if (parsed.every(Boolean)) return { type: "concat", parts: parsed };
    }
  }
  return identitySelection(source, fieldName);
}

export function compilePowerAppsDefaultExpression(formula, fieldName = "") {
  return parse(formula, fieldName);
}
