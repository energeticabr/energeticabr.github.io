function mod10(value) {
  const sum = [...value].reverse().reduce((total, digit, index) => {
    const product = Number(digit) * (index % 2 ? 1 : 2);
    return total + Math.floor(product / 10) + product % 10;
  }, 0);
  return (10 - sum % 10) % 10;
}

export function ddaLineFromBarcode(barcode) {
  // Boleto de cobrança em reais: banco, moeda 9, DV geral, fator, valor e campo livre.
  if (!/^\d{3}9\d{40}$/.test(barcode)) return '';
  const data = barcode.slice(0, 4) + barcode.slice(5);
  const sum = [...data].reverse().reduce((total, digit, index) =>
    total + Number(digit) * (2 + index % 8), 0);
  const check = 11 - sum % 11;
  if (String(check > 9 ? 1 : check) !== barcode[4]) return '';

  const first = barcode.slice(0, 4) + barcode.slice(19, 24);
  const second = barcode.slice(24, 34);
  const third = barcode.slice(34);
  return first + mod10(first) + second + mod10(second) + third + mod10(third)
    + barcode[4] + barcode.slice(5, 19);
}

function stripFormatting(value) {
  return typeof value === 'string' ? value.replace(/[\s.-]/g, '') : '';
}

export function resolveDdaPaymentLine(rawLine, rawBarcode) {
  const line = stripFormatting(rawLine);
  const fromBarcode = ddaLineFromBarcode(stripFormatting(rawBarcode));
  if (/^\d{47}$/.test(line)) {
    const barcode = line.slice(0, 4) + line.slice(32, 47)
      + line.slice(4, 9) + line.slice(10, 20) + line.slice(21, 31);
    if (ddaLineFromBarcode(barcode) === line) {
      return fromBarcode && fromBarcode !== line ? '' : line;
    }
  }
  return fromBarcode;
}
