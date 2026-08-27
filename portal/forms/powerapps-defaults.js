function canonicalFieldName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toLocaleUpperCase("pt-BR");
}

function fieldValue(source, field) {
  if (!source || typeof source !== "object") return undefined;
  if (Object.hasOwn(source, field)) return source[field];
  const expected = canonicalFieldName(field);
  const matches = Object.keys(source).filter(name => canonicalFieldName(name) === expected);
  return matches.length === 1 ? source[matches[0]] : undefined;
}

function currentDate(context) {
  const candidate = context?.now instanceof Date ? new Date(context.now.getTime()) : new Date();
  return Number.isNaN(candidate.getTime()) ? null : candidate;
}

function dateText(value, includeTime = false) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return undefined;
  const pad = number => String(number).padStart(2, "0");
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return includeTime ? `${date}T${pad(value.getHours())}:${pad(value.getMinutes())}` : date;
}

function addDate(base, amount, unit) {
  const value = new Date(base.getTime());
  if (unit === "days") value.setDate(value.getDate() + amount);
  else if (unit === "months") value.setMonth(value.getMonth() + amount);
  else if (unit === "years") value.setFullYear(value.getFullYear() + amount);
  else return null;
  return value;
}

function evaluateDateExpression(expression, context, depth) {
  if (expression?.type === "today" || expression?.type === "now") return currentDate(context);
  if (expression?.type !== "date-add" || depth > 12) return null;
  const base = evaluateDateExpression(expression.base, context, depth + 1);
  const amount = Number(expression.amount);
  if (!base || !Number.isFinite(amount) || !Number.isInteger(amount) || Math.abs(amount) > 10000) return null;
  return addDate(base, amount, expression.unit);
}

export function evaluatePowerAppsDefaultExpression(expression, context = {}, depth = 0) {
  if (!expression || typeof expression !== "object" || depth > 12) return undefined;
  if (expression.type === "literal") return expression.value;
  if (expression.type === "today") return dateText(currentDate(context));
  if (expression.type === "now") return dateText(currentDate(context), true);
  if (expression.type === "date-add") {
    const date = evaluateDateExpression(expression, context, depth);
    return dateText(date, expression.base?.type === "now");
  }
  if (expression.type === "session") {
    const field = expression.field === "email" || expression.field === "name" ? expression.field : "";
    return field ? fieldValue(context.session, field) : undefined;
  }
  if (expression.type === "record") return fieldValue(context.record, expression.field);
  if (expression.type === "record-blank-fallback") {
    const current = fieldValue(context.record, expression.field);
    return current === undefined || current === null || String(current).trim() === ""
      ? expression.fallback
      : current;
  }
  if (expression.type === "route") return fieldValue(context.route, expression.field);
  if (expression.type === "transform") {
    const value = evaluatePowerAppsDefaultExpression(expression.value, context, depth + 1);
    if (value === undefined || value === null) return undefined;
    if (expression.operation === "upper") return String(value).toLocaleUpperCase("pt-BR");
    if (expression.operation === "lower") return String(value).toLocaleLowerCase("pt-BR");
    return undefined;
  }
  if (expression.type === "concat" && Array.isArray(expression.parts) && expression.parts.length <= 24) {
    const values = expression.parts.map(part => evaluatePowerAppsDefaultExpression(part, context, depth + 1));
    return values.some(value => value === undefined) ? undefined : values.map(value => String(value ?? "")).join("");
  }
  return undefined;
}

export function applyPowerAppsDefaultValues(columns = [], values = {}, options = {}) {
  const resolved = { ...(values || {}) };
  for (const column of columns || []) {
    const name = String(column?.name || "");
    if (!name) continue;
    if (options.mode === "edit") {
      const current = resolved[name];
      if (
        column.defaultExpression?.type === "record-blank-fallback"
        && (current === undefined || current === null || String(current).trim() === "")
      ) {
        const computed = evaluatePowerAppsDefaultExpression(column.defaultExpression, options.context || {});
        if (computed !== undefined) resolved[name] = computed;
      }
      continue;
    }
    if (Object.hasOwn(resolved, name)) continue;
    if (column.defaultValue !== undefined) {
      resolved[name] = column.defaultValue;
      continue;
    }
    const computed = evaluatePowerAppsDefaultExpression(column.defaultExpression, options.context || {});
    if (computed !== undefined) resolved[name] = computed;
  }
  return resolved;
}
