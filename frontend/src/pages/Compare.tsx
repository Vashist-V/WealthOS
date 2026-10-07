import { Check, GitCompareArrows, MousePointerClick, Plus } from "lucide-react";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { Pending, ratio, settle, sharePct, Swatch } from "@/components/analytics/shared";
import { BarChart, TimeSeriesChart } from "@/components/charts";
import { useAppActions } from "@/components/layout/AppShell";
import { Button, Card, CardSkeleton, DataTable, EmptyState, ErrorState, InfoHint, LegendItem, Page, Signed, Skeleton, type Column } from "@/components/ui";
import { date, duration, inr, number, ratioPct, signedPct, signedRatioPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useCompare } from "@/lib/queries";
import { seriesColor, useTheme } from "@/lib/theme";
import type { Compare, CompareItem, Portfolio } from "@/lib/types";
import { cn } from "@/lib/utils";

const MIN = 2;
const MAX = 6;

type ColorOf = (id: string) => string;

// ------------------------------------------------------------------ chips
function Chips({ portfolios, selected, colorOf, onToggle }: { portfolios: Portfolio[]; selected: string[]; colorOf: ColorOf; onToggle: (id: string) => void }) {
  const full = selected.length >= MAX;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Portfolios to compare">
      {portfolios.map((p) => {
        const on = selected.includes(p.id);
        const blocked = !on && full;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            disabled={blocked}
            title={blocked ? `Up to ${MAX} portfolios can be compared at once. Deselect one first.` : undefined}
            onClick={() => onToggle(p.id)}
            className={cn(
              "inline-flex h-8 max-w-full items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition-colors disabled:opacity-45",
              on ? "border-line-strong bg-surface text-ink shadow-sm" : "border-line text-muted hover:border-line-strong hover:text-ink-2",
            )}
          >
            {on ? <Swatch color={colorOf(p.id)} /> : <span aria-hidden className="size-2.5 shrink-0 rounded-full border border-line-strong" />}
            <span className="truncate">{p.name}</span>
            {p.kind === "paper" && <span className="text-[11px] font-normal text-muted">Paper</span>}
            {on && <Check className="size-3.5 shrink-0 text-muted" aria-hidden />}
          </button>
        );
      })}
      <span className="ml-1 text-xs text-muted">
        {selected.length} of {portfolios.length} selected{portfolios.length > MAX ? ` · up to ${MAX} at a time` : ""}
      </span>
    </div>
  );
}

