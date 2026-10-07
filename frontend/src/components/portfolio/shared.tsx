/** Small pieces shared by the holdings, transactions, portfolios and allocation pages. */
import { Search, X } from "lucide-react";
import { Badge, Input } from "@/components/ui";
import { compact, inr, number, signedCompact, signedInr } from "@/lib/format";
import type { TxType } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Text filter with a search glyph and a clear button. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** What the field filters, for screen readers. */
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <Input
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? label}
        className="pl-9 pr-8"
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange("")}
          className="absolute right-1.5 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Whole rupees where there is room, lakh and crore where there isn't, so a
 * tile never clips its figure. `tight` also shortens between the `lg` and `xl`
 * breakpoints, where a four-tile row sits beside the sidebar.
 */
export function Rupees({ value, signed, tight }: { value: number | null | undefined; signed?: boolean; tight?: boolean }) {
  const full = signed ? signedInr(value) : inr(value);
  return (
    <>
      <span className={cn("sm:hidden", tight && "lg:inline xl:hidden")} title={full}>
        {signed ? signedCompact(value) : compact(value)}
      </span>
      <span className={cn("max-sm:hidden", tight && "lg:max-xl:hidden")}>{full}</span>
    </>
  );
}

/** "Long-Term Investments" → "long-term-investments", for download file names. */
export function fileSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "portfolio";
}

/** "1 holding", "1,240 transactions". */
export const plural = (count: number, one: string, many = `${one}s`) => `${number(count)} ${count === 1 ? one : many}`;

/** Cell classes that match `DataTable`, for the few tables that need grouped or highlighted rows. */
export const TH = "whitespace-nowrap border-b border-line bg-surface px-3 py-2 text-xs font-medium text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
export const TD = "border-b border-line px-3 py-2.5 align-middle text-ink-2 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";

export const TX_TYPES: Record<TxType, { label: string; tone: "accent" | "warn" | "gain" }> = {
  BUY: { label: "Buy", tone: "accent" },
  SELL: { label: "Sell", tone: "warn" },
  DIVIDEND: { label: "Dividend", tone: "gain" },
};

export function TypeBadge({ type }: { type: TxType }) {
  const meta = TX_TYPES[type];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
