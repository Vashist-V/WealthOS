import { ArrowDown, ArrowUp, SearchX, TrendingUp } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AskBar, MarketAssistant, Scoreboard } from "@/components/assistant/MarketAssistant";
import { BarChart, MarketTreemap } from "@/components/charts";
import { bigInr, multiple, relativeVolume, signedPrice, StockCell } from "@/components/market/shared";
import { TradeCheckButton } from "@/components/QuickTradeCheck";
import {
  Button, Card, CardSkeleton, DataTable, Delta, EmptyState, ErrorState, InfoHint, Input, Meter, Page, RangeBar, Segmented, Select, Signed,
  Skeleton, Sparkline, type Column,
} from "@/components/ui";
import { compactNumber, date, number, pct, price, signedPct } from "@/lib/format";
import { useMarket, useUniverse } from "@/lib/queries";
import type { MarketIndex, MarketOverview, MarketStock, UniverseStock } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";

const RANGE_HINT = "Where the latest price sits between the 52-week low (left) and high (right).";

// ------------------------------------------------------------ index cards
function IndexCard({ index }: { index: MarketIndex }) {
  return (
    <Link
      to={symbolPath(index.symbol)}
      title={index.name}
      className="card group flex min-w-0 flex-col gap-1 px-3.5 py-3.5 transition-colors hover:border-line-strong sm:px-4"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-ink-2 transition-colors group-hover:text-accent">{index.short}</span>
        <Sparkline data={index.spark} width={64} height={24} />
      </div>
      <div className="num truncate text-[22px] font-semibold leading-7 tracking-tight text-ink">{number(index.price, 2)}</div>
      <Delta value={index.change} size="xs">
        {signedPrice(index.change, true)} ({signedPct(index.change_pct)})
      </Delta>
    </Link>
  );
}

// ---------------------------------------------------------------- breadth
function Share({ label, hint, count, total }: { label: string; hint: string; count: number; total: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="flex min-w-0 items-center gap-1.5 text-ink-2">
          <span className="truncate">{label}</span>
          <InfoHint text={hint} />
        </span>
        <span className="num shrink-0 text-muted">
          <span className="font-medium text-ink">{number(count)}</span> of {number(total)}
        </span>
      </div>
      <Meter value={count} max={Math.max(total, 1)} />
    </div>
  );
}

