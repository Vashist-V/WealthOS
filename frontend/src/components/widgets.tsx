/** Portfolio building blocks shared across pages. */
import { FolderPlus, Layers, Sparkles } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { duration, inr, pct, price, quantity, signedInr, signedPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useAction } from "@/lib/queries";
import { seriesColor, useTheme } from "@/lib/theme";
import type { Bucket, Holding } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";
import { useAppActions } from "./layout/AppShell";
import { Button, Card, DataTable, Delta, EmptyState, Meter, Page, RangeBar, Signed, Sparkline, SymbolCell, type Column } from "./ui";

export const RANGES = ["1M", "3M", "6M", "YTD", "1Y", "3Y", "ALL"] as const;
export type Range = (typeof RANGES)[number];

/** Colour for a named bucket: stable across charts on the same page. */
export function useBucketColors(names: string[]): Record<string, string> {
  const { chart } = useTheme();
  const key = names.join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => Object.fromEntries(names.map((name, i) => [name, name === "Cash" ? chart.muted : seriesColor(chart, i)])), [chart, key]);
}

/** The first seven buckets keep their own slice; the tail folds into "Other". */
export function foldBuckets<B extends { name: string; value: number; weight: number }>(buckets: B[], keep = 7): { name: string; value: number; weight: number }[] {
  if (buckets.length <= keep + 1) return buckets;
  const head = buckets.slice(0, keep);
  const tail = buckets.slice(keep);
  return [...head, { name: "Other", value: tail.reduce((s, b) => s + b.value, 0), weight: tail.reduce((s, b) => s + b.weight, 0) }];
}

/** Named shares with a bar each: the readable companion to a donut. */
export function AllocationList({
  items,
  colors,
  showValue = true,
  className,
}: {
  items: { name: string; value?: number; weight: number; sub?: ReactNode }[];
  colors?: Record<string, string>;
  showValue?: boolean;
  className?: string;
}) {
  const max = Math.max(...items.map((i) => i.weight), 1);
  return (
    <ul className={cn("flex flex-col gap-3", className)}>
      {items.map((item) => (
        <li key={item.name}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              {colors && <span className="size-2 shrink-0 rounded-full" style={{ background: colors[item.name] ?? "var(--muted)" }} />}
              <span className="truncate">{item.name}</span>
              {item.sub && <span className="shrink-0 text-xs text-muted">{item.sub}</span>}
            </span>
            <span className="num flex shrink-0 items-baseline gap-2.5">
              {showValue && item.value !== undefined && <span className="text-xs text-muted">{inr(item.value)}</span>}
              <span className="w-12 text-right font-medium text-ink">{pct(item.weight, 1)}</span>
            </span>
          </div>
          <Meter value={item.weight} max={max} color={colors?.[item.name] ?? "var(--accent)"} />
        </li>
      ))}
    </ul>
  );
}

export function bucketItems(buckets: Bucket[]) {
  return buckets.map((b) => ({ name: b.name, value: b.value, weight: b.weight, sub: b.count > 1 ? `${b.count} holdings` : undefined }));
}

