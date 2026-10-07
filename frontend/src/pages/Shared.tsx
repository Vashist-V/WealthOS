import { useQuery } from "@tanstack/react-query";
import { Eye, LinkIcon, Moon, Sun } from "lucide-react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { DonutChart, TimeSeriesChart } from "@/components/charts";
import { Brand } from "@/components/layout/AppShell";
import { Badge, Card, CardSkeleton, DataTable, EmptyState, IconButton, Meter, Signed, StatTile, type Column } from "@/components/ui";
import { AllocationList, useBucketColors } from "@/components/widgets";
import { api } from "@/lib/api";
import { date, inr, pct, price, quantity, ratioPct, signedInr, signedPct, signedRatioPct } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { SharedPortfolio } from "@/lib/types";

type Row = SharedPortfolio["holdings"][number];

function View({ data }: { data: SharedPortfolio }) {
  const { chart } = useTheme();
  const s = data.summary;
  const colors = useBucketColors(data.allocation.asset_classes.map((a) => a.name));
  const maxWeight = Math.max(...data.holdings.map((h) => h.weight), 1);
  const columns: Column<Row>[] = [
    {
      key: "symbol", header: "Holding", sort: (r) => r.symbol,
      cell: (r) => (
        <div className="min-w-0 max-w-56">
          <div className="truncate font-medium text-ink">{r.symbol}</div>
          <div className="truncate text-xs text-muted">{r.name}</div>
        </div>
      ),
    },
    { key: "sector", header: "Sector", hide: "md", sort: (r) => r.sector, cell: (r) => r.sector },
    ...(data.show_values
      ? ([
          { key: "quantity", header: "Qty", align: "right", hide: "lg", sort: (r) => r.quantity, cell: (r) => quantity(r.quantity) },
          { key: "avg", header: "Avg cost", align: "right", hide: "lg", sort: (r) => r.avg_cost, cell: (r) => price(r.avg_cost) },
        ] as Column<Row>[])
      : []),
    {
      key: "price", header: "Price", align: "right", sort: (r) => r.day_change_pct,
      cell: (r) => (
        <div>
          <div className="text-ink">{price(r.price)}</div>
          <Signed value={r.day_change_pct} className="text-xs">{signedPct(r.day_change_pct)}</Signed>
        </div>
      ),
    },
    ...(data.show_values ? ([{ key: "value", header: "Value", align: "right", sort: (r) => r.value, cell: (r) => <span className="font-medium text-ink">{inr(r.value)}</span> }] as Column<Row>[]) : []),
    {
      key: "pnl", header: "Return", align: "right", sort: (r) => r.pnl_pct,
      cell: (r) => (
        <div>
          <Signed value={r.pnl_pct}>{signedPct(r.pnl_pct)}</Signed>
          {data.show_values && <div><Signed value={r.pnl} className="text-xs">{signedInr(r.pnl)}</Signed></div>}
        </div>
      ),
    },
    {
      key: "weight", header: "Weight", align: "right", sort: (r) => r.weight,
      cell: (r) => (
        <div className="ml-auto flex w-24 items-center gap-2">
          <Meter value={r.weight} max={maxWeight} />
          <span className="w-10 shrink-0 text-right">{pct(r.weight, 1)}</span>
        </div>
      ),
    },
  ];

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="size-3 rounded-full" style={{ background: data.color ?? "var(--accent)" }} />
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{data.name}</h1>
          <Badge tone="accent"><Eye className="size-3" /> Read-only</Badge>
          {data.kind === "paper" && <Badge>Paper trading</Badge>}
        </div>
        {data.description && <p className="mt-1.5 max-w-2xl text-sm text-ink-2">{data.description}</p>}
        <p className="mt-1.5 text-[13px] text-muted">
          {s.holdings_count} holdings{s.since ? ` · invested since ${date(s.since)}` : ""}{s.as_of ? ` · prices as of ${date(s.as_of)}` : ""} · compared with {data.benchmark}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {data.show_values && s.value !== undefined && <StatTile label="Current value" value={inr(s.value)} sub={<Signed value={s.day_pct}>{signedPct(s.day_pct)} today</Signed>} />}
        <StatTile label="Unrealised return" value={<Signed value={s.unrealized_pct}>{signedPct(s.unrealized_pct)}</Signed>} sub="On current holdings" />
        <StatTile label="XIRR" value={s.xirr == null ? "—" : <Signed value={s.xirr}>{signedRatioPct(s.xirr)}</Signed>} sub="Money-weighted, per year" hint="Annual return that accounts for when money went in or came out." />
        <StatTile label="CAGR" value={s.cagr == null ? "—" : <Signed value={s.cagr}>{signedRatioPct(s.cagr)}</Signed>} sub={s.cagr == null ? "Needs a year of history" : "Time-weighted, per year"} />
        <StatTile label="Volatility" value={ratioPct(s.volatility, 1)} sub="Annualised" hint="How much daily returns have varied, scaled to a year." />
        <StatTile label="Largest fall" value={ratioPct(s.max_drawdown, 1)} sub="Peak to trough" />
        {!data.show_values && <StatTile label="Today" value={<Signed value={s.day_pct}>{signedPct(s.day_pct)}</Signed>} sub="Change in value" />}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <Card title="Return since inception" description={`Time-weighted, against ${data.benchmark}`} className="lg:col-span-8">
          {data.performance.dates.length > 1 ? (
            <TimeSeriesChart
              label="Portfolio return against the benchmark"
              dates={data.performance.dates}
              format="signedPct"
              zeroLine
              height={300}
              series={[
                { name: data.name, data: data.performance.portfolio_return, area: true },
                { name: data.benchmark, data: data.performance.benchmark_return, dashed: true, color: chart.muted },
              ]}
            />
          ) : (
            <p className="py-16 text-center text-[13px] text-muted">Not enough history to chart yet.</p>
          )}
        </Card>
        <Card title="Asset allocation" className="lg:col-span-4">
          <DonutChart label="Asset allocation" format="pct" height={180} data={data.allocation.asset_classes.map((a) => ({ name: a.name, value: a.weight, color: colors[a.name] }))} />
          <AllocationList className="mt-4" items={data.allocation.asset_classes} colors={colors} showValue={false} />
        </Card>
        <Card title="Holdings" description="Largest first" className="lg:col-span-8" flush>
          <DataTable columns={columns} rows={data.holdings} rowKey={(r) => r.symbol} defaultSort={{ key: "weight", dir: "desc" }} />
        </Card>
        <Card title="Sector allocation" description={`${data.allocation.sectors.length} sectors`} className="lg:col-span-4">
          <AllocationList items={data.allocation.sectors} showValue={false} />
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
      </div>
    </>
  );
}

