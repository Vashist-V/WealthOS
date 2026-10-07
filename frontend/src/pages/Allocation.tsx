import { PieChart, Plus } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BarChart, DonutChart } from "@/components/charts";
import { useAppActions } from "@/components/layout/AppShell";
import { plural } from "@/components/portfolio/shared";
import { Button, Card, CardSkeleton, DataTable, EmptyState, ErrorState, KeyValue, Meter, Page, Signed, type Column } from "@/components/ui";
import { AllocationList, bucketItems, foldBuckets, RequirePortfolio, useBucketColors } from "@/components/widgets";
import { compact, DASH, inr, number, pct, signedInr, signedPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useOverview } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Bucket, Holding, Overview } from "@/lib/types";
import { symbolPath } from "@/lib/utils";

const NO_BUCKETS: Bucket[] = [];
const NO_HOLDINGS: Holding[] = [];
/** Sectors that keep their own donut slice; the rest fold into one. */
const SECTOR_SLICES = 7;
const TOP_HOLDINGS = 15;

function WeightCell({ weight, max, color }: { weight: number; max: number; color?: string }) {
  return (
    <div className="ml-auto flex items-center justify-end gap-2 sm:w-[6.5rem]">
      <Meter value={weight} max={max} color={color} className="max-sm:hidden" />
      <span className="w-11 shrink-0 text-right">{pct(weight, 1)}</span>
    </div>
  );
}

function Concentration({ data }: { data: Overview }) {
  const c = data.allocation.concentration;
  const count = data.holdings.length;
  const steps = [
    { label: "Largest holding", value: c.largest_holding?.weight, symbol: c.largest_holding?.symbol },
    ...[
      { n: 3, value: c.top_3 },
      { n: 5, value: c.top_5 },
      { n: 10, value: c.top_10 },
    ]
      // "Top 5" of four holdings is just all of them.
      .filter((step) => step.n < count)
      .map((step) => ({ label: `Top ${step.n} holdings`, value: step.value, symbol: undefined })),
  ];
  return (
    <Card tour="alloc-concentration" title="Concentration" description="How much of the holdings value sits in the largest positions. Cash is left out." className="lg:col-span-7">
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <ul className="flex flex-col gap-3.5">
          {steps.map((step) => (
            <li key={step.label}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                <span className="flex min-w-0 items-baseline gap-2 text-ink">
                  <span className="shrink-0">{step.label}</span>
                  {step.symbol && (
                    <Link to={symbolPath(step.symbol)} className="truncate text-xs text-muted hover:text-accent">
                      {step.symbol}
                    </Link>
                  )}
                </span>
                <span className="num shrink-0 font-medium text-ink">{pct(step.value, 1)}</span>
              </div>
              <Meter value={step.value ?? 0} max={100} />
            </li>
          ))}
        </ul>
        <KeyValue
          columns={2}
          className="content-start"
          items={[
            {
              label: "Largest sector",
              value: c.largest_sector ? (
                <>
                  {c.largest_sector.name} <span className="font-normal text-muted">{pct(c.largest_sector.weight, 1)}</span>
                </>
              ) : (
                DASH
              ),
            },
            {
              label: "Effective holdings",
              value: (
                <>
                  {number(c.effective_holdings, 1)} <span className="font-normal text-muted">of {count} held</span>
                </>
              ),
              hint: "The number of equal-sized positions that would give the same concentration. It is the inverse of the Herfindahl index.",
            },
            {
              label: "Herfindahl index",
              value: number(c.hhi, 3),
              hint: "The sum of each holding's squared share of the portfolio. It is 1 for a single holding and falls towards 0 as money is spread across more of them.",
            },
            { label: "Sectors", value: String(data.allocation.sectors.length) },
            { label: "Industries", value: String(data.allocation.industries.length) },
          ]}
        />
      </div>
    </Card>
  );
}

