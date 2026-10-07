import { Activity, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Pending, ratio, settle, sharePct } from "@/components/analytics/shared";
import { CorrelationHeatmap, HistogramChart, ScatterChart, TimeSeriesChart } from "@/components/charts";
import { useAppActions } from "@/components/layout/AppShell";
import {
  Button, Card, CardSkeleton, DataTable, EmptyState, ErrorState, InfoHint, KeyValue, LegendItem, Meter, Page, Segmented, Signed, Skeleton,
  StatTile, SymbolCell, type Column,
} from "@/components/ui";
import { RequirePortfolio } from "@/components/widgets";
import { date, inr, number, pct, ratioPct, shortDate, signedRatioPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useRisk } from "@/lib/queries";
import { diverging, seriesColor, useTheme } from "@/lib/theme";
import type { CorrelationPair, Drawdown, RiskReport } from "@/lib/types";
import { symbolPath } from "@/lib/utils";

const LOOKBACKS = ["6M", "1Y", "2Y", "3Y", "5Y"] as const;
type Lookback = (typeof LOOKBACKS)[number];
const SPAN: Record<Lookback, string> = { "6M": "six months", "1Y": "year", "2Y": "two years", "3Y": "three years", "5Y": "five years" };

type HoldingRisk = RiskReport["holdings"][number];

function drawdownDates(dd: Drawdown) {
  if (!dd.peak || !dd.trough) return <span>No fall in this window</span>;
  const sameYear = dd.peak.slice(0, 4) === dd.trough.slice(0, 4);
  return (
    <>
      <span>{sameYear ? shortDate(dd.peak) : date(dd.peak)} → {date(dd.trough)}</span>
      <span>{dd.recovered ? `Recovered ${date(dd.recovered)}` : "Not yet recovered"}</span>
    </>
  );
}

// --------------------------------------------------------------- headline
function Headline({ data }: { data: RiskReport }) {
  const s = data.summary;
  return (
    <div data-tour="risk-tiles" className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
      <StatTile
        label="Volatility"
        value={ratioPct(s.volatility, 1)}
        sub={`${data.benchmark}: ${ratioPct(s.benchmark_volatility, 1)}`}
        hint="Annualised volatility: how much daily returns varied, scaled to a year. A larger figure means wider swings in value."
      />
      <StatTile
        label="Beta"
        value={ratio(s.beta)}
        sub={`Against ${data.benchmark}`}
        hint={`Sensitivity to ${data.benchmark}. 1.00 means the holdings moved in step with it; 0.80 means about 0.8% for each 1% move in the index.`}
      />
      <StatTile
        label="Sharpe ratio"
        value={ratio(s.sharpe)}
        sub={`Over a ${ratioPct(data.risk_free_rate, 2)} risk-free rate`}
        hint="Annualised return above the risk-free rate, divided by volatility: the return earned for each unit of risk taken."
      />
      <StatTile
        label="Max drawdown"
        value={signedRatioPct(settle(s.max_drawdown.value, 1), 1)}
        sub={drawdownDates(s.max_drawdown)}
        hint={`Maximum drawdown: the largest fall from a peak to the low that followed it during the window. ${data.benchmark} fell ${ratioPct(Math.abs(s.benchmark_max_drawdown), 1)} at its worst.`}
      />
      <StatTile
        label="Value at Risk"
        value={inr(s.var_95.historical_amount)}
        sub={`${ratioPct(s.var_95.historical)} of value · 95%, one day`}
        hint="One-day Value at Risk at 95%: on 95 of every 100 days in the window, the holdings lost less than this share in a day. The rupee figure applies that share to today's value."
      />
      <StatTile
        label="Conditional VaR"
        value={inr(s.var_95.cvar_amount)}
        sub={`${ratioPct(s.var_95.cvar)} of value · worst 5% of days`}
        hint="Conditional Value at Risk at 95%, also called expected shortfall: the average one-day loss on the worst 5% of days in the window, applied to today's value."
      />
    </div>
  );
}

