/** Small pieces shared by the analytics pages (risk, x-ray, dividends, compare). */
import type { ReactNode } from "react";
import { DASH, number, pct, signedPct } from "@/lib/format";
import { cn } from "@/lib/utils";

type Maybe = number | null | undefined;

const missing = (v: Maybe): v is null | undefined => v === null || v === undefined || Number.isNaN(v);

/** A plain ratio such as beta, Sharpe or a correlation: typographic minus, no plus sign. */
export function ratio(v: Maybe, digits = 2): string {
  if (missing(v)) return DASH;
  const body = number(Math.abs(v), digits);
  return v < 0 && Number(body) !== 0 ? `−${body}` : body;
}

/**
 * A fraction that would print as zero at `digits` percent decimals becomes exactly zero, so a
 * holding that barely moved shows "0.0%" in a neutral tone rather than a red "−0.0%".
 */
export function settle(v: Maybe, digits = 2): number | null {
  if (missing(v)) return null;
  return Math.abs(v) * 100 < 0.5 / 10 ** digits ? 0 : v;
}

/** A share of a whole that is already in percent. Rounds dust to zero and keeps a real minus sign. */
export function sharePct(v: Maybe, digits = 1): string {
  if (missing(v)) return DASH;
  const clean = Math.abs(v) < 0.5 / 10 ** digits ? 0 : v;
  return clean < 0 ? signedPct(clean, digits) : pct(clean, digits);
}

/** Dims its children while a newer answer is on the way, so stale figures are not mistaken for fresh ones. */
export function Pending({ active, children, className }: { active: boolean; children: ReactNode; className?: string }) {
  return (
    <div aria-busy={active || undefined} className={cn("transition-opacity duration-200", active && "opacity-55", className)}>
      {children}
    </div>
  );
}

/** A round identity dot in a series colour. */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: color }} />;
}
