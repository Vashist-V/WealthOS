/** How a confidence score and the checks behind it are drawn, wherever they appear: trade check, the market scoreboard, the market chat. */
import { Check, ChevronDown, CircleHelp, Info, Minus, X, type LucideIcon } from "lucide-react";
import type { CheckVerdict, ScoreTone, TradeCheckItem } from "@/lib/types";
import { cn } from "@/lib/utils";

export const VERDICTS: Record<CheckVerdict, { icon: LucideIcon; label: string; className: string }> = {
  for: { icon: Check, label: "Supports the trade", className: "bg-gain-soft text-gain" },
  against: { icon: X, label: "Goes against it", className: "bg-loss-soft text-loss" },
  neutral: { icon: Minus, label: "Neutral", className: "bg-surface-3 text-ink-2" },
  info: { icon: Info, label: "A note, not scored", className: "bg-accent-soft text-accent" },
  unknown: { icon: CircleHelp, label: "No data", className: "bg-surface-3 text-muted" },
};
/** The same marks where there is no trade to support: a market, a sector, a company. */
const PLAIN: Record<CheckVerdict, string> = { for: "Positive", against: "Negative", neutral: "Neutral", info: "A note, not scored", unknown: "No data" };
export const TONES: Record<ScoreTone, string> = { for: "var(--gain)", mixed: "var(--warn)", against: "var(--loss)", unknown: "var(--muted)" };
const PILLS: Record<ScoreTone, string> = { for: "bg-gain-soft text-gain", mixed: "bg-warn-soft text-warn", against: "bg-loss-soft text-loss", unknown: "bg-surface-3 text-muted" };

export function VerdictMark({ verdict, plain, className }: { verdict: CheckVerdict; /** Say "Positive" and "Negative", not "Supports the trade". */ plain?: boolean; className?: string }) {
  const v = VERDICTS[verdict];
  const label = plain ? PLAIN[verdict] : v.label;
  return (
    <span role="img" aria-label={label} title={label} className={cn("flex size-[22px] shrink-0 items-center justify-center rounded-full", v.className, className)}>
      <v.icon className="size-3.5" strokeWidth={2.6} />
    </span>
  );
}

/** A score as a small coloured figure, for rows and headers. */
export function ScorePill({ value, tone, className }: { value: number | null; tone: ScoreTone; className?: string }) {
  return (
    <span
      title={value === null ? "Too little data to score" : `Confidence score ${value} out of 100`}
      className={cn("num inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-md px-1.5 text-xs font-semibold", PILLS[tone], className)}
    >
      {value ?? "—"}
    </span>
  );
}

/** A half-circle gauge from 0 to 100, with a tick at the even split. */
export function Dial({ value, tone, className }: { value: number | null; tone: ScoreTone; className?: string }) {
  const r = 84;
  const length = Math.PI * r;
  const filled = ((value ?? 0) / 100) * length;
  return (
    <div className={cn("relative mx-auto w-full max-w-[236px]", className)}>
      <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label={value === null ? "No score" : `Confidence score ${value} out of 100`}>
        <path d={`M16 100 A${r} ${r} 0 0 1 184 100`} fill="none" stroke="var(--surface-3)" strokeWidth="14" strokeLinecap="round" />
        {value !== null && (
          <path
            d={`M16 100 A${r} ${r} 0 0 1 184 100`}
            fill="none"
            stroke={TONES[tone]}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${length}`}
            className="transition-[stroke-dasharray] duration-700 ease-out"
          />
        )}
        <line x1="100" y1="4" x2="100" y2="12" stroke="var(--muted)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="num text-[44px] font-semibold leading-none tracking-[-0.03em] text-ink">{value ?? "—"}</div>
        <div className="mt-1 text-xs text-muted">out of 100</div>
      </div>
      <span className="absolute left-1 top-full mt-1 text-[11px] text-muted">0</span>
      <span className="absolute right-0 top-full mt-1 text-[11px] text-muted">100</span>
    </div>
  );
}

/** Checks as a compact list: the mark, the name and the reading on one line, opening to what it found and what it measures. */
export function CheckList({ checks, className }: { checks: TradeCheckItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col divide-y divide-line", className)}>
      {checks.map((item) => (
        <li key={item.id}>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2.5 py-2 [&::-webkit-details-marker]:hidden">
              <VerdictMark verdict={item.verdict} plain className="size-5" />
              <span className="min-w-0 flex-1 text-[13px] text-ink">{item.title}</span>
              <span className="num shrink-0 text-xs text-ink-2">{item.reading}</span>
              <ChevronDown className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="pb-2.5 pl-[30px] pr-1 text-[13px] leading-relaxed text-ink-2">
              {item.detail}
              <p className="mt-1 text-xs leading-relaxed text-muted">{item.learn}</p>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