// ----------------------------------------------------------------- charts
function Charts({ data }: { data: RiskReport }) {
  const { chart } = useTheme();
  const { series, rolling_volatility: rolling, histogram, summary: s, benchmark } = data;
  const v95 = s.var_95.historical;
  const v99 = s.var_99.historical;

  const returns = useMemo(
    () => [
      { name: "Current holdings", data: series.portfolio, area: true },
      { name: benchmark, data: series.benchmark, dashed: true, color: chart.muted },
    ],
    [series, benchmark, chart],
  );
  const drawdowns = useMemo(
    () => [
      { name: "Current holdings", data: series.drawdown, area: true },
      { name: benchmark, data: series.benchmark_drawdown, dashed: true, color: chart.muted },
    ],
    [series, benchmark, chart],
  );
  const volatility = useMemo(
    () => [
      { name: "Current holdings", data: rolling.portfolio },
      { name: benchmark, data: rolling.benchmark, dashed: true, color: chart.muted },
    ],
    [rolling, benchmark, chart],
  );
  const markers = useMemo(
    () => [
      ...(v95 != null ? [{ value: -v95 * 100, label: "95%" }] : []),
      ...(v99 != null ? [{ value: -v99 * 100, label: "99%" }] : []),
    ],
    [v95, v99],
  );

  return (
    <>
      <Card title="Cumulative return" description={`Today's holdings held unchanged through the window, against ${benchmark}.`} className="lg:col-span-6">
        <TimeSeriesChart label={`Cumulative return of current holdings against ${benchmark}`} dates={series.dates} series={returns} format="signedPct" zeroLine height={260} />
      </Card>

      <Card title="Drawdown" description="How far below its earlier peak the value stood on each day. Zero means a new high." className="lg:col-span-6">
        <TimeSeriesChart label={`Drawdown of current holdings against ${benchmark}`} dates={series.dates} series={drawdowns} format="signedPct" zeroLine height={260} />
      </Card>

      <Card title="Rolling 30-day volatility" description="Annualised volatility of the latest 30 trading days, recalculated each day." className="lg:col-span-6">
        {rolling.dates.length > 1 ? (
          <TimeSeriesChart label={`Rolling 30-day volatility of current holdings against ${benchmark}`} dates={rolling.dates} series={volatility} format="pct" height={260} />
        ) : (
          <div className="flex h-[260px] items-center justify-center text-center text-[13px] text-muted">Rolling volatility needs more than 30 trading days in the window.</div>
        )}
      </Card>

      <Card title="Distribution of daily returns" description="How often each size of one-day move occurred. Taller bars are more common moves." className="lg:col-span-6">
        {histogram.counts.length > 0 ? (
          <>
            <HistogramChart label="Distribution of daily returns" edges={histogram.edges} counts={histogram.counts} format="signedPct" signed markers={markers} height={236} />
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Dashed lines mark the one-day Value at Risk:{" "}
              <span className="num font-medium text-ink-2">{signedRatioPct(v95 == null ? null : -v95)}</span> at 95% and{" "}
              <span className="num font-medium text-ink-2">{signedRatioPct(v99 == null ? null : -v99)}</span> at 99%. Moves beyond ±
              {pct(Math.abs(histogram.edges[0]), 1)} are counted in the end bars.
            </p>
          </>
        ) : (
          <div className="flex h-[260px] items-center justify-center text-[13px] text-muted">No daily returns in this window.</div>
        )}
      </Card>
    </>
  );
}