function Content({ id }: { id: string }) {
  const { name, portfolio } = usePortfolio();
  const actions = useAppActions();
  const navigate = useNavigate();
  const { chart } = useTheme();
  const overview = useOverview(id);
  const data = overview.data;

  const assets = data?.allocation.asset_classes ?? NO_BUCKETS;
  const sectors = data?.allocation.sectors ?? NO_BUCKETS;
  const industries = data?.allocation.industries ?? NO_BUCKETS;
  const holdings = data?.holdings ?? NO_HOLDINGS;

  const assetColors = useBucketColors(assets.map((a) => a.name));

  /** Largest sectors keep a slice each; the tail becomes one grey slice named for what it holds. */
  const sectorSlices = useMemo(() => {
    const folded = foldBuckets(sectors, SECTOR_SLICES);
    if (folded === sectors) return folded;
    return folded.map((b, i) => (i === SECTOR_SLICES ? { ...b, name: `Other (${plural(sectors.length - SECTOR_SLICES, "sector")})` } : b));
  }, [sectors]);
  const sliceColors = useBucketColors(sectorSlices.map((b) => b.name));
  const sectorsFolded = sectorSlices.length !== sectors.length;
  const sectorColor = (sectorName: string, index: number) => (sectorsFolded && index >= SECTOR_SLICES ? chart.muted : (sliceColors[sectorName] ?? chart.muted));
  const sectorIndex = useMemo(() => new Map(sectors.map((b, i) => [b.name, i])), [sectors]);

  const top = useMemo(() => [...holdings].sort((a, b) => b.weight - a.weight).slice(0, TOP_HOLDINGS), [holdings]);
  const topSymbols = useMemo(() => top.map((h) => h.symbol), [top]);
  const topSeries = useMemo(() => [{ name: "Weight", data: top.map((h) => h.weight) }], [top]);
  const openStock = useCallback((symbol: string) => navigate(symbolPath(symbol)), [navigate]);

  if (overview.isError) {
    return (
      <Page title="Allocation">
        <Card><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></Card>
      </Page>
    );
  }

  const paper = portfolio?.kind === "paper";
  const maxSector = Math.max(...sectors.map((b) => b.weight), 1);
  const maxIndustry = Math.max(...industries.map((b) => b.weight), 1);

  const sectorColumns: Column<Bucket>[] = [
    {
      key: "name", header: "Sector", sort: (b) => b.name,
      cell: (b) => (
        <span className="flex items-center gap-2 text-ink">
          <span className="size-2 shrink-0 rounded-full" style={{ background: sectorColor(b.name, sectorIndex.get(b.name) ?? 0) }} aria-hidden />
          <span className="truncate">{b.name}</span>
        </span>
      ),
    },
    { key: "count", header: "Holdings", align: "right", hide: "md", sort: (b) => b.count, cell: (b) => b.count },
    { key: "value", header: "Value", align: "right", sort: (b) => b.value, cell: (b) => <span className="font-medium text-ink">{inr(b.value)}</span> },
    { key: "weight", header: "Weight", align: "right", sort: (b) => b.weight, cell: (b) => <WeightCell weight={b.weight} max={maxSector} color={sectorColor(b.name, sectorIndex.get(b.name) ?? 0)} /> },
    { key: "pnl", header: "P&L", align: "right", hide: "sm", sort: (b) => b.pnl, cell: (b) => <Signed value={b.pnl}>{signedInr(b.pnl)}</Signed> },
    { key: "pnl_pct", header: "P&L %", align: "right", hide: "sm", sort: (b) => b.pnl_pct, cell: (b) => <Signed value={b.pnl_pct}>{signedPct(b.pnl_pct)}</Signed> },
    { key: "day", header: "Today", align: "right", hide: "md", sort: (b) => b.day_pnl, cell: (b) => <Signed value={b.day_pnl}>{signedInr(b.day_pnl)}</Signed> },
  ];

  const industryColumns: Column<Bucket>[] = [
    { key: "name", header: "Industry", sort: (b) => b.name, cell: (b) => <span className="text-ink">{b.name}</span> },
    { key: "count", header: "Holdings", align: "right", hide: "sm", sort: (b) => b.count, cell: (b) => b.count },
    { key: "value", header: "Value", align: "right", sort: (b) => b.value, cell: (b) => <span className="font-medium text-ink">{inr(b.value)}</span> },
    { key: "weight", header: "Weight", align: "right", sort: (b) => b.weight, cell: (b) => <WeightCell weight={b.weight} max={maxIndustry} /> },
  ];

  return (
    <Page
      title="Allocation"
      description={data ? `${name} · ${plural(holdings.length, "holding")} in ${plural(sectors.length, "sector")}` : undefined}
    >
      {!data ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <CardSkeleton height={320} className="lg:col-span-5" />
          <CardSkeleton height={320} className="lg:col-span-7" />
          <CardSkeleton height={360} className="lg:col-span-12" />
          <CardSkeleton height={320} className="lg:col-span-12 xl:col-span-6" />
          <CardSkeleton height={320} className="lg:col-span-12 xl:col-span-6" />
        </div>
      ) : holdings.length === 0 ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<PieChart />}
            title={`${name} has nothing to allocate yet`}
            description={
              paper
                ? "Allocation by asset class, sector and industry appears once a simulated order fills."
                : "Allocation by asset class, sector and industry appears once the portfolio holds something."
            }
            action={
              paper ? (
                <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
              ) : (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <Card title="Asset allocation" description="Share of net worth, cash included." className="lg:col-span-5">
            <DonutChart
              label="Asset allocation by value"
              height={200}
              data={assets.map((a) => ({ name: a.name, value: a.value, color: assetColors[a.name] }))}
              center={
                <>
                  <span className="text-xs text-muted">Net worth</span>
                  <span className="num text-lg font-semibold tracking-tight text-ink">{compact(data.summary.net_worth)}</span>
                </>
              }
            />
            <AllocationList className="mt-5" items={bucketItems(assets).map((a) => ({ ...a, sub: undefined }))} colors={assetColors} />
          </Card>

          <Concentration data={data} />

          <Card title="Sector allocation" description="Share of holdings value. Sort any column." className="lg:col-span-12" flush bodyClassName="xl:grid xl:grid-cols-[260px_minmax(0,1fr)]">
            <div className="px-4 pb-4 sm:px-5 xl:pb-5 xl:pt-2">
              <DonutChart
                label="Sector allocation by value"
                height={210}
                data={sectorSlices.map((b, i) => ({ name: b.name, value: b.value, color: sectorsFolded && i === SECTOR_SLICES ? chart.muted : sliceColors[b.name] }))}
                center={
                  <>
                    <span className="text-xs text-muted">Holdings</span>
                    <span className="num text-lg font-semibold tracking-tight text-ink">{compact(data.summary.value)}</span>
                  </>
                }
              />
              {sectorsFolded && (
                <p className="mt-3 text-center text-xs leading-relaxed text-muted">
                  The {SECTOR_SLICES} largest sectors have a slice each. The other {sectors.length - SECTOR_SLICES} share the grey one.
                </p>
              )}
            </div>
            <div className="border-t border-line xl:border-l xl:border-t-0">
              <DataTable columns={sectorColumns} rows={sectors} rowKey={(b) => b.name} defaultSort={{ key: "weight", dir: "desc" }} />
            </div>
          </Card>

          <Card
            title="Holding weights"
            description={`${top.length < holdings.length ? `Largest ${top.length} of ${holdings.length} holdings` : plural(holdings.length, "holding")}, as a share of holdings value. Select a bar to open the stock.`}
            className="lg:col-span-12 xl:col-span-6"
          >
            <BarChart
              label="Weight of each holding"
              horizontal
              valueLabels
              format="pct"
              height={Math.max(180, top.length * 28 + 16)}
              categories={topSymbols}
              series={topSeries}
              onSelect={openStock}
            />
          </Card>

          <Card title="Industry breakdown" description={`${plural(industries.length, "industry", "industries")}, as a share of holdings value.`} className="lg:col-span-12 xl:col-span-6" flush>
            <DataTable
              columns={industryColumns}
              rows={industries}
              rowKey={(b) => b.name}
              defaultSort={{ key: "weight", dir: "desc" }}
              maxHeight={Math.max(260, top.length * 28 + 40)}
            />
          </Card>
        </div>
      )}
    </Page>
  );
}

export function AllocationPage() {
  return <RequirePortfolio>{(id) => <Content id={id} />}</RequirePortfolio>;
}
