const decimal = value => typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value);

export function normalizeLaunchSnapshot(value) {
  if (!value || typeof value.id !== "string" || !value.id || value.currency !== "BRL"
    || !Array.isArray(value.lines) || value.count !== value.lines.length
    || !decimal(value.total) || typeof value.totalDisplay !== "string") return undefined;
  const fields = ["product", "unit", "quantity", "unitPrice", "unitPriceDisplay", "freight", "freightDisplay", "total", "totalDisplay"];
  if (value.lines.some(line => !line || !Number.isInteger(line.index) || line.index < 1
    || fields.some(key => typeof line[key] !== "string")
    || ["quantity", "unitPrice", "freight", "total"].some(key => !decimal(line[key])))) return undefined;
  return Object.freeze({ id: value.id, currency: "BRL", count: value.count, total: value.total,
    totalDisplay: value.totalDisplay, lines: Object.freeze(value.lines.map(line => Object.freeze({
      index: line.index, ...Object.fromEntries(fields.map(key => [key, line[key]])),
    }))),
  });
}
