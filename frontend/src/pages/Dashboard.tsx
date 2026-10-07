import { ArrowRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart, DonutChart, TimeSeriesChart } from "@/components/charts";
import { useAppActions } from "@/components/layout/AppShell";
import { SampleBanner } from "@/components/SampleData";
import { Button, Card, CardSkeleton, Delta, ErrorState, InfoHint, Page, Segmented, Signed, Skeleton, Sparkline, SymbolCell } from "@/components/ui";
import { AllocationList, bucketItems, foldBuckets, HoldingsTable, PnlDelta, RANGES, RequirePortfolio, useBucketColors, type Range } from "@/components/widgets";
import { compact, date, inr, pct, ratioPct, signedInr, signedPct, signedRatioPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useOverview, usePerformance } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Overview, Performance } from "@/lib/types";

function Metric({ label, value, sub, hint }: { label: string; value: React.ReactNode; sub?: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="truncate">{label}</span>
        {hint && <InfoHint text={hint} />}
      </div>
      <div className="num mt-1 truncate text-lg font-semibold tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Hero({ data, perf, range, setRange, view, setView }: {
  data: Overview;
  perf: Performance | undefined;
  range: Range;
  setRange: (r: Range) => void;
  view: "value" | "return";
  setView: (v: "value" | "return") => void;
}) {
  const { chart } = useTheme();
  const s = data.summary;
  const paper = data.portfolio.kind === "paper";
  const headline = paper ? s.net_worth : s.value;
  const stats = perf?.stats;
  return (
    <Card tour="dash-value" className="lg:col-span-8" bodyClassName="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <div className="text-[13px] text-muted">{paper ? "Account value" : "Current value"}</div>
          <div className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[44px]">{inr(headline)}</div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <PnlDelta amount={s.day_pnl} percent={s.day_pct} size="md" />
            <span className="text-[13px] text-muted">today</span>
            {s.as_of && <span className="text-xs text-muted max-sm:basis-full">Prices as of {date(s.as_of)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented tour="dash-view" label="Chart" size="sm" value={view} onChange={setView} options={[{ value: "value", label: "Value" }, { value: "return", label: "Return" }]} />
          <Segmented label="Period" size="sm" value={range} onChange={setRange} options={RANGES} />
        </div>
      </div>

      <div className="mt-5">
        {!perf ? (
          <Skeleton className="h-[280px] w-full" />
        ) : perf.dates.length < 2 ? (
          <div className="flex h-[280px] items-center justify-center text-[13px] text-muted">The chart appears once there are two trading days of history.</div>
        ) : view === "value" ? (
          <TimeSeriesChart
            label="Portfolio value over time"
            dates={perf.dates}
            format="inr"
            series={[
              { name: paper ? "Account value" : "Portfolio value", data: perf.value, area: true },
              { name: paper ? "Starting capital" : "Amount invested", data: perf.invested, dashed: true, color: chart.muted, step: !paper },
            ]}
          />
        ) : (
          <TimeSeriesChart
            label="Portfolio return against the benchmark"
            dates={perf.dates}
            format="signedPct"
            zeroLine
            series={[
              { name: data.portfolio.name, data: perf.portfolio_return, area: true },
              { name: perf.benchmark, data: perf.benchmark_return, dashed: true, color: chart.muted },
            ]}
          />
        )}
      </div>

      {stats && (
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-3.5 text-[13px]">
          <span className="text-muted">
            {range === "ALL" ? "Since inception" : `Past ${range}`}
            <Delta value={stats.period_return} className="ml-2">{signedRatioPct(stats.period_return)}</Delta>
          </span>
          <span className="text-muted">
            {perf!.benchmark}
            <Signed value={stats.benchmark_return} className="ml-2 font-medium">{signedRatioPct(stats.benchmark_return)}</Signed>
          </span>
          <span className="text-muted">
            Difference
            <Signed value={stats.excess_return} className="ml-2 font-medium">{signedRatioPct(stats.excess_return)}</Signed>
          </span>
          <span className="text-muted">
            Largest fall
            <span className="num ml-2 font-medium text-ink">{ratioPct(stats.max_drawdown.value, 1)}</span>
          </span>
        </div>
      )}
    </Card>
  );
}

function Numbers({ data }: { data: Overview }) {
  const s = data.summary;
  const paper = data.portfolio.kind === "paper";
  return (
    <Card tour="dash-metrics" className="lg:col-span-4" flush bodyClassName="!pt-0">
      <div className="grid grid-cols-2 divide-x divide-y divide-line [&>*:nth-child(-n+2)]:border-t-0 [&>*:nth-child(odd)]:border-l-0">
        <Metric label={paper ? "In positions" : "Total invested"} value={inr(s.invested)} sub={`${s.holdings_count} holding${s.holdings_count === 1 ? "" : "s"}`} hint="Cost of the shares you still hold, including fees, at average cost." />
        <Metric
          label="Unrealised P&L"
          value={<Signed value={s.unrealized_pnl}>{signedInr(s.unrealized_pnl)}</Signed>}
          sub={<Signed value={s.unrealized_pct}>{signedPct(s.unrealized_pct)}</Signed>}
          hint="Current value minus the cost of what you hold. Not yet locked in."
        />
        <Metric
          label="XIRR"
          value={s.xirr == null ? "—" : <Signed value={s.xirr}>{signedRatioPct(s.xirr)}</Signed>}
          sub="Money-weighted, per year"
          hint="Annual return that accounts for when each rupee went in or came out. The fairest single number for your own experience."
        />
        <Metric
          label="CAGR"
          value={s.cagr == null ? "—" : <Signed value={s.cagr}>{signedRatioPct(s.cagr)}</Signed>}
          sub={s.cagr == null ? "Needs a year of history" : "Time-weighted, per year"}
          hint="Annual growth of the portfolio itself, ignoring the timing of deposits. Comparable with a benchmark."
        />
        <Metric label="Realised P&L" value={<Signed value={s.realized_pnl}>{signedInr(s.realized_pnl)}</Signed>} sub="From shares sold" hint="Profit or loss already locked in by selling, after fees." />
        {paper ? <Metric label="Cash available" value={inr(s.cash)} sub={`of ${compact(s.initial_capital)} starting capital`} /> : <Metric label="Cash" value={inr(s.cash)} sub={s.cash ? `Net worth ${compact(s.net_worth)}` : "None recorded"} />}
      </div>
    </Card>
  );
}

function Movers({ data }: { data: Overview }) {
  const rows = useMemo(() => [...data.holdings].sort((a, b) => Math.abs(b.day_pnl) - Math.abs(a.day_pnl)).slice(0, 6), [data.holdings]);
  return (
    <Card title="Biggest moves today" description="By rupee impact on this portfolio" className="lg:col-span-4" flush>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.symbol} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
            <div className="min-w-0 flex-1">
              <SymbolCell symbol={r.symbol} name={r.name} />
            </div>
            <Sparkline data={r.spark} width={64} height={24} className="max-sm:hidden" />
            <div className="w-24 text-right">
              <Signed value={r.day_pnl} className="text-[13px] font-medium">{signedInr(r.day_pnl)}</Signed>
              <div><Signed value={r.day_change_pct} className="text-xs">{signedPct(r.day_change_pct)}</Signed></div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Content({ id }: { id: string }) {
  const { name } = usePortfolio();
  const actions = useAppActions();
  const [range, setRange] = useState<Range>("1Y");
  const [view, setView] = useState<"value" | "return">("value");
  const overview = useOverview(id);
  const performance = usePerformance(id, range);
  const data = overview.data;
  const assets = data?.allocation.asset_classes ?? [];
  const sectors = useMemo(() => foldBuckets(data?.allocation.sectors ?? [], 6), [data]);
  const assetColors = useBucketColors(assets.map((a) => a.name));
  const contributions = useMemo(() => {
    const all = data?.contributions ?? [];
    return all.length <= 8 ? all : [...all.slice(0, 4), ...all.slice(-4)];
  }, [data]);

  if (overview.isError) return <Page title="Dashboard"><Card><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></Card></Page>;

  const empty = data && data.holdings.length === 0;
  return (
    <Page
      title="Dashboard"
      description={data ? `${name} · ${data.summary.transactions_count} transactions${data.summary.first_investment ? ` since ${date(data.summary.first_investment)}` : ""}` : undefined}
    >
      <SampleBanner />
      {!data ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <CardSkeleton height={330} className="lg:col-span-8" />
          <CardSkeleton height={330} className="lg:col-span-4" />
          <CardSkeleton className="lg:col-span-4" />
          <CardSkeleton className="lg:col-span-4" />
          <CardSkeleton className="lg:col-span-4" />
        </div>
      ) : empty ? (
        <Card>
          <div className="flex flex-col items-center px-6 py-16 text-center">
            <h3 className="text-base font-semibold text-ink">{name} has no holdings yet</h3>
            <p className="mt-1 max-w-sm text-[13px] text-muted">
              {data.portfolio.kind === "paper" ? "Place a simulated order to start. Fills use the latest market price." : "Record your first buy, or import a CSV of past transactions."}
            </p>
            <div className="mt-4 flex gap-2">
              {data.portfolio.kind === "paper" ? (
                <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
              ) : (
                <>
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
                  <Link to="/transactions"><Button>Import CSV</Button></Link>
                </>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <Hero data={data} perf={performance.data} range={range} setRange={setRange} view={view} setView={setView} />
          <Numbers data={data} />

          <Card title="Asset allocation" className="lg:col-span-4" action={<Link to="/allocation" className="text-xs font-medium text-accent hover:underline">Details</Link>}>
            <DonutChart
              label="Asset allocation"
              height={190}
              data={assets.map((a) => ({ name: a.name, value: a.value, color: assetColors[a.name] }))}
              center={
                <>
                  <span className="text-xs text-muted">Net worth</span>
                  <span className="num text-lg font-semibold tracking-tight text-ink">{compact(data.summary.net_worth)}</span>
                </>
              }
            />
            <AllocationList className="mt-4" items={bucketItems(assets).map((a) => ({ ...a, sub: undefined }))} colors={assetColors} />
          </Card>

          <Card title="Sector allocation" description={`${data.allocation.sectors.length} sectors`} className="lg:col-span-4" action={<Link to="/allocation" className="text-xs font-medium text-accent hover:underline">Details</Link>}>
            <AllocationList items={sectors} />
            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
              {[
                ["Largest holding", pct(data.allocation.concentration.largest_holding?.weight, 1)],
                ["Top 3 holdings", pct(data.allocation.concentration.top_3, 1)],
                ["Largest sector", pct(data.allocation.concentration.largest_sector?.weight, 1)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="num mt-0.5 text-sm font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="What drove the return" description="Each holding's unrealised P&L" className="lg:col-span-4">
            <BarChart
              label="Profit and loss by holding"
              horizontal
              signed
              valueLabels
              format="inr"
              height={Math.max(220, contributions.length * 34)}
              categories={contributions.map((c) => c.symbol)}
              series={[{ name: "Unrealised P&L", data: contributions.map((c) => c.pnl) }]}
            />
          </Card>

          <Card
            title="Holdings"
            description={`${data.holdings.length} positions, largest first`}
            className="lg:col-span-8"
            flush
            action={
              <Link to="/holdings" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                View all <ArrowRight className="size-3" />
              </Link>
            }
          >
            <HoldingsTable rows={data.holdings.slice(0, 8)} compact />
          </Card>
          <Movers data={data} />
        </div>
      )}
    </Page>
  );
}

export function DashboardPage() {
  return <RequirePortfolio>{(id) => <Content id={id} />}</RequirePortfolio>;
}