// ----------------------------------------------------------------- growth
function Growth({ data, colorOf }: { data: Compare; colorOf: ColorOf }) {
  const { chart } = data;
  const series = useMemo(
    () => chart.series.map((s) => ({ name: s.name, data: s.values, color: colorOf(s.id) })),
    [chart.series, colorOf],
  );
  return (
    <Card title="Growth over the same period" description="Time-weighted return of each portfolio, all starting from zero on the same day." className="lg:col-span-12">
      {chart.dates.length < 2 || chart.series.length === 0 ? (
        <div className="flex h-[280px] items-center justify-center px-6 text-center text-[13px] text-muted">
          The chart appears once the selected portfolios share at least two trading days of history.
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1">
            {chart.series.map((s) => {
              const last = s.values[s.values.length - 1];
              return <LegendItem key={s.id} color={colorOf(s.id)} label={s.name} value={<Signed value={last}>{signedPct(last)}</Signed>} />;
            })}
          </div>
          <TimeSeriesChart label="Growth of each selected portfolio since their common start date" dates={chart.dates} series={series} format="signedPct" zeroLine legend={false} height={320} />
          {chart.since && <p className="mt-3 text-xs text-muted">Since {date(chart.since)}, the first date all selected portfolios existed.</p>}
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- metrics
interface MetricRow {
  label: string;
  hint: string;
  cell: (p: CompareItem) => ReactNode;
}

const signedRatio = (v: number | null | undefined) => (v == null ? "—" : <Signed value={v}>{signedRatioPct(v)}</Signed>);

function metricGroups(since: string | undefined): { title: string; rows: MetricRow[] }[] {
  return [
    {
      title: "Size",
      rows: [
        {
          label: "Type", hint: "Investment portfolios record real holdings. Paper portfolios hold simulated trades made with virtual capital.",
          cell: (p) => <span className="text-ink-2">{p.kind === "paper" ? "Paper trading" : "Investment"}</span>,
        },
        {
          label: "Value", hint: "Market value of the holdings at the latest prices. For a paper portfolio, holdings plus unspent virtual cash.",
          cell: (p) => <span className="font-medium">{inr(p.value)}</span>,
        },
        { label: "Invested", hint: "Cost of the shares still held, including fees, at average cost.", cell: (p) => inr(p.invested) },
      ],
    },
    {
      title: "Return",
      rows: [
        {
          label: "Unrealised return", hint: "Current value of the holdings against what they cost. Not yet locked in.",
          cell: (p) => <Signed value={p.unrealized_pct}>{signedPct(p.unrealized_pct)}</Signed>,
        },
        { label: "XIRR", hint: "Annual return that accounts for when each rupee went in or came out.", cell: (p) => signedRatio(p.xirr) },
        { label: "CAGR", hint: "Annual growth of the portfolio itself, ignoring the timing of deposits. Shown once there is a year of history.", cell: (p) => signedRatio(p.cagr) },
        {
          label: "Total return (time-weighted)", hint: "Growth since the portfolio's first transaction, with the effect of deposits and withdrawals removed.",
          cell: (p) => signedRatio(p.total_return),
        },
        {
          label: "Return over the common window",
          hint: `Time-weighted return since ${since ? date(since) : "the common start date"}, the first date all selected portfolios existed. The one return here measured over the same period for every portfolio.`,
          cell: (p) => signedRatio(p.window_return),
        },
      ],
    },
    {
      title: "Risk",
      rows: [
        { label: "Volatility", hint: "How much daily returns have varied since the portfolio began, scaled to a year.", cell: (p) => ratioPct(p.volatility, 1) },
        { label: "Maximum drawdown", hint: "The largest fall from a peak to the low that followed, since the portfolio began.", cell: (p) => signedRatioPct(settle(p.max_drawdown, 1), 1) },
        { label: "Sharpe ratio", hint: "Annualised return above the risk-free rate, divided by volatility. Shown once there are about three months of history.", cell: (p) => ratio(p.sharpe) },
        { label: "Beta", hint: "Sensitivity to the portfolio's own benchmark. 1.00 means it moved in step with the index.", cell: (p) => ratio(p.beta) },
      ],
    },
    {
      title: "Profile",
      rows: [
        { label: "Holdings", hint: "Number of positions currently held.", cell: (p) => number(p.holdings_count) },
        {
          label: "Started", hint: "Date of the first transaction, and how long ago that was.",
          cell: (p) =>
            p.since ? (
              <>
                <div>{date(p.since)}</div>
                {p.days != null && <div className="text-xs text-muted">{duration(p.days)}</div>}
              </>
            ) : (
              "—"
            ),
        },
      ],
    },
  ];
}

function Metrics({ data, colorOf }: { data: Compare; colorOf: ColorOf }) {
  const items = data.portfolios;
  const groups = useMemo(() => metricGroups(data.chart.since), [data.chart.since]);
  const sticky = "sticky left-0 z-10 border-r border-line bg-surface";
  return (
    <Card
      title="Side by side"
      description="The same measures for each portfolio. Apart from the common-window return, each covers that portfolio's own history, so the periods differ."
      className="lg:col-span-12"
      flush
    >
      <div className="w-full overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px] [&_tbody_tr:last-child>*]:border-b-0">
          <thead>
            <tr>
              <th scope="col" className={cn(sticky, "w-36 min-w-36 border-b py-2 pl-4 pr-3 text-left align-bottom text-xs font-medium text-muted sm:w-64 sm:min-w-64 sm:pl-5")}>
                Measure
              </th>
              {items.map((p) => (
                <th key={p.id} scope="col" className="min-w-28 border-b border-line bg-surface px-3 py-2 text-right align-bottom last:pr-4 sm:min-w-32 sm:last:pr-5">
                  <span className="inline-flex items-start justify-end gap-2 text-[13px] font-semibold leading-snug text-ink">
                    <Swatch color={colorOf(p.id)} className="mt-1" />
                    <span className="max-w-24 [overflow-wrap:anywhere] sm:max-w-44">{p.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <Fragment key={group.title}>
                <tr>
                  <th scope="colgroup" colSpan={items.length + 1} className="border-b border-line bg-surface-2 px-4 py-1.5 text-left sm:px-5">
                    <span className="sticky left-4 inline-block text-[11px] font-medium uppercase tracking-wider text-muted sm:left-5">{group.title}</span>
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.label} className="group/row">
                    <th scope="row" className={cn(sticky, "border-b py-2.5 pl-4 pr-3 text-left align-middle font-normal text-ink-2 transition-colors group-hover/row:bg-surface-2 sm:pl-5")}>
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0">{row.label}</span>
                        <InfoHint text={row.hint} />
                      </span>
                    </th>
                    {items.map((p) => (
                      <td key={p.id} className="num whitespace-nowrap border-b border-line px-3 py-2.5 text-right align-middle text-ink transition-colors group-hover/row:bg-surface-2 last:pr-4 sm:last:pr-5">
                        {row.cell(p)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- sectors
interface SectorRow {
  name: string;
  weights: Record<string, number>;
  total: number;
}

function Sectors({ data, colorOf }: { data: Compare; colorOf: ColorOf }) {
  const items = data.portfolios;
  const rows = useMemo<SectorRow[]>(
    () =>
      data.sectors
        .map((name) => {
          const weights = Object.fromEntries(items.map((p) => [p.id, p.sectors[name] ?? 0]));
          return { name, weights, total: Object.values(weights).reduce((sum, w) => sum + w, 0) };
        })
        .sort((a, b) => b.total - a.total),
    [data.sectors, items],
  );
  const categories = useMemo(() => rows.map((r) => r.name), [rows]);
  const series = useMemo(
    // A portfolio with nothing in a sector gets no bar there, rather than a sliver at zero.
    () => items.map((p) => ({ name: p.name, data: rows.map((r) => (r.weights[p.id] > 0 ? r.weights[p.id] : null)), color: colorOf(p.id) })),
    [items, rows, colorOf],
  );
  const columns: Column<SectorRow>[] = [
    { key: "sector", header: "Sector", sort: (r) => r.name, cell: (r) => <span className="whitespace-nowrap text-ink">{r.name}</span> },
    ...items.map(
      (p): Column<SectorRow> => ({
        key: p.id,
        header: (
          <span className="inline-flex items-center gap-1.5">
            <Swatch color={colorOf(p.id)} className="size-2" />
            <span className="max-w-20 truncate sm:max-w-40">{p.name}</span>
          </span>
        ),
        align: "right",
        sort: (r) => r.weights[p.id],
        cell: (r) => (r.weights[p.id] > 0 ? sharePct(r.weights[p.id]) : <span className="text-muted">—</span>),
      }),
    ),
  ];

  if (rows.length === 0) {
    return (
      <Card title="Sector exposure" className="lg:col-span-12">
        <p className="py-10 text-center text-[13px] text-muted">None of the selected portfolios has holdings to break down by sector.</p>
      </Card>
    );
  }
  return (
    <>
      <Card title="Sector exposure" description="Each portfolio's holdings by sector, as a share of its own value. Sectors with the most combined exposure come first." className="lg:col-span-12">
        <BarChart
          label="Sector exposure of each selected portfolio"
          horizontal
          categories={categories}
          series={series}
          format="pct"
          height={Math.max(240, rows.length * (items.length * 9 + 12) + 36)}
        />
      </Card>
      <Card title="Sector weights" description="The same figures as a table. A dash means no holdings in that sector." className="lg:col-span-12" flush>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.name} dense />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------- page
function Loading() {
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <CardSkeleton height={320} className="lg:col-span-12" />
      <CardSkeleton height={420} className="lg:col-span-12" />
      <CardSkeleton height={320} className="lg:col-span-12" />
    </div>
  );
}

export function ComparePage() {
  const { portfolios, isLoading } = usePortfolio();
  const actions = useAppActions();
  const { chart } = useTheme();
  /** Null until the user changes the selection: the default is every portfolio, up to the limit. */
  const [picked, setPicked] = useState<string[] | null>(null);

  // Portfolio-list order, whatever order the chips were clicked in, so columns do not shuffle.
  const selected = useMemo(() => {
    const wanted = picked ? portfolios.filter((p) => picked.includes(p.id)) : portfolios;
    return wanted.slice(0, MAX).map((p) => p.id);
  }, [portfolios, picked]);

  // One colour per portfolio, in the chart kit's series order. With eight or fewer portfolios the
  // colour follows the portfolio; beyond that the palette is dealt out to the selected ones only.
  const colorOf = useMemo<ColorOf>(() => {
    const order = portfolios.length <= chart.series.length ? portfolios.map((p) => p.id) : selected;
    const colors = new Map(order.map((id, i) => [id, seriesColor(chart, i)]));
    return (id) => colors.get(id) ?? chart.muted;
  }, [portfolios, selected, chart]);

  const enough = selected.length >= MIN;
  const compare = useCompare(enough ? selected : []);
  const toggle = (id: string) => setPicked(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const paper = portfolios.some((p) => p.kind === "paper" && selected.includes(p.id));

  return (
    <Page
      title="Compare"
      description={`Portfolios side by side: growth over the same period, return and risk measures, and sector exposure.${paper ? " Paper portfolios are simulated." : ""}`}
    >
      {isLoading ? (
        <>
          <div className="mb-4 flex gap-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-36" />
          </div>
          <Loading />
        </>
      ) : portfolios.length < MIN ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<GitCompareArrows />}
            title="Comparing needs at least two portfolios"
            description={
              portfolios.length === 1
                ? `You have one portfolio, ${portfolios[0].name}. Create a second, for another goal or for paper trading, and the two appear here side by side.`
                : "Create two portfolios and they appear here side by side."
            }
            action={
              <>
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.newPortfolio()}>Create portfolio</Button>
                <Button onClick={() => actions.newPortfolio("paper")}>Create paper portfolio</Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <Chips portfolios={portfolios} selected={selected} colorOf={colorOf} onToggle={toggle} />
          {!enough ? (
            <Card>
              <EmptyState
                className="py-16"
                icon={<MousePointerClick />}
                title="Select at least two portfolios"
                description="Choose two or more of the portfolios above to see them side by side."
                action={<Button onClick={() => setPicked(null)}>Select all</Button>}
              />
            </Card>
          ) : compare.isError ? (
            <Card><ErrorState error={compare.error} onRetry={() => compare.refetch()} /></Card>
          ) : !compare.data ? (
            <Loading />
          ) : (
            <Pending active={compare.isPlaceholderData}>
              <div className="grid gap-4 lg:grid-cols-12">
                <Growth data={compare.data} colorOf={colorOf} />
                <Metrics data={compare.data} colorOf={colorOf} />
                <Sectors data={compare.data} colorOf={colorOf} />
              </div>
            </Pending>
          )}
        </>
      )}
    </Page>
  );
}
