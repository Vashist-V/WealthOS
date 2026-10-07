import { AlertTriangle, ArrowDown, ArrowDownRight, ArrowUp, ArrowUpRight, ChevronsUpDown, Info, Minus, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "@/lib/queries";
import { tone } from "@/lib/format";
import { cn, symbolPath } from "@/lib/utils";
import { Button } from "./controls";
import { Tooltip } from "./overlay";

/** Page frame: title, one-line description, actions on the right, content below. */
export function Page({
  title,
  description,
  actions,
  eyebrow,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Sits above the title: a back link or breadcrumb. */
  eyebrow?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (typeof title === "string") document.title = `${title} · WealthOS`;
  }, [title]);
  return (
    <div className={cn("mx-auto w-full max-w-[1440px] animate-rise px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-7", className)}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:mb-6">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink lg:text-2xl">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Card({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
  flush,
  tour,
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Remove body padding, for tables that run edge to edge. */
  flush?: boolean;
  /** Name the hands-on guide points at this card by. */
  tour?: string;
}) {
  return (
    <section data-tour={tour} className={cn("card flex min-w-0 flex-col", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn("min-w-0 flex-1", flush ? "pt-3" : "p-4 sm:p-5", title && !flush && "pt-3 sm:pt-3.5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A signed value with a direction arrow, so the sign never rests on colour alone. */
export function Delta({
  value,
  children,
  size = "sm",
  arrow = true,
  className,
}: {
  /** The number that decides the direction. */
  value: number | null | undefined;
  /** The formatted text to show. */
  children: ReactNode;
  size?: "xs" | "sm" | "md";
  arrow?: boolean;
  className?: string;
}) {
  const t = tone(value);
  const Icon = t === "gain" ? ArrowUpRight : t === "loss" ? ArrowDownRight : Minus;
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-0.5 whitespace-nowrap font-medium",
        size === "xs" ? "text-xs" : size === "sm" ? "text-[13px]" : "text-sm",
        t === "gain" ? "text-gain" : t === "loss" ? "text-loss" : "text-muted",
        className,
      )}
    >
      {arrow && <Icon className={size === "md" ? "size-4" : "size-3.5"} strokeWidth={2.4} aria-hidden />}
      {children}
    </span>
  );
}

/** Coloured, signed number without an arrow: for dense table cells. */
export function Signed({ value, children, className }: { value: number | null | undefined; children: ReactNode; className?: string }) {
  const t = tone(value);
  return <span className={cn("num", t === "gain" ? "text-gain" : t === "loss" ? "text-loss" : "text-ink-2", className)}>{children}</span>;
}

export function StatTile({
  label,
  value,
  sub,
  hint,
  className,
  loading,
}: {
  label: string;
  value: ReactNode;
  /** Secondary line: a delta, a comparison or a short note. */
  sub?: ReactNode;
  /** Explains the metric on hover. */
  hint?: string;
  className?: string;
  loading?: boolean;
}) {
  return (
    <div className={cn("card flex min-w-0 flex-col gap-1.5 px-4 py-3.5", className)}>
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        <span className="truncate">{label}</span>
        {hint && <InfoHint text={hint} />}
      </div>
      {loading ? (
        <div className="skeleton h-7 w-28" />
      ) : (
        <div className="truncate text-[22px] font-semibold leading-7 tracking-tight text-ink">{value}</div>
      )}
      {sub && !loading && <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted">{sub}</div>}
    </div>
  );
}

export function InfoHint({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <button type="button" aria-label={text} className="inline-flex shrink-0 cursor-help text-muted/70 transition-colors hover:text-ink-2">
        <Info className="size-3.5" />
      </button>
    </Tooltip>
  );
}

const BADGE = {
  neutral: "bg-surface-2 text-ink-2 ring-line",
  accent: "bg-accent-soft text-accent ring-transparent",
  gain: "bg-gain-soft text-gain ring-transparent",
  loss: "bg-loss-soft text-loss ring-transparent",
  warn: "bg-warn-soft text-warn ring-transparent",
} as const;

export function Badge({ children, tone: t = "neutral", className }: { children: ReactNode; tone?: keyof typeof BADGE; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset", BADGE[t], className)}>
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

/** Placeholder for a card whose data is loading. */
export function CardSkeleton({ height = 260, className }: { height?: number; className?: string }) {
  return (
    <div className={cn("card p-5", className)}>
      <Skeleton className="h-4 w-36" />
      <Skeleton className="mt-4 w-full" />
      <div className="skeleton mt-0 w-full" style={{ height }} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-surface-2 text-muted ring-1 ring-line [&>svg]:size-5">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <EmptyState
      className={className}
      icon={<AlertTriangle />}
      title="This didn't load"
      description={errorMessage(error)}
      action={
        onRetry && (
          <Button size="sm" onClick={onRetry} icon={<RotateCw className="size-3.5" />}>
            Try again
          </Button>
        )
      }
    />
  );
}

/** Tiny trend line. Colour follows direction unless one is given. */
export function Sparkline({
  data,
  width = 88,
  height = 28,
  color,
  className,
}: {
  data: number[] | undefined;
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}) {
  if (!data || data.length < 2) return <div style={{ width, height }} className={className} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`);
  const stroke = color ?? (data[data.length - 1] >= data[0] ? "var(--gain)" : "var(--loss)");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={cn("shrink-0 overflow-visible", className)} aria-hidden>
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Where a value sits between a low and a high: used for 52-week ranges. */
export function RangeBar({ low, high, value, className }: { low: number | null | undefined; high: number | null | undefined; value: number; className?: string }) {
  if (low == null || high == null || high <= low) return <span className="text-muted">—</span>;
  const position = Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
  return (
    <div className={cn("relative h-1.5 w-full min-w-16 rounded-full bg-surface-3", className)} role="img" aria-label={`${position.toFixed(0)}% of the way from low to high`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-accent/35" style={{ width: `${position}%` }} />
      <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface" style={{ left: `${position}%` }} />
    </div>
  );
}

/** A proportion bar for weights and shares. */
export function Meter({ value, max = 100, color = "var(--accent)", className }: { value: number; max?: number; color?: string; className?: string }) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-3", className)}>
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: color }} />
    </div>
  );
}

/** Ticker with company name beneath, linking to the stock page. */
export function SymbolCell({ symbol, name, sub, link = true }: { symbol: string; name?: string | null; sub?: ReactNode; link?: boolean }) {
  const body = (
    <>
      <div className="truncate font-medium text-ink group-hover/sym:text-accent">{symbol}</div>
      {(name || sub) && <div className="truncate text-xs text-muted">{sub ?? name}</div>}
    </>
  );
  return link ? (
    <Link to={symbolPath(symbol)} className="group/sym block min-w-0 max-w-36 outline-none sm:max-w-56" onClick={(e) => e.stopPropagation()}>
      {body}
    </Link>
  ) : (
    <div className="min-w-0 max-w-36 sm:max-w-56">{body}</div>
  );
}

/** A swatch plus label, the identity key for one chart series. */
export function LegendItem({ color, label, value, dashed }: { color: string; label: ReactNode; value?: ReactNode; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span
        className="inline-block h-0.5 w-3.5 shrink-0 rounded-full"
        style={dashed ? { backgroundImage: `linear-gradient(90deg, ${color} 55%, transparent 0)`, backgroundSize: "5px 100%" } : { background: color }}
      />
      {label}
      {value !== undefined && <span className="num font-medium text-ink">{value}</span>}
    </span>
  );
}

export interface Column<Row> {
  key: string;
  header: ReactNode;
  cell: (row: Row, index: number) => ReactNode;
  /** Makes the column sortable. */
  sort?: (row: Row) => number | string | null | undefined;
  align?: "left" | "right" | "center";
  /** Hide below this breakpoint to keep small screens readable. */
  hide?: "sm" | "md" | "lg" | "xl" | "2xl";
  width?: string;
  hint?: string;
  className?: string;
}

const HIDE = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden", xl: "max-xl:hidden", "2xl": "max-2xl:hidden" } as const;
const ALIGN = { left: "text-left", right: "text-right", center: "text-center" } as const;

/** Sortable table. Numbers go right-aligned; the first column stays readable on phones. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  onRowClick,
  defaultSort,
  empty,
  dense,
  footer,
  className,
  maxHeight,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
  onRowClick?: (row: Row) => void;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  empty?: ReactNode;
  dense?: boolean;
  footer?: ReactNode;
  className?: string;
  maxHeight?: number;
}) {
  const [sort, setSort] = useState(defaultSort ?? null);
  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !column?.sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = column.sort!(a);
      const y = column.sort!(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // blanks sink regardless of direction
      if (y == null) return -1;
      return (typeof x === "string" || typeof y === "string" ? String(x).localeCompare(String(y)) : x - y) * dir;
    });
  }, [rows, sort, columns]);

  if (!rows.length && empty) return <>{empty}</>;
  const pad = dense ? "px-3 py-2" : "px-3 py-2.5";
  return (
    <div className={cn("w-full overflow-x-auto", className)} style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {columns.map((col) => {
              const active = sort?.key === col.key;
              return (
                <th
                  key={col.key}
                  scope="col"
                  style={{ width: col.width }}
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn(
                    "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface px-3 py-2 text-xs font-medium text-muted first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5",
                    ALIGN[col.align ?? "left"],
                    col.hide && HIDE[col.hide],
                  )}
                >
                  {col.sort ? (
                    <button
                      type="button"
                      onClick={() => setSort(active ? { key: col.key, dir: sort!.dir === "asc" ? "desc" : "asc" } : { key: col.key, dir: col.align === "right" ? "desc" : "asc" })}
                      className={cn("inline-flex items-center gap-1 transition-colors hover:text-ink", active && "text-ink", col.align === "right" && "flex-row-reverse")}
                    >
                      {col.header}
                      {active ? (
                        sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                  {col.hint && <span className="ml-1 inline-flex align-middle max-sm:hidden"><InfoHint text={col.hint} /></span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("group/row transition-colors hover:bg-surface-2/70", onRowClick && "cursor-pointer")}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    pad,
                    "border-b border-line align-middle text-ink-2 first:pl-4 last:pr-4 group-last/row:border-b-0 sm:first:pl-5 sm:last:pr-5",
                    ALIGN[col.align ?? "left"],
                    col.align === "right" && "num whitespace-nowrap",
                    col.hide && HIDE[col.hide],
                    col.className,
                  )}
                >
                  {col.cell(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="text-[13px] font-medium text-ink">{footer}</tfoot>}
      </table>
    </div>
  );
}

/** Two-column list of label/value facts. */
export function KeyValue({ items, columns = 2, className }: { items: { label: ReactNode; value: ReactNode; hint?: string }[]; columns?: 1 | 2 | 3 | 4; className?: string }) {
  const cols = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 md:grid-cols-3", 4: "grid-cols-2 md:grid-cols-4" }[columns];
  return (
    <dl className={cn("grid gap-x-6 gap-y-3.5", cols, className)}>
      {items.map((item, i) => (
        <div key={i} className="min-w-0">
          <dt className="flex items-center gap-1 text-xs text-muted">
            <span className="truncate">{item.label}</span>
            {item.hint && <InfoHint text={item.hint} />}
          </dt>
          <dd className="num mt-0.5 truncate text-sm font-medium text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
