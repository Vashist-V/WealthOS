/** Small pieces shared by the journal list, the detail view and the entry form. */
import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { JournalEntry, JournalInput } from "@/lib/types";
import { cn } from "@/lib/utils";

export type JournalAction = JournalEntry["action"];

export const ACTIONS: { value: JournalAction; label: string }[] = [
  { value: "BUY", label: "Buy" },
  { value: "SELL", label: "Sell" },
  { value: "HOLD", label: "Hold" },
  { value: "WATCH", label: "Watch" },
];
export const ACTION_LABEL: Record<JournalAction, string> = { BUY: "Buy", SELL: "Sell", HOLD: "Hold", WATCH: "Watch" };

/** The cache keys every journal change refreshes. */
export const JOURNAL_KEYS = ["journal", "journal-review"];

export function ActionBadge({ action }: { action: JournalAction }) {
  return <Badge tone={action === "BUY" || action === "SELL" ? "accent" : "neutral"}>{ACTION_LABEL[action]}</Badge>;
}

export function StatusBadge({ status }: { status: JournalEntry["status"] }) {
  return (
    <Badge tone="neutral">
      <span className={cn("size-1.5 rounded-full", status === "open" ? "bg-accent" : "bg-muted")} aria-hidden />
      {status === "open" ? "Open" : "Closed"}
    </Badge>
  );
}

/** Conviction from 1 to 5 as filled dots. */
export function Conviction({ value, className }: { value: number; className?: string }) {
  return (
    <span role="img" aria-label={`Conviction ${value} of 5`} className={cn("inline-flex items-center gap-1", className)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cn("size-2 rounded-full", n <= value ? "bg-accent" : "bg-surface-3 ring-1 ring-inset ring-line-strong")} />
      ))}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-inset ring-line">{children}</span>;
}

/** A label above a control that is not a single input (a segmented control, a list editor). */
export function Labeled({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={label} className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <div>{children}</div>
      {(error || hint) && <p className={cn("text-xs", error ? "text-loss" : "text-muted")}>{error || hint}</p>}
    </div>
  );
}

/** The full body the API expects, from an entry as it was loaded. */
export function toInput(entry: JournalEntry): JournalInput {
  return {
    symbol: entry.symbol,
    portfolio_id: entry.portfolio_id,
    action: entry.action,
    entry_price: entry.entry_price,
    entry_date: entry.entry_date.slice(0, 10),
    horizon: entry.horizon ?? "",
    thesis: entry.thesis ?? "",
    reasons: entry.reasons ?? [],
    exit_conditions: entry.exit_conditions ?? "",
    conviction: entry.conviction,
    tags: entry.tags ?? [],
    status: entry.status,
    outcome_notes: entry.outcome_notes ?? "",
    closed_at: entry.closed_at ? entry.closed_at.slice(0, 10) : null,
  };
}
