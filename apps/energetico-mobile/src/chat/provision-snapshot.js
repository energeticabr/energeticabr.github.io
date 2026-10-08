const decimal = value => typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
const fields = ["product", "quantity", "unitPrice", "unitPriceDisplay", "freight", "freightDisplay", "total", "totalDisplay"];
const detailFields = ["supplier", "branch", "property", "paymentMethod", "dueDate", "observation"];

export function normalizeProvisionSnapshot(value) {
  if (!value || typeof value.id !== "string" || !value.id.trim() || value.currency !== "BRL"
    || !Array.isArray(value.lines) || value.count !== value.lines.length
    || !decimal(value.total) || typeof value.totalDisplay !== "string") return undefined;
  if ([...value.lines].some(line => !line || !Number.isInteger(line.index) || line.index < 1
    || fields.some(key => typeof line[key] !== "string")
    || ["quantity", "unitPrice", "freight", "total"].some(key => !decimal(line[key]))
    || !line.details || detailFields.some(key => typeof line.details[key] !== "string"))) return undefined;
  return Object.freeze({
    id: value.id, currency: "BRL", count: value.count, total: value.total, totalDisplay: value.totalDisplay,
    lines: Object.freeze(value.lines.map(line => Object.freeze({
      index: line.index,
      ...Object.fromEntries(fields.map(key => [key, line[key]])),
      details: Object.freeze(Object.fromEntries(detailFields.map(key => [key, line.details[key]]))),
    }))),
  });
}
