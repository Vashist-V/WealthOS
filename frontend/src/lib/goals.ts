/**
 * The same sums the server does for a goal, for the two places that cannot wait
 * for it: the preview in the goal form as it is typed, and the curve on a
 * goal's card. Every result a card states (what is needed each month, whether
 * the plan gets there) comes from the server; see backend/app/quant/goals.py.
 */

/** The monthly growth that compounds to the given yearly growth. */
const monthlyRate = (annual: number): number => (1 + annual) ** (1 / 12) - 1;

/** What `present` becomes after `months`, with `monthly` added at the end of each month. */
export function futureValue(present: number, monthly: number, annual: number, months: number): number {
  if (months <= 0) return present;
  const r = monthlyRate(annual);
  const growth = (1 + r) ** months;
  return present * growth + (r ? (monthly * (growth - 1)) / r : monthly * months);
}

/** The monthly amount that turns `present` into `target` in `months`. Zero if `present` gets there by itself. */
export function requiredMonthly(target: number, present: number, annual: number, months: number): number {
  if (months <= 0) return Math.max(target - present, 0);
  const r = monthlyRate(annual);
  const growth = (1 + r) ** months;
  const shortfall = target - present * growth;
  if (shortfall <= 0) return 0;
  return r ? (shortfall * r) / (growth - 1) : shortfall / months;
}

/** Whole months from today to a YYYY-MM-DD date; zero when it is not in the future. */
export function monthsUntil(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return 0;
  const now = new Date();
  let months = (year - now.getFullYear()) * 12 + (month - 1 - now.getMonth());
  if (day < now.getDate()) months -= 1;
  return Math.max(months, 0);
}

/** The first of each month from this one to `months` ahead, as YYYY-MM-DD: the dates a goal's curve is drawn over. */
export function monthsAhead(months: number): string[] {
  const now = new Date();
  return Array.from({ length: months + 1 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
}