/** Public, read-only view of a portfolio reached through a share link. */
export function SharedPage() {
  const { token = "" } = useParams();
  const { theme, toggle } = useTheme();
  const { data, isLoading, isError } = useQuery({ queryKey: ["shared", token], queryFn: () => api.shared(token), staleTime: 60_000, refetchInterval: 120_000, retry: false });
  useEffect(() => {
    document.title = data ? `${data.name} · WealthOS` : "Shared portfolio · WealthOS";
  }, [data]);
  return (
    <div className="min-h-dvh">
      <nav className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-bg/85 px-4 backdrop-blur-md sm:px-8">
        <Link to="/" className="flex items-center">
          <Brand />
        </Link>
        <IconButton label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={toggle}>
          {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </IconButton>
      </nav>
      <main className="mx-auto w-full max-w-[1280px] animate-rise px-4 pb-16 pt-7 sm:px-8">
        {isLoading ? (
          <div className="grid gap-4 lg:grid-cols-12">
            <CardSkeleton className="lg:col-span-8" />
            <CardSkeleton className="lg:col-span-4" />
          </div>
        ) : isError || !data ? (
          <Card>
            <EmptyState
              className="py-20"
              icon={<LinkIcon />}
              title="This link isn't available"
              description="The portfolio's owner may have turned sharing off, or the link is incomplete. Ask them for a new one."
            />
          </Card>
        ) : (
          <View data={data} />
        )}
        <p className="mt-8 text-center text-xs text-muted">
          A read-only view shared from WealthOS. Figures are for information only and are not investment advice.
        </p>
      </main>
    </div>
  );
}
