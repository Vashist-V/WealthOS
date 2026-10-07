import { Plus, Printer, ScanSearch } from "lucide-react";
import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ratio, settle, Swatch } from "@/components/analytics/shared";
import { DonutChart } from "@/components/charts";
import { useAppActions } from "@/components/layout/AppShell";
import {
  Button, Card, CardSkeleton, DataTable, EmptyState, ErrorState, InfoHint, KeyValue, Meter, Page, RangeBar, Signed, Skeleton, SymbolCell,
  type Column,
} from "@/components/ui";
import { AllocationList, bucketItems, foldBuckets, RequirePortfolio, useBucketColors } from "@/components/widgets";
import { compact, date, inr, number, pct, ratioPct, signedPct, signedRatioPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useXRay } from "@/lib/queries";
import type { Holding, XRay } from "@/lib/types";
import { symbolPath } from "@/lib/utils";

/**
 * Print rules for this report. The app shell (sidebar, top bar, phone tab bar)
 * is shared code this page cannot restyle with classes, so its chrome is taken
 * off the paper here; meters and swatches are backgrounds, which browsers drop
 * from print unless asked to keep them.
 */
const PRINT_CSS = `
@media print {
  @page { margin: 12mm; }
  html, body { background: white !important; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body aside, body header.sticky, body nav[aria-label="Quick navigation"], [data-sonner-toaster] { display: none !important; }
  .card { box-shadow: none !important; break-inside: avoid; }
}`;

