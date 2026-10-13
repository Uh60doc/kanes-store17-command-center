export type ReportedPrecision = 'whole_dollar' | 'cents';

export interface Money {
  cents: number;
  precision: ReportedPrecision;
}

export interface DecimalToken {
  /** Numeric value, not scaled to cents. */
  value: number;
  fractionDigits: number;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export function parseDecimal(token: string): DecimalToken | null {
  const cleaned = token.trim().replace(/\$/g, '').replace(/,/g, '');
  const match = DECIMAL.exec(cleaned);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2]);
  const frac = match[3] ?? '';
  const fraction = frac.length === 0 ? 0 : Number(frac) / 10 ** frac.length;
  return { value: sign * (whole + fraction), fractionDigits: frac.length };
}

/** Dollars from a report cell. One-decimal `.0` values stay whole-dollar precision. */
export function toCents(token: string): Money | null {
  const parsed = parseDecimal(token);
  if (!parsed) return null;
  if (parsed.fractionDigits === 0) {
    return { cents: Math.round(parsed.value * 100), precision: 'whole_dollar' };
  }
  if (parsed.fractionDigits === 1) {
    return { cents: Math.round(parsed.value * 100), precision: 'whole_dollar' };
  }
  if (parsed.fractionDigits === 2) {
    return { cents: Math.round(parsed.value * 100), precision: 'cents' };
  }
  return null;
}

export function formatMoneyCents(cents: number, precision: ReportedPrecision): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const dollars = Math.trunc(absolute / 100);
  const remainder = absolute % 100;
  const body = dollars.toLocaleString('en-US');
  if (precision === 'whole_dollar') return `${sign}$${body}`;
  return `${sign}$${body}.${String(remainder).padStart(2, '0')}`;
}

export function dominantPrecision(values: readonly Money[]): ReportedPrecision {
  return values.some((value) => value.precision === 'cents') ? 'cents' : 'whole_dollar';
}