// ------------------------------------------------------------ correlation
function PairList({ title, pairs }: { title: string; pairs: CorrelationPair[] }) {
  const { chart } = useTheme();
  const symbol = "font-medium text-ink outline-none transition-colors hover:text-accent";
  return (
    <div>
      <h3 className="text-xs font-medium text-muted">{title}</h3>
      <ul className="mt-1 divide-y divide-line">
        {pairs.map((p) => (
          <li key={`${p.a}-${p.b}`} className="flex items-center justify-between gap-3 py-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: diverging(chart, p.value) }} />
              <span className="truncate">
                <Link to={symbolPath(p.a)} className={symbol}>{p.a}</Link>
                <span className="mx-1.5 text-muted">and</span>
                <Link to={symbolPath(p.b)} className={symbol}>{p.b}</Link>
              </span>
            </span>
            <span className="num shrink-0 font-medium text-ink">{ratio(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Correlation({ data }: { data: RiskReport }) {
  const c = data.correlation;
  const count = c.symbols.length;
  const partial = data.holdings.length > count;
  return (
    <Card
      title="Correlation between holdings"
      description="Each cell compares the daily returns of two holdings: near +1 they tended to move together, near 0 they moved independently, and below 0 they tended to move in opposite directions."
      className="lg:col-span-12"
    >
      {count < 2 ? (
        <p className="py-10 text-center text-[13px] text-muted">Correlation compares pairs, so it needs at least two holdings with price history.</p>
      ) : (
        <div className="grid gap-x-8 gap-y-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            <CorrelationHeatmap symbols={c.symbols} matrix={c.matrix} label="Correlation of daily returns between holdings" />
          </div>
          <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                Average pairwise correlation
                <InfoHint text="The mean correlation across every pair of holdings shown. Lower values mean the holdings moved more independently of one another." />
              </div>
              <div className="num mt-1 text-[28px] font-semibold leading-none tracking-tight text-ink">{ratio(c.average)}</div>
              <p className="mt-2 text-[13px] text-muted">
                Across {number((count * (count - 1)) / 2)} pairs among {partial ? `the ${count} largest holdings` : `${count} holdings`}.
              </p>
            </div>
            {c.highest.length > 0 && <PairList title="Most correlated pairs" pairs={c.highest} />}
            {c.lowest.length > 0 && <PairList title="Least correlated pairs" pairs={c.lowest} />}
          </div>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------ risk contribution
function Contribution({ data }: { data: RiskReport }) {
  const { chart } = useTheme();
  const navigate = useNavigate();
  const rows = data.holdings;
  const weightColor = chart.muted;
  const riskColor = seriesColor(chart, 0);
  const max = Math.max(...rows.flatMap((r) => [r.weight, r.risk_contribution]), 1);

  const columns: Column<HoldingRisk>[] = [
    {
      key: "symbol", header: "Holding", sort: (r) => r.symbol,
      cell: (r) => (
        <div className="w-[5.5rem] sm:w-36" title={r.name}>
          <SymbolCell symbol={r.symbol} sub={r.sector} />
        </div>
      ),
    },
    {
      key: "risk", header: "Weight / risk", width: "32%", sort: (r) => r.risk_contribution,
      cell: (r) => (
        <div className="flex min-w-[6.5rem] flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Meter value={r.weight} max={max} color={weightColor} />
            <span className="num w-10 shrink-0 text-right text-xs text-ink-2">{sharePct(r.weight)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Meter value={r.risk_contribution} max={max} color={riskColor} />
            <span className="num w-10 shrink-0 text-right text-xs font-medium text-ink">{sharePct(r.risk_contribution)}</span>
          </div>
        </div>
      ),
    },
    { key: "volatility", header: "Volatility", align: "right", hide: "sm", sort: (r) => r.volatility, cell: (r) => ratioPct(r.volatility, 1) },
    { key: "beta", header: "Beta", align: "right", hide: "md", sort: (r) => r.beta, cell: (r) => ratio(r.beta) },
    {
      key: "return", header: "Return", align: "right", sort: (r) => r.period_return,
      cell: (r) => {
        const value = settle(r.period_return, 1);
        return <Signed value={value}>{signedRatioPct(value, 1)}</Signed>;
      },
    },
    {
      key: "drawdown", header: "Largest fall", align: "right", hide: "md", sort: (r) => r.max_drawdown, hint: "Maximum drawdown of the holding on its own during the window.",
      cell: (r) => signedRatioPct(settle(r.max_drawdown, 1), 1),
    },
  ];

  const points = useMemo(
    () =>
      rows
        .filter((r) => r.volatility != null && r.period_return != null)
        .map((r) => ({ name: r.symbol, x: r.volatility! * 100, y: r.period_return! * 100, size: r.weight })),
    [rows],
  );
  const open = useCallback((symbol: string) => navigate(symbolPath(symbol)), [navigate]);

  return (
    <>
      <Card
        title="Risk contribution"
        description="Each holding's share of the portfolio's variance, beside its weight. The two differ when a holding is more or less volatile, or more or less correlated, than the rest. Return and largest fall are each holding's own over the window."
        className="lg:col-span-12 xl:col-span-8"
        flush
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-1.5 sm:px-5">
          <LegendItem color={weightColor} label="Weight in portfolio" />
          <LegendItem color={riskColor} label="Share of risk" />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.symbol}
          defaultSort={{ key: "risk", dir: "desc" }}
          onRowClick={(r) => navigate(symbolPath(r.symbol))}
        />
      </Card>

      <Card
        title="Volatility and return"
        description="One bubble per holding, sized by weight. Select a bubble to open the stock."
        className="lg:col-span-12 xl:sticky xl:top-[4.5rem] xl:col-span-4 xl:self-start"
      >
        {points.length > 0 ? (
          <ScatterChart
            label="Volatility against return for each holding"
            points={points}
            xLabel="Volatility (annualised)"
            yLabel="Return over the window"
            height={360}
            onSelect={open}
          />
        ) : (
          <div className="flex h-[360px] items-center justify-center text-[13px] text-muted">No holdings with enough price history to plot.</div>
        )}
      </Card>
    </>
  );
}

// ----------------------------------------------------------- more measures
function Measures({ data }: { data: RiskReport }) {
  const s = data.summary;
  const parametric = s.var_99.parametric;
  const signed = (v: number | null) => <Signed value={v}>{signedRatioPct(v)}</Signed>;
  return (
    <Card title="More measures" description={`Other readings of the same ${number(s.observations)} daily returns.`} className="lg:col-span-12">
      <KeyValue
        columns={4}
        items={[
          {
            label: "Annualised return", value: signed(s.annual_return),
            hint: `Compound return of the replayed holdings, expressed per year. ${data.benchmark} returned ${signedRatioPct(s.benchmark_return)} on the same basis.`,
          },
          { label: "Sortino ratio", value: ratio(s.sortino), hint: "Like the Sharpe ratio, but only downward swings count as risk." },
          { label: "Alpha (annualised)", value: signed(s.alpha), hint: `Return per year beyond what the holdings' beta to ${data.benchmark} would explain.` },
          { label: "Tracking error", value: ratioPct(s.tracking_error), hint: `How far daily returns strayed from those of ${data.benchmark}, annualised. Near zero means the holdings followed the index closely.` },
          { label: "Upside capture", value: ratioPct(s.up_capture, 1), hint: `On days ${data.benchmark} rose, the holdings' average move as a share of the index's average gain.` },
          { label: "Downside capture", value: ratioPct(s.down_capture, 1), hint: `On days ${data.benchmark} fell, the holdings' average move as a share of the index's average loss.` },
          { label: "Best day", value: signed(s.best_day), hint: "The largest one-day gain in the window." },
          { label: "Worst day", value: signed(s.worst_day), hint: "The largest one-day loss in the window." },
          { label: "Positive days", value: ratioPct(s.positive_days, 1), hint: "Share of trading days on which the holdings ended higher than the day before." },
          { label: "Skewness", value: ratio(s.skew), hint: "Lopsidedness of daily returns. Below zero, the large moves were more often losses; above zero, more often gains." },
          { label: "Excess kurtosis", value: ratio(s.kurtosis), hint: "How heavy the tails are compared with a bell curve. Above zero, extreme days were more frequent than a normal distribution implies." },
          { label: "Annualised variance", value: number(data.variance.annual, 4), hint: "Portfolio variance: the variance of the holdings' combined daily returns, scaled to a year. Volatility is its square root." },
          { label: "Diversification ratio", value: ratio(data.variance.diversification_ratio), hint: "Weighted average of the holdings' own volatilities, divided by the portfolio's volatility. Above 1, combining the holdings lowered overall volatility." },
          {
            label: "VaR 99% (historical)", value: `${ratioPct(s.var_99.historical)} · ${inr(s.var_99.historical_amount)}`,
            hint: "On 99 of every 100 days in the window, the one-day loss was smaller than this. Read directly from the observed returns.",
          },
          {
            label: "VaR 99% (parametric)", value: `${ratioPct(parametric)} · ${inr(parametric == null ? null : parametric * data.value)}`,
            hint: "The same 99% one-day loss, estimated from the mean and volatility by assuming returns follow a bell curve.",
          },
          { label: "Observations", value: `${number(s.observations)} trading days`, hint: "Number of daily returns the report is built on. Fewer than the lookback when holdings have a shorter price history." },
        ]}
      />
    </Card>
  );
}

// ------------------------------------------------------------------- page
function Loading() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[92px]" />)}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <CardSkeleton className="lg:col-span-6" />
        <CardSkeleton className="lg:col-span-6" />
        <CardSkeleton className="lg:col-span-6" />
        <CardSkeleton className="lg:col-span-6" />
        <CardSkeleton height={420} className="lg:col-span-12" />
      </div>
    </>
  );
}

function Content({ id }: { id: string }) {
  const { name, portfolio } = usePortfolio();
  const actions = useAppActions();
  const [lookback, setLookback] = useState<Lookback>("1Y");
  const risk = useRisk(id, lookback);
  const data = risk.data;
  const dates = data && !data.empty ? data.series.dates : [];

  return (
    <Page
      title="Risk"
      description={
        <>
          Replays today's holdings{name ? ` in ${name}` : ""}, at today's weights, over the past {SPAN[lookback]}. It shows how this mix behaved, not what the portfolio actually held on each day.
          {data && (
            <span className="mt-1 block text-[13px]">
              Benchmark: {data.benchmark} · Risk-free rate: {ratioPct(data.risk_free_rate, 2)}
              {dates.length > 1 && ` · ${date(dates[0])} to ${date(dates[dates.length - 1])}`}
            </span>
          )}
        </>
      }
      actions={<Segmented label="Lookback window" value={lookback} onChange={setLookback} options={LOOKBACKS} />}
    >
      {risk.isError ? (
        <Card><ErrorState error={risk.error} onRetry={() => risk.refetch()} /></Card>
      ) : !data ? (
        <Loading />
      ) : data.empty ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<Activity />}
            title="Not enough price history to measure risk"
            description="Risk is worked out from daily prices, so it needs priced holdings with at least a month of history. Add holdings, or come back once the newest ones have traded for a few weeks."
            action={
              portfolio?.kind === "paper" ? (
                <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
              ) : (
                <>
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
                  <Link to="/holdings"><Button>View holdings</Button></Link>
                </>
              )
            }
          />
        </Card>
      ) : (
        <Pending active={risk.isPlaceholderData}>
          <Headline data={data} />
          <div className="mt-4 grid gap-4 lg:grid-cols-12">
            <Charts data={data} />
            <Correlation data={data} />
            <Contribution data={data} />
            <Measures data={data} />
          </div>
        </Pending>
      )}
    </Page>
  );
}

export function RiskPage() {
  return <RequirePortfolio>{(id) => <Content id={id} />}</RequirePortfolio>;
}