/** The standard holdings table. `compact` trims it for dashboards. */
export function HoldingsTable({ rows, compact, maxHeight }: { rows: Holding[]; compact?: boolean; maxHeight?: number }) {
  const navigate = useNavigate();
  const columns: Column<Holding>[] = [
    { key: "symbol", header: "Holding", sort: (r) => r.symbol, cell: (r) => <SymbolCell symbol={r.symbol} name={r.name} /> },
    {
      key: "quantity", header: compact ? "Qty" : "Qty · avg cost", align: "right", hide: "md", sort: (r) => r.quantity,
      cell: (r) =>
        compact ? (
          quantity(r.quantity)
        ) : (
          <div>
            <div className="text-ink">{quantity(r.quantity)}</div>
            <div className="text-xs text-muted">{price(r.avg_cost)}</div>
          </div>
        ),
    },
    ...(compact ? ([{ key: "avg", header: "Avg cost", align: "right", hide: "lg", sort: (r) => r.avg_cost, cell: (r) => price(r.avg_cost) }] as Column<Holding>[]) : []),
    {
      key: "price", header: "Price", align: "right", hide: "sm", sort: (r) => r.day_change_pct,
      cell: (r) => (
        <div>
          <div className="text-ink">{price(r.price)}</div>
          <Signed value={r.day_change_pct} className="text-xs">{signedPct(r.day_change_pct)}</Signed>
        </div>
      ),
    },
    ...(compact
      ? []
      : ([
          { key: "trend", header: "30 days", hide: "xl", cell: (r) => <Sparkline data={r.spark} /> },
        ] as Column<Holding>[])),
    {
      key: "value", header: compact ? "Value" : "Value · invested", align: "right", sort: (r) => r.value,
      cell: (r) =>
        compact ? (
          <span className="font-medium text-ink">{inr(r.value)}</span>
        ) : (
          <div>
            <div className="font-medium text-ink">{inr(r.value)}</div>
            <div className="text-xs text-muted">{inr(r.invested)}</div>
          </div>
        ),
    },
    {
      key: "pnl", header: "P&L", align: "right", sort: (r) => r.pnl_pct,
      cell: (r) => (
        <div>
          <Signed value={r.pnl}>{signedInr(r.pnl)}</Signed>
          <div><Signed value={r.pnl_pct} className="text-xs">{signedPct(r.pnl_pct)}</Signed></div>
        </div>
      ),
    },
    ...(compact
      ? []
      : ([
          { key: "day", header: "Today", align: "right", hide: "lg", sort: (r) => r.day_pnl, cell: (r) => <Signed value={r.day_pnl}>{signedInr(r.day_pnl)}</Signed> },
          {
            key: "range", header: "52-week range", hide: "2xl", width: "120px", hint: "Where the current price sits between the 52-week low and high.",
            cell: (r) => <RangeBar low={r.low_52w} high={r.high_52w} value={r.price} />,
          },
          { key: "held", header: "Held", align: "right", hide: "2xl", sort: (r) => r.holding_days, cell: (r) => duration(r.holding_days) },
        ] as Column<Holding>[])),
    {
      key: "weight", header: "Weight", align: "right", hide: "sm", sort: (r) => r.weight,
      cell: (r) => (
        <div className="ml-auto flex w-20 items-center gap-2">
          <Meter value={r.weight} max={Math.max(...rows.map((x) => x.weight))} />
          <span className="w-10 shrink-0 text-right">{pct(r.weight, 1)}</span>
        </div>
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.symbol}
      defaultSort={{ key: "value", dir: "desc" }}
      onRowClick={(r) => navigate(symbolPath(r.symbol))}
      maxHeight={maxHeight}
      empty={<EmptyState icon={<Layers />} title="No holdings yet" description="Add a buy transaction and it will show up here with live prices." />}
    />
  );
}

/** Shown on every portfolio page until the first portfolio exists. */
export function Onboarding() {
  const actions = useAppActions();
  const { status } = useAuth();
  // A real account loads the samples alongside its own data; the demo workspace restores its original set.
  const sample = useAction(status === "demo" ? api.resetDemo : api.loadSampleData, { invalidate: "portfolio", success: "Sample portfolios added" });
  return (
    <Page title="Welcome to WealthOS" description="Start with a portfolio. Everything else is built from the transactions you record in it.">
      <Card>
        <EmptyState
          className="py-16"
          icon={<FolderPlus />}
          title="Create your first portfolio"
          description="Name it, pick a benchmark, then add your buys and sells or import them from a CSV. Prices, P&L and risk follow automatically."
          action={
            <>
              <Button variant="primary" onClick={() => actions.newPortfolio()}>
                Create portfolio
              </Button>
              <Button icon={<Sparkles className="size-4" />} loading={sample.isPending} onClick={() => sample.mutate(undefined)}>
                Load sample data
              </Button>
            </>
          }
        />
      </Card>
    </Page>
  );
}

/** Wraps a portfolio page: handles "still loading" and "no portfolios yet". */
export function RequirePortfolio({ children }: { children: (id: string) => ReactNode }) {
  const { id, isLoading } = usePortfolio();
  if (isLoading) return null;
  if (!id) return <Onboarding />;
  return <>{children(id)}</>;
}

/** "+₹8,366 (+0.99%)" in one coloured unit. */
export function PnlDelta({ amount, percent, size = "sm" }: { amount: number; percent: number; size?: "xs" | "sm" | "md" }) {
  return (
    <Delta value={amount} size={size}>
      {signedInr(amount)} ({signedPct(percent)})
    </Delta>
  );
}
