/** Number, currency and date formatting for an INR, India-first audience. */

const inr0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const num2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DASH = "—";
type Maybe = number | null | undefined;

const missing = (v: Maybe): v is null | undefined => v === null || v === undefined || Number.isNaN(v);
/** Typographic minus, so negatives line up with the signed formats. */
const minus = (text: string): string => text.replace(/^-/, "−");
/** True when a value would print as zero at this precision. */
const roundsToZero = (v: number, digits: number): boolean => Math.abs(v) < 0.5 / 10 ** digits;

/** ₹4,82,400 — whole rupees. */
export function inr(v: Maybe): string {
  return missing(v) ? DASH : minus(inr0.format(roundsToZero(v, 0) ? 0 : v));
}

/** ₹1,420.50 — for prices. */
export function price(v: Maybe): string {
  return missing(v) ? DASH : minus(inr2.format(v));
}

/** ₹4.82L / ₹1.25Cr — lakh and crore, the units Indian investors think in. */
export function compact(v: Maybe, digits = 2): string {
  if (missing(v)) return DASH;
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}₹${(abs / 1e12).toFixed(digits)}L Cr`;
  if (abs >= 1e10) return `${sign}₹${num0.format(abs / 1e7)}Cr`;
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(digits)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(digits)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(digits === 0 ? 0 : 1).replace(/\.0$/, "")}K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

/** +₹12,400 / −₹3,100 — signed amounts for P&L. */
export function signedInr(v: Maybe): string {
  if (missing(v)) return DASH;
  const body = inr0.format(Math.abs(v));
  if (roundsToZero(v, 0)) return body;
  return v > 0 ? `+${body}` : `−${body}`;
}

export function signedCompact(v: Maybe): string {
  if (missing(v)) return DASH;
  const body = compact(Math.abs(v));
  return v > 0 ? `+${body}` : v < 0 ? `−${body}` : body;
}

/** 12.4% from a value already in percent. */
export function pct(v: Maybe, digits = 2): string {
  if (missing(v)) return DASH;
  return `${v < 0 && !roundsToZero(v, digits) ? "−" : ""}${Math.abs(v).toFixed(digits)}%`;
}

/** +12.4% / −3.1% from a value already in percent. */
export function signedPct(v: Maybe, digits = 2): string {
  if (missing(v)) return DASH;
  const body = `${Math.abs(v).toFixed(digits)}%`;
  if (roundsToZero(v, digits)) return body;
  return v > 0 ? `+${body}` : `−${body}`;
}

/** Percent from a fraction (0.124 → 12.4%). */
export function ratioPct(v: Maybe, digits = 2): string {
  return missing(v) ? DASH : pct(v * 100, digits);
}

export function signedRatioPct(v: Maybe, digits = 2): string {
  return missing(v) ? DASH : signedPct(v * 100, digits);
}

export function number(v: Maybe, digits = 0): string {
  if (missing(v)) return DASH;
  return minus(digits === 0 ? num0.format(v) : digits === 2 ? num2.format(v) : v.toFixed(digits));
}

/** Share quantities: whole numbers stay whole, fractions keep up to 4 places. */
export function quantity(v: Maybe): string {
  if (missing(v)) return DASH;
  return Number.isInteger(v) ? num0.format(v) : v.toLocaleString("en-IN", { maximumFractionDigits: 4 });
}

/** 12.4L / 3.2Cr shares or rupees without the currency sign. */
export function compactNumber(v: Maybe): string {
  if (missing(v)) return DASH;
  const abs = Math.abs(v);
  if (abs >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(v / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" });

function parse(value: string | Date): Date {
  if (value instanceof Date) return value;
  // Date-only strings are calendar days, not UTC instants.
  return value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
}

/** 12 Jan 2026 */
export function date(value: string | Date | null | undefined): string {
  return value ? dateFmt.format(parse(value)) : DASH;
}

/** 12 Jan */
export function shortDate(value: string | Date | null | undefined): string {
  return value ? shortFmt.format(parse(value)) : DASH;
}

/** Jan 26 */
export function monthYear(value: string | Date): string {
  return monthFmt.format(parse(value));
}

/** "2y 3m", "5 months", "12 days" from a day count. */
export function duration(days: Maybe): string {
  if (missing(days)) return DASH;
  if (days < 31) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest ? `${years}y ${rest}m` : `${years} year${years === 1 ? "" : "s"}`;
}

export function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Tone of a signed number: used to pick gain/loss colouring. */
export function tone(v: Maybe): "gain" | "loss" | "flat" {
  if (missing(v) || Math.abs(v) < 1e-9) return "flat";
  return v > 0 ? "gain" : "loss";
}