function Breadth({ data }: { data: MarketOverview }) {
  const b = data.breadth;
  const t = data.turnover;
  const segments = [
    { key: "up", count: b.advances, className: "bg-gain" },
    { key: "flat", count: b.unchanged, className: "bg-muted/50" },
    { key: "down", count: b.declines, className: "bg-loss" },
  ].filter((s) => s.count > 0);
  return (
    <Card title="Market breadth" description="How widely today's move is shared" className="lg:col-span-12 xl:col-span-5">
      <div className="flex items-end justify-between gap-3 text-[13px]">
        <span className="inline-flex items-center gap-1 text-ink-2">
          <ArrowUp className="size-3.5 text-gain" strokeWidth={2.4} aria-hidden />
          <span className="num text-base font-semibold text-ink">{number(b.advances)}</span> advancing
        </span>
        {b.unchanged > 0 && (
          <span className="text-xs text-muted">
            <span className="num">{number(b.unchanged)}</span> unchanged
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-ink-2">
          <span className="num text-base font-semibold text-ink">{number(b.declines)}</span> declining
          <ArrowDown className="size-3.5 text-loss" strokeWidth={2.4} aria-hidden />
        </span>
      </div>
      <div
        className={cn("mt-2 flex h-2.5 gap-0.5 overflow-hidden rounded-full", segments.length === 0 && "bg-surface-3")}
        role="img"
        aria-label={`${b.advances} advancing, ${b.unchanged} unchanged, ${b.declines} declining`}
      >
        {segments.map((s) => (
          <div key={s.key} className={cn("h-full rounded-[2px]", s.className)} style={{ flex: `${s.count} 1 0%` }} />
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-4">
        <Share
          label="Above 50-day average"
          hint="Stocks trading above their average closing price of the last 50 sessions."
          count={b.above_50dma}
          total={b.total}
        />
        <Share
          label="Above 200-day average"
          hint="Stocks trading above their average closing price of the last 200 sessions."
          count={b.above_200dma}
          total={b.total}
        />
      </div>

      <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-line pt-4">
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted">52-week highs</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-ink">{number(b.new_highs)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="truncate text-xs text-muted">52-week lows</dt>
          <dd className="num mt-0.5 text-sm font-semibold text-ink">{number(b.new_lows)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-xs text-muted">
            <span className="truncate">Turnover</span>
            <InfoHint text="Value of shares traded today in the tracked stocks, against their average over the previous 20 sessions. 1.00× means in line with that average." />
          </dt>
          <dd className="num mt-0.5 text-sm font-semibold text-ink">{t.ratio == null ? "—" : `${number(t.ratio, 2)}× avg`}</dd>
          <dd className="num truncate text-xs text-muted">{bigInr(t.today)} today</dd>
        </div>
      </dl>
      <p className="mt-4 text-xs text-muted">Based on the {number(b.total)} large and mid-cap stocks WealthOS tracks.</p>
    </Card>
  );
}

// ----------------------------------------------------------------- movers
const MOVERS = {
  gainers: { label: "Gainers", description: "Largest rises today", empty: "No tracked stock is up today.", focus: "change" },
  losers: { label: "Losers", description: "Largest falls today", empty: "No tracked stock is down today.", focus: "change" },
  most_active: { label: "Most active", description: "Highest value traded today", empty: "No trades recorded today.", focus: "value" },
  volume_shockers: { label: "Volume surges", description: "Today's volume furthest above its usual level", empty: "No unusual volume today.", focus: "relvol" },
  new_highs: { label: "52-week highs", description: "Stocks that set a new 52-week high today", empty: "No tracked stock set a new 52-week high today.", focus: "change" },
  new_lows: { label: "52-week lows", description: "Stocks that set a new 52-week low today", empty: "No tracked stock set a new 52-week low today.", focus: "change" },
} as const;
type MoverKey = keyof typeof MOVERS;
const MOVER_TABS = (Object.keys(MOVERS) as MoverKey[]).map((value) => ({ value, label: MOVERS[value].label }));

/** A header that shortens itself on phones. */
function Responsive({ short, long }: { short: string; long: string }): ReactNode {
  return (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="max-sm:hidden">{long}</span>
    </>
  );
}

function Movers({ data }: { data: MarketOverview }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<MoverKey>("gainers");
  const { description, empty, focus } = MOVERS[tab];
  // On phones there is room for one metric beside the price: keep the one this list is ranked by.
  const columns: Column<MarketStock>[] = [
    { key: "stock", header: "Stock", sort: (r) => r.symbol, cell: (r) => <StockCell symbol={r.symbol} name={r.name} /> },
    { key: "price", header: "Price", align: "right", sort: (r) => r.price, cell: (r) => <span className="text-ink">{price(r.price)}</span> },
    {
      key: "change", header: "Change", align: "right", hide: focus === "change" ? undefined : "sm", sort: (r) => r.change_pct,
      cell: (r) => <Signed value={r.change_pct} className="font-medium">{signedPct(r.change_pct)}</Signed>,
    },
    { key: "volume", header: "Volume", align: "right", hide: "xl", sort: (r) => r.volume, cell: (r) => compactNumber(r.volume) },
    {
      key: "value", header: <Responsive short="Value" long="Traded value" />, align: "right", hide: focus === "value" ? undefined : "md",
      sort: (r) => r.traded_value, cell: (r) => bigInr(r.traded_value),
    },
    {
      key: "relvol", header: <Responsive short="Rel. vol" long="Relative volume" />, align: "right", hide: focus === "relvol" ? undefined : "sm",
      sort: (r) => r.relative_volume, cell: (r) => relativeVolume(r.relative_volume),
    },
    {
      key: "range", header: "52-week range", hide: "xl", width: "150px", hint: RANGE_HINT,
      cell: (r) => <RangeBar low={r.low_52w} high={r.high_52w} value={r.price} />,
    },
  ];
  return (
    <Card
      title="Movers"
      description={`${description}. Relative volume compares today's volume with the average of the previous 20 sessions.`}
      className="lg:col-span-12"
      flush
    >
      <div className="overflow-x-auto px-4 pb-3 sm:px-5">
        <Segmented label="Movers list" value={tab} onChange={setTab} options={MOVER_TABS} className="whitespace-nowrap" />
      </div>
      <DataTable
        key={tab}
        columns={columns}
        rows={data[tab]}
        rowKey={(r) => r.symbol}
        onRowClick={(r) => navigate(symbolPath(r.symbol))}
        empty={<EmptyState icon={<TrendingUp />} title="Nothing on this list today" description={empty} className="py-10" />}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- indices
/** An index the data source sent a single bar for: there is a level, but no change or range to show. */
const thin = (index: MarketIndex) => index.spark.length < 2;

function IndexTable({ indices }: { indices: MarketIndex[] }) {
  const navigate = useNavigate();
  const period = (key: keyof MarketIndex["returns"], hide: Column<MarketIndex>["hide"]): Column<MarketIndex> => ({
    key,
    header: key,
    align: "right",
    hide,
    sort: (r) => r.returns[key],
    cell: (r) => <Signed value={r.returns[key]}>{signedPct(r.returns[key])}</Signed>,
  });
  const columns: Column<MarketIndex>[] = [
    {
      key: "name", header: "Index", sort: (r) => r.name,
      cell: (r) => (
        <Link
          to={symbolPath(r.symbol)}
          onClick={(e) => e.stopPropagation()}
          className="block max-w-28 truncate font-medium text-ink transition-colors hover:text-accent sm:max-w-56"
        >
          {r.name}
        </Link>
      ),
    },
    { key: "level", header: "Level", align: "right", sort: (r) => r.price, cell: (r) => <span className="text-ink">{number(r.price, 2)}</span> },
    {
      key: "today", header: "Today", align: "right", sort: (r) => (thin(r) ? null : r.change_pct),
      cell: (r) => (thin(r) ? <span className="text-muted">—</span> : <Signed value={r.change_pct} className="font-medium">{signedPct(r.change_pct)}</Signed>),
    },
    period("1W", "xl"),
    period("1M", "sm"),
    period("3M", "xl"),
    period("YTD", "md"),
    period("1Y", "sm"),
    {
      key: "range", header: "52-week range", hide: "xl", width: "150px", hint: "Where the latest level sits between the 52-week low (left) and high (right).",
      cell: (r) => (thin(r) ? <span className="text-muted">—</span> : <RangeBar low={r.low_52w} high={r.high_52w} value={r.price} />),
    },
  ];
  const missing = indices.filter(thin).length;
  return (
    <Card title="Index performance" description="Change in each index today, over the past week, month, quarter and year, and since 1 January (YTD)" className="lg:col-span-12" flush>
      <DataTable columns={columns} rows={indices} rowKey={(r) => r.symbol} onRowClick={(r) => navigate(symbolPath(r.symbol))} dense />
      {missing > 0 && (
        <p className="border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
          The data source returned no price history for {number(missing)} {missing === 1 ? "index" : "indices"}, so only the latest level is shown for {missing === 1 ? "it" : "them"}.
        </p>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- universe
function Universe() {
  const navigate = useNavigate();
  const universe = useUniverse();
  const [text, setText] = useState("");
  const [sector, setSector] = useState("");
  const stocks = universe.data?.stocks;
  const sectors = useMemo(() => [...new Set((stocks ?? []).map((s) => s.sector))].sort((a, b) => a.localeCompare(b)), [stocks]);
  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (stocks ?? []).filter((s) => (!sector || s.sector === sector) && (!q || s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
  }, [stocks, text, sector]);

  const columns: Column<UniverseStock>[] = [
    { key: "stock", header: "Stock", sort: (r) => r.symbol, cell: (r) => <StockCell symbol={r.symbol} name={r.name} /> },
    { key: "sector", header: "Sector", hide: "md", sort: (r) => r.sector, cell: (r) => r.sector },
    { key: "price", header: "Price", align: "right", sort: (r) => r.price, cell: (r) => <span className="text-ink">{price(r.price)}</span> },
    {
      key: "change", header: "Change", align: "right", sort: (r) => r.change_pct,
      cell: (r) => <Signed value={r.change_pct} className="font-medium">{signedPct(r.change_pct)}</Signed>,
    },
    {
      key: "cap", header: "Market cap", align: "right", hide: "sm", sort: (r) => r.market_cap, cell: (r) => bigInr(r.market_cap),
      hint: "Share price multiplied by the number of shares: the market value of the whole company.",
    },
    {
      key: "pe", header: "P/E", align: "right", hide: "xl", sort: (r) => r.pe, cell: (r) => multiple(r.pe),
      hint: "Price divided by earnings per share over the past 12 months.",
    },
    {
      key: "pb", header: "P/B", align: "right", hide: "xl", sort: (r) => r.pb, cell: (r) => multiple(r.pb),
      hint: "Price divided by book value (net assets) per share.",
    },
    {
      key: "yield", header: "Div. yield", align: "right", hide: "xl", sort: (r) => r.dividend_yield, cell: (r) => pct(r.dividend_yield),
      hint: "Dividends paid over the past 12 months as a share of the latest price.",
    },
    {
      key: "range", header: "52-week range", hide: "2xl", width: "110px", hint: RANGE_HINT,
      cell: (r) => <RangeBar low={r.low_52w} high={r.high_52w} value={r.price} />,
    },
  ];

  const filtered = !!text.trim() || !!sector;
  return (
    <Card
      title="All tracked stocks"
      description={stocks ? (filtered ? `${number(rows.length)} of ${number(stocks.length)} shown` : `${number(stocks.length)} stocks, ETFs and funds`) : undefined}
      className="lg:col-span-12"
      flush
    >
      {!stocks && universe.isError ? (
        <ErrorState error={universe.error} onRetry={() => universe.refetch()} />
      ) : !stocks ? (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5">
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="mt-3 h-80 w-full" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
            <div className="min-w-40 flex-1 sm:max-w-64">
              <Input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by name or symbol" aria-label="Filter by name or symbol" />
            </div>
            <div className="min-w-36 max-sm:flex-1 sm:w-52">
              <Select value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector">
                <option value="">All sectors</option>
                {sectors.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.symbol}
            defaultSort={{ key: "cap", dir: "desc" }}
            onRowClick={(r) => navigate(symbolPath(r.symbol))}
            maxHeight={640}
            empty={
              <EmptyState
                icon={<SearchX />}
                title="No stocks match these filters"
                description="Try a shorter search or a different sector. Stocks outside this list can still be found from the search bar at the top."
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setText("");
                      setSector("");
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            }
          />
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------- page
export function MarketPage() {
  const navigate = useNavigate();
  const market = useMarket();
  const data = market.data;
  const headline = useMemo(() => (data?.indices ?? []).filter((i) => i.headline), [data]);
  const sectors = useMemo(
    () => ({
      categories: (data?.sectors ?? []).map((s) => s.name),
      series: [{ name: "Average move", data: (data?.sectors ?? []).map((s) => s.change_pct) }],
    }),
    [data],
  );

  if (market.isError && !data) {
    return (
      <Page title="Market">
        <Card>
          <ErrorState error={market.error} onRetry={() => market.refetch()} />
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Market"
      description={
        data ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            <span className={cn("size-2 rounded-full", data.status.is_open ? "bg-gain" : "bg-muted")} aria-hidden />
            NSE {data.status.label.toLowerCase()} · {data.status.detail}
            {data.as_of && ` · prices as of ${date(data.as_of)}`}
          </span>
        ) : (
          "Indices, breadth, sectors and movers across the stocks WealthOS tracks."
        )
      }
      actions={<TradeCheckButton />}
    >
      {!data ? (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:col-span-12 2xl:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-[106px] rounded-[14px]" />
            ))}
          </div>
          <CardSkeleton height={300} className="lg:col-span-12 xl:col-span-5" />
          <CardSkeleton height={300} className="lg:col-span-12 xl:col-span-7" />
          <CardSkeleton height={320} className="lg:col-span-12" />
        </div>
      ) : (
        <MarketAssistant>
        <div className="grid gap-4 lg:grid-cols-12">
          <AskBar className="lg:col-span-12" />

          {headline.length > 0 && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:col-span-12 2xl:grid-cols-6">
              {headline.map((index) => (
                <IndexCard key={index.symbol} index={index} />
              ))}
            </div>
          )}

          <Scoreboard className="lg:col-span-12" />

          <Breadth data={data} />

          <Card title="Sector performance" description="Average move today of the tracked stocks in each sector" className="lg:col-span-12 xl:col-span-7">
            {sectors.categories.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-muted">Sector moves appear once today's prices are in.</p>
            ) : (
              <BarChart
                label="Average move today by sector"
                horizontal
                signed
                valueLabels
                format="signedPct"
                height={Math.max(220, sectors.categories.length * 27)}
                categories={sectors.categories}
                series={sectors.series}
              />
            )}
          </Card>

          <Movers data={data} />
          <IndexTable indices={data.indices} />

          <Card
            title="Market map"
            description="Tile area reflects company size; colour shows today's move. Select a tile to open the stock."
            className="lg:col-span-12"
          >
            {data.heatmap.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-muted">The map appears once today's prices are in.</p>
            ) : (
              <MarketTreemap label="Tracked stocks by company size and today's move" items={data.heatmap} onSelect={(symbol) => navigate(symbolPath(symbol))} />
            )}
          </Card>

          <Universe />
        </div>
        </MarketAssistant>
      )}
    </Page>
  );
}
