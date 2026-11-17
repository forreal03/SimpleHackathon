// Small helpers for the runtime modules (ES2019, no platform APIs).

/** Own-property check that ignores the prototype chain (`constructor`, `__proto__`, `toString`). */
export function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Rounds to `digits` decimal places, halves away from zero: roundTo(2.5) = 3, roundTo(-2.5) = -3.
 * Shifts through the decimal string, so values that print as 1.005 or 2.675 round the way people
 * expect (1.01, 2.68). The formula function `round` and every `precision` use this. Never returns -0.
 */
export function roundTo(value: number, digits = 0): number {
  if (!Number.isInteger(digits)) throw new Error(`반올림 자릿수는 정수여야 합니다: ${digits}`);
  if (!Number.isFinite(value)) return value;
  const rounded = shift(Math.round(shift(Math.abs(value), digits)), -digits);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/** x × 10^by without binary rounding error: rewrites the exponent of x's decimal form. */
function shift(x: number, by: number): number {
  const [mantissa, exponent = "0"] = String(x).split("e");
  return Number(`${mantissa}e${Number(exponent) + by}`);
}
