/** Small pieces shared by the Lab pages. */
import { FlaskConical } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Tooltip } from "@/components/ui";
import { pct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The line every Lab result carries: what it is, and what it is not. */
export function ScenarioNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-[10px] bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-2 ring-1 ring-inset ring-line", className)}>
      <FlaskConical className="mt-px size-3.5 shrink-0 text-muted" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** A form string as a number; null when it is blank or not a number. */
export function parseNumber(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** 12% or 12.5% from a value already in percent: no trailing zeros. */
export function tidyPct(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return pct(rounded, Number.isInteger(rounded) ? 0 : digits);
}

/** Today minus a number of years, as YYYY-MM-DD in local time. */
export function isoYearsAgo(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** A small pill button: quick fills, suggestions, filters. */
export function Chip({
  children,
  onClick,
  active,
  disabled,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  /** Set for toggles; leave undefined for one-shot actions. */
  active?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-40",
        active ? "bg-accent-soft text-accent ring-transparent" : "bg-surface-2 text-ink-2 ring-line hover:text-ink hover:ring-line-strong",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Segmented control whose options can be unavailable, with the reason on hover. */
export function OptionGroup<V extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: V; label: string; unavailable?: string | null }[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[10px] bg-surface-2 p-0.5 ring-1 ring-inset ring-line">
      {options.map((option) => {
        const selected = option.value === value;
        const blocked = !!option.unavailable;
        const button = (
          <button
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={blocked || undefined}
            onClick={() => !blocked && onChange(option.value)}
            className={cn(
              "h-7 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
              selected ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
              blocked && "cursor-not-allowed opacity-50 hover:text-muted",
            )}
          >
            {option.label}
          </button>
        );
        return blocked ? (
          <Tooltip key={option.value} content={option.unavailable}>
            {button}
          </Tooltip>
        ) : (
          <Fragment key={option.value}>{button}</Fragment>
        );
      })}
    </div>
  );
}
