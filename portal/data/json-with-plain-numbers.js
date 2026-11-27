// Standard JSON serialization handles escaping. Expand only numeric tokens
// with an exponent, leaving quoted strings and property names untouched.
const jsonNumberOrString = /"[^"\\]*(?:\\.[^"\\]*)*"|(-?\d+(?:\.\d+)?[eE][+-]?\d+)/g;

function expandExponent(number) {
  const [coefficient, exponent] = number.split(/[eE]/);
  const sign = coefficient.startsWith("-") ? "-" : "";
  const [whole, fraction = ""] = coefficient.slice(sign.length).split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return sign + "0." + "0".repeat(-point) + digits;
  if (point >= digits.length) return sign + digits.padEnd(point, "0");
  return sign + digits.slice(0, point) + "." + digits.slice(point);
}

export function stringifyJsonWithPlainNumbers(value) {
  return JSON.stringify(value)?.replace(jsonNumberOrString, (token, number) =>
    number === undefined ? token : expandExponent(number));
}