/** Paper is white: print in the light theme, then put the reader's theme back. */
function usePrintInLightTheme() {
  useEffect(() => {
    const root = document.documentElement;
    let previous: string | null = null;
    const before = () => {
      if (root.dataset.theme === "dark") {
        previous = "dark";
        root.dataset.theme = "light";
      }
    };
    const after = () => {
      if (previous) root.dataset.theme = previous;
      previous = null;
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      after();
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
}

/** The backend writes observations with ISO dates and ASCII minus signs; show them the way the rest of the app does. */
function tidy(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, (iso) => date(iso)).replace(/(^|[\s(])-(?=\d)/g, "$1−");
}

// ---------------------------------------------------------------- summary
function Figure({ label, value, sub, hint }: { label: string; value: ReactNode; sub?: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-4 sm:px-5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="truncate">{label}</span>
        {hint && <span className="inline-flex print:hidden"><InfoHint text={hint} /></span>}
      </div>
      <div className="num mt-1.5 truncate text-[22px] font-semibold leading-7 tracking-tight text-ink">{value}</div>
      {sub && <div className="mt-1 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

function Summary({ data }: { data: XRay }) {
  const { portfolio } = usePortfolio();
  const { metrics: m, summary: s } = data;
  const benchmark = data.portfolio.benchmark_name;
  const topThree = useMemo(() => [...data.holdings].sort((a, b) => b.weight - a.weight).slice(0, 3).map((h) => h.symbol), [data.holdings]);
  const sectors = data.allocation.sectors.length;
  const color = portfolio && portfolio.id === data.portfolio.id ? portfolio.color : "var(--ink-2)";

  return (
    <section className="card overflow-hidden">
      <header className="flex flex-wrap items-start justify-between gap-x-10 gap-y-4 px-4 pb-4 pt-4 sm:px-5 sm:pb-5 sm:pt-5">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Portfolio X-Ray</div>
          <h2 className="mt-1.5 flex items-center gap-2.5 text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-[28px]">
            <Swatch color={color} className="size-3" />
            <span className="min-w-0 break-words">{data.portfolio.name}</span>
          </h2>
          <p className="mt-1.5 text-[13px] text-muted">
            {s.holdings_count} holding{s.holdings_count === 1 ? "" : "s"} across {sectors} sector{sectors === 1 ? "" : "s"}
            {s.first_investment && ` · invested since ${date(s.first_investment)}`}
            {data.portfolio.kind === "paper" && " · paper trading, simulated"}
          </p>
        </div>
        <dl className="flex gap-x-8 sm:text-right">
          <div>
            <dt className="text-xs text-muted">Benchmark</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">{benchmark}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">As of</dt>
            <dd className="num mt-0.5 text-sm font-medium text-ink">{date(s.as_of)}</dd>
          </div>
        </dl>
      </header>

      <div className="grid grid-cols-2 gap-px border-y border-line bg-line xl:grid-cols-4 print:grid-cols-4">
        <Figure
          label="Portfolio value"
          value={m.value >= 1e7 ? compact(m.value) : inr(m.value)}
          sub={<><Signed value={s.unrealized_pct}>{signedPct(s.unrealized_pct)}</Signed> on {compact(s.invested)} invested</>}
          hint="Market value of the holdings at the latest prices. Cash is not included."
        />
        <Figure
          label="Largest holding"
          value={pct(m.largest_holding?.weight, 1)}
          sub={m.largest_holding ? <Link to={symbolPath(m.largest_holding.symbol)} className="text-ink-2 outline-none hover:text-accent">{m.largest_holding.symbol}</Link> : undefined}
          hint="The biggest single position as a share of the value of all holdings."
        />
        <Figure label="Top 3 holdings" value={pct(m.top_3, 1)} sub={topThree.join(", ")} hint="Combined share of the three biggest positions." />
        <Figure label="Largest sector" value={pct(m.largest_sector?.weight, 1)} sub={m.largest_sector?.name} hint="The sector with the highest share of the value of all holdings." />
        <Figure
          label="Volatility"
          value={ratioPct(m.volatility, 1)}
          sub={`${benchmark}: ${ratioPct(m.benchmark_volatility, 1)}`}
          hint="How much daily returns of today's holdings varied over the past year, scaled to a year."
        />
        <Figure
          label="Maximum drawdown"
          value={signedRatioPct(settle(m.max_drawdown, 1), 1)}
          sub="Largest fall, past year"
          hint="The largest fall of today's holdings from a peak to the low that followed, over the past year."
        />
        <Figure label="Dividend yield" value={pct(m.dividend_yield)} sub="At trailing 12-month payouts" hint="A year of dividends at each company's last twelve months of payouts, as a share of current value." />
        <Figure
          label="Historical beta"
          value={ratio(m.beta)}
          sub={`Against ${benchmark}`}
          hint={`Sensitivity of today's holdings to ${benchmark} over the past year. 1.00 means they moved in step with it.`}
        />
      </div>

      <div className="px-4 py-4 sm:px-5">
        <KeyValue
          columns={4}
          items={[
            { label: "Sharpe ratio", value: ratio(m.sharpe), hint: "Annualised return above the risk-free rate, divided by volatility, over the past year." },
            {
              label: "Effective holdings", value: `${number(m.effective_holdings, 1)} of ${s.holdings_count}`,
              hint: "How many equally sized positions would be as concentrated as this portfolio. It equals the number of holdings only when all are the same size.",
            },
            { label: "Average correlation", value: ratio(m.average_correlation), hint: "Mean correlation of daily returns across every pair of holdings. Near +1 they move together; near 0, independently." },
            {
              label: "XIRR", value: m.xirr == null ? "—" : <Signed value={m.xirr}>{signedRatioPct(m.xirr)}</Signed>,
              hint: "Annual return that accounts for when each rupee went in or came out.",
            },
          ]}
        />
        <p className="mt-4 border-t border-line pt-3 text-xs leading-relaxed text-muted">
          Volatility, drawdown, beta, Sharpe ratio and correlation replay today's holdings, at today's weights, over the past year. XIRR is measured on the actual transactions.
        </p>
      </div>
    </section>
  );
}

// ----------------------------------------------------------- observations
function Observations({ items }: { items: XRay["observations"] }) {
  const groups = useMemo(() => {
    const map = new Map<string, XRay["observations"]>();
    items.forEach((o) => map.set(o.category, [...(map.get(o.category) ?? []), o]));
    return [...map.entries()];
  }, [items]);

  return (
    <Card title="Observations" description="Facts drawn from the holdings and the past year of prices. They describe the portfolio; they are not recommendations." className="lg:col-span-7">
      {groups.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-muted">Observations appear once the portfolio has priced holdings.</p>
      ) : (
        <div className="divide-y divide-line">
          {groups.map(([category, list]) => (
            <section key={category} className="grid gap-x-6 gap-y-2 py-4 first:pt-1 last:pb-0 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
              <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted sm:pt-0.5">{category}</h3>
              <ul className="flex flex-col gap-3.5">
                {list.map((o) => (
                  <li key={o.title} className="break-inside-avoid">
                    <p className="text-sm font-medium leading-snug text-ink">{tidy(o.title)}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{tidy(o.detail)}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------- structure
function Structure({ data }: { data: XRay }) {
  const assets = data.allocation.asset_classes;
  const colors = useBucketColors(assets.map((a) => a.name));
  const palette = Object.values(colors).join();
  // `colors` is a fresh object on every render; key the memo on its contents so the donut is not redrawn needlessly.
  const slices = useMemo(() => assets.map((a) => ({ name: a.name, value: a.value, color: colors[a.name] })), [assets, palette]); // eslint-disable-line react-hooks/exhaustive-deps
  const sectors = useMemo(() => foldBuckets(data.allocation.sectors, 7), [data.allocation.sectors]);
  return (
    <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
      <Card title="Asset classes" description="Share of net worth, cash included">
        <div className="grid items-center gap-x-6 gap-y-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]">
          <DonutChart
            label="Asset class allocation"
            height={176}
            data={slices}
            center={
              <>
                <span className="text-xs text-muted">Net worth</span>
                <span className="num text-lg font-semibold tracking-tight text-ink">{compact(data.summary.net_worth)}</span>
              </>
            }
          />
          <AllocationList items={bucketItems(assets).map((a) => ({ ...a, sub: undefined }))} colors={colors} showValue={false} />
        </div>
      </Card>
      <Card title="Sectors" description={`${data.allocation.sectors.length} sector${data.allocation.sectors.length === 1 ? "" : "s"}, by share of holdings`} className="flex-1">
        <AllocationList items={sectors} />
      </Card>
    </div>
  );
}

function TopHoldings({ rows, total }: { rows: Holding[]; total: number }) {
  const top = useMemo(() => [...rows].sort((a, b) => b.weight - a.weight).slice(0, 10), [rows]);
  const max = Math.max(...top.map((r) => r.weight), 1);
  const columns: Column<Holding>[] = [
    {
      key: "symbol", header: "Holding", sort: (r) => r.symbol,
      cell: (r) => (
        <div className="w-28 sm:w-40 xl:w-52">
          <SymbolCell symbol={r.symbol} name={r.name} />
        </div>
      ),
    },
    { key: "sector", header: "Sector", hide: "md", sort: (r) => r.sector, cell: (r) => r.sector },
    {
      key: "weight", header: "Weight", align: "right", sort: (r) => r.weight,
      cell: (r) => (
        <div className="ml-auto flex w-[5.5rem] items-center gap-2 sm:w-28">
          <Meter value={r.weight} max={max} />
          <span className="w-10 shrink-0 text-right">{pct(r.weight, 1)}</span>
        </div>
      ),
    },
    { key: "value", header: "Value", align: "right", hide: "sm", sort: (r) => r.value, cell: (r) => <span className="text-ink">{inr(r.value)}</span> },
    {
      key: "pnl", header: "P&L", align: "right", sort: (r) => r.pnl_pct,
      cell: (r) => <Signed value={r.pnl_pct}>{signedPct(r.pnl_pct, 1)}</Signed>,
    },
    {
      key: "range", header: "52-week range", hide: "sm", width: "148px", hint: "Where the current price sits between the 52-week low and high.",
      cell: (r) => (
        <div className="w-28">
          <RangeBar low={r.low_52w} high={r.high_52w} value={r.price} />
          {r.low_52w != null && r.high_52w != null && r.high_52w > r.low_52w && (
            <div className="num mt-1.5 flex justify-between text-[11px] leading-none text-muted">
              <span>{inr(r.low_52w)}</span>
              <span>{inr(r.high_52w)}</span>
            </div>
          )}
        </div>
      ),
    },
  ];
  return (
    <Card
      title={total > 10 ? "Top ten holdings" : "Holdings"}
      description={`${total > 10 ? `The ten largest of ${total} positions` : `${total} position${total === 1 ? "" : "s"}`}, with unrealised P&L against average cost`}
      className="lg:col-span-12"
      flush
      action={<Link to="/holdings" className="text-xs font-medium text-accent hover:underline print:hidden">All holdings</Link>}
    >
      <DataTable columns={columns} rows={top} rowKey={(r) => r.symbol} defaultSort={{ key: "weight", dir: "desc" }} />
    </Card>
  );
}

// ------------------------------------------------------------------- page
function Content({ id }: { id: string }) {
  const { name, portfolio } = usePortfolio();
  const actions = useAppActions();
  const xray = useXRay(id);
  const data = xray.data;
  usePrintInLightTheme();

  return (
    <Page
      title="X-Ray"
      description={`The structure and character of ${name || "this portfolio"} on one page: what it holds, how concentrated it is, how it has moved and what it pays.`}
      className="print:px-0 print:pb-0 print:pt-0"
      actions={
        data && data.holdings.length > 0 ? (
          <Button className="print:hidden" icon={<Printer className="size-4" />} onClick={() => window.print()}>
            Print / save as PDF
          </Button>
        ) : undefined
      }
    >
      <style>{PRINT_CSS}</style>
      {xray.isError ? (
        <Card><ErrorState error={xray.error} onRetry={() => xray.refetch()} /></Card>
      ) : !data ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="card p-5 lg:col-span-12">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-3 h-8 w-64 max-w-full" />
            <Skeleton className="mt-6 h-40 w-full" />
          </div>
          <CardSkeleton height={380} className="lg:col-span-7" />
          <CardSkeleton height={380} className="lg:col-span-5" />
          <CardSkeleton className="lg:col-span-12" />
        </div>
      ) : data.holdings.length === 0 ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<ScanSearch />}
            title={`${name || "This portfolio"} has nothing to X-ray yet`}
            description="The X-Ray reads the structure of what a portfolio holds, so it needs at least one holding."
            action={
              portfolio?.kind === "paper" ? (
                <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
              ) : (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-12">
            <Summary data={data} />
          </div>
          <Observations items={data.observations} />
          <Structure data={data} />
          <TopHoldings rows={data.holdings} total={data.holdings.length} />
        </div>
      )}
    </Page>
  );
}

export function XRayPage() {
  return <RequirePortfolio>{(id) => <Content id={id} />}</RequirePortfolio>;
}
