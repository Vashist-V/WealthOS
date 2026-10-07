/** Formatting and small building blocks shared by the Market, Stock, Watchlists, Calendar and Alerts pages. */
import type { ReactNode } from "react";
import { SymbolCell } from "@/components/ui";
import { compact, DASH, number, price } from "@/lib/format";

type Maybe = number | null | undefined;
const missing = (v: Maybe): v is null | undefined => v === null || v === undefined || Number.isNaN(v);

/** "2.3× avg": today's volume against the average of the previous 20 sessions. */
export function relativeVolume(v: Maybe): string {
  return missing(v) ? DASH : `${number(v, 1)}× avg`;
}

/** Market caps and traded value. `compact` leaves ₹100 Cr–₹1L Cr ungrouped ("₹84750.14Cr"), so that band is grouped here. */
export function bigInr(v: Maybe): string {
  if (missing(v)) return DASH;
  const abs = Math.abs(v);
  return abs >= 1e10 && abs < 1e12 ? `₹${number(abs / 1e7, 0)}Cr` : compact(v);
}

/** "+₹12.40" / "−₹3.10": a signed price change to the paisa. `plain` drops the ₹ for index points. */
export function signedPrice(v: Maybe, plain = false): string {
  if (missing(v)) return DASH;
  const body = plain ? number(Math.abs(v), 2) : price(Math.abs(v));
  return v > 0 ? `+${body}` : v < 0 ? `−${body}` : body;
}

/** A level that is a price for stocks and plain points for indices. */
export function level(v: Maybe, plain = false): string {
  return plain ? number(v, 2) : price(v);
}

/** Valuation multiples such as P/E and P/B. */
export function multiple(v: Maybe): string {
  return number(v, 1);
}

/** Ticker and name for table cells. Narrow on phones so the numeric columns stay on screen. */
export function StockCell({ symbol, name, sub }: { symbol: string; name?: string | null; sub?: ReactNode }) {
  return (
    <div className="max-w-28 sm:max-w-56">
      <SymbolCell symbol={symbol} name={name} sub={sub} />
    </div>
  );
}

// ------------------------------------------------------------------ dates
/** A calendar day ("2026-10-06") as a local Date at midnight. */
export function parseDay(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00`);
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whole days from one calendar day to another; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

/** "today", "tomorrow", "in 3 days", "5 days ago", "in 4 months". */
export function relativeDay(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const n = Math.abs(days);
  const months = Math.round(n / 30.44);
  const span = n < 60 ? `${number(n)} days` : months < 12 ? `${months} months` : months < 24 ? "a year" : `${Math.floor(months / 12)} years`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const monthLong = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
const monthShort = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });
const dayMonthYear = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric" });
const weekdayLong = new Intl.DateTimeFormat("en-IN", { weekday: "long" });
const weekday = new Intl.DateTimeFormat("en-IN", { weekday: "short" });

/** "October 2026" */
export function monthTitle(d: Date): string {
  return monthLong.format(d);
}

/** "Mar 2025": the heading for a reporting period. */
export function periodLabel(iso: string): string {
  return monthShort.format(parseDay(iso));
}

/** "Thursday, 8 October 2026". Built from two parts because browsers disagree on where en-IN puts the comma. */
export function longDay(iso: string): string {
  const d = parseDay(iso);
  return `${weekdayLong.format(d)}, ${dayMonthYear.format(d)}`;
}

/** "Thu" */
export function weekdayShort(iso: string): string {
  return weekday.format(parseDay(iso));
}
