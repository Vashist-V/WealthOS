import { CalendarDays, Coins, NotebookPen } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BarChart } from "@/components/charts";
import {
  Badge, Button, Card, CardSkeleton, DataTable, EmptyState, ErrorState, InfoHint, Meter, Page, Skeleton, StatTile, SymbolCell, type Column,
} from "@/components/ui";
import { RequirePortfolio } from "@/components/widgets";
import { date, inr, monthYear, number, pct, price, quantity, todayIso } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useDividends } from "@/lib/queries";
import type { DividendReport } from "@/lib/types";

type Company = DividendReport["companies"][number];
type Payout = DividendReport["events"][number];

const ESTIMATE_NOTE =
  "Each declared dividend per share is multiplied by the shares held going into its ex-dividend date. The amount actually credited can differ: entitlement is fixed on the record date, and tax may be deducted at source before the money arrives.";
const FIRST_PAGE = 10;
const PAGE_STEP = 25;

// ------------------------------------------------------------------ tiles
function Tiles({ data }: { data: DividendReport }) {
  const first = data.events.reduce<string | null>((min, e) => (min === null || e.ex_date < min ? e.ex_date : min), null);
  const count = data.events.length;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <StatTile
        className="col-span-2 xl:col-span-1"
        label="Total received"
        value={inr(data.total)}
        sub={first ? `${number(count)} payout${count === 1 ? "" : "s"} since ${date(first)}` : "No payouts yet"}
        hint="Estimated dividends since the first transaction, counting the shares held at each ex-dividend date."
      />
      <StatTile
        label="Last 12 months"
        value={inr(data.trailing_12m)}
        sub={`${inr(data.trailing_12m / 12)} a month on average`}
        hint="Estimated dividends with an ex-dividend date in the past 365 days."
      />
      <StatTile
        label="Forward income"
        value={inr(data.forward_income)}
        sub="A year at trailing payout rates"
        hint="Forward annual income: what today's shares would pay in a year if every company repeated its last twelve months of dividends per share. It extends past payouts; it is not a forecast."
      />
      <StatTile
        label="Dividend yield"
        value={pct(data.portfolio_yield)}
        sub="Forward income ÷ current value"
        hint="Forward annual income as a share of the current value of the holdings."
      />
      <StatTile
        label="Yield on cost"
        value={pct(data.yield_on_cost)}
        sub="Forward income ÷ amount invested"
        hint="Forward annual income as a share of what the current holdings cost to buy."
      />
    </div>
  );
}

// ----------------------------------------------------------------- charts
function Charts({ data }: { data: DividendReport }) {
  const today = todayIso();
  const thisYear = today.slice(0, 4);
  const years = useMemo(
    () => ({ categories: data.by_year.map((y) => y.year), series: [{ name: "Estimated income", data: data.by_year.map((y) => y.amount) }] }),
    [data.by_year],
  );
  const months = useMemo(() => {
    const [year, month] = today.split("-").map(Number);
    const amounts = new Map(data.by_month.map((m) => [m.month, m.amount]));
    const window = Array.from({ length: 24 }, (_, i) => {
      const when = new Date(year, month - 24 + i, 1);
      return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;
    });
    return {
      categories: window.map((key) => monthYear(`${key}-01`)),
      series: [{ name: "Estimated income", data: window.map((key) => amounts.get(key) ?? 0) }],
    };
  }, [data.by_month, today]);
  const partial = data.by_year.some((y) => y.year === thisYear);

  return (
    <>
      <Card title="Income by year" description={`By ex-dividend date.${partial ? ` ${thisYear} is the year so far.` : ""}`} className="lg:col-span-4">
        <BarChart label="Estimated dividend income by year" categories={years.categories} series={years.series} format="inr" valueLabels height={260} />
      </Card>
      <Card title="Income by month" description="The last 24 months, by ex-dividend date." className="lg:col-span-8">
        <BarChart label="Estimated dividend income by month over the last 24 months" categories={months.categories} series={months.series} format="inr" height={260} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------- by company
function Companies({ rows }: { rows: Company[] }) {
  const max = Math.max(...rows.map((r) => r.received), 1);
  const sold = rows.filter((r) => !r.held).length;
  const columns: Column<Company>[] = [
    {
      key: "symbol", header: "Company", sort: (r) => r.symbol,
      cell: (r) => (
        <div className="w-24 sm:w-44">
          <SymbolCell
            symbol={r.symbol}
            sub={r.held ? r.name : <><Badge className="mr-1.5 align-middle">No longer held</Badge>{r.name}</>}
          />
        </div>
      ),
    },
    {
      key: "received", header: "Received", align: "right", sort: (r) => r.received,
      cell: (r) => (
        <div className="ml-auto flex w-20 flex-col items-end gap-1.5">
          <span className="font-medium text-ink">{inr(r.received)}</span>
          <Meter value={r.received} max={max} />
        </div>
      ),
    },
    {
      key: "dps", header: "Per share, 12 months", align: "right", hide: "xl", sort: (r) => r.trailing_dps,
      hint: "Dividends declared per share over the last twelve months.",
      cell: (r) => price(r.trailing_dps),
    },
    {
      key: "forward", header: "Forward income", align: "right", hide: "sm", sort: (r) => r.forward_income,
      hint: "Shares held today × trailing twelve-month dividend per share.",
      cell: (r) => (r.held ? inr(r.forward_income) : "—"),
    },
    {
      key: "yield", header: "Yield", align: "right", sort: (r) => r.yield,
      hint: "Trailing twelve-month dividend per share as a share of the current price.",
      cell: (r) => pct(r.yield),
    },
    {
      key: "yoc", header: "Yield on cost", align: "right", hide: "md", sort: (r) => r.yield_on_cost,
      hint: "Forward income as a share of what the shares held today cost.",
      cell: (r) => pct(r.yield_on_cost),
    },
  ];
  return (
    <Card
      title="By company"
      description={`${rows.length} compan${rows.length === 1 ? "y" : "ies"} with dividend income${sold ? `, ${sold} no longer held` : ""}. Received to date is an estimate.`}
      className="lg:col-span-12"
      flush
    >
      <DataTable columns={columns} rows={rows} rowKey={(r) => r.symbol} defaultSort={{ key: "received", dir: "desc" }} />
    </Card>
  );
}

// ---------------------------------------------------------------- history
function History({ events }: { events: Payout[] }) {
  const [shown, setShown] = useState(FIRST_PAGE);
  const rows = useMemo(() => events.slice(0, shown), [events, shown]);
  const remaining = events.length - rows.length;
  const columns: Column<Payout>[] = [
    { key: "date", header: "Ex-date", cell: (r) => <span className="num whitespace-nowrap text-ink">{date(r.ex_date)}</span> },
    {
      key: "symbol", header: "Company",
      cell: (r) => (
        <div className="w-24 sm:w-48">
          <SymbolCell symbol={r.symbol} name={r.name} />
        </div>
      ),
    },
    { key: "per_share", header: "Per share", align: "right", hide: "sm", cell: (r) => price(r.per_share) },
    { key: "quantity", header: "Shares held", align: "right", hide: "sm", cell: (r) => quantity(r.quantity) },
    { key: "amount", header: "Amount", align: "right", cell: (r) => <span className="font-medium text-ink">{price(r.amount)}</span> },
  ];
  return (
    <Card title="Dividend history" description="Every ex-dividend date on which shares were held, newest first. Amounts are estimates before tax." className="lg:col-span-12" flush>
      <DataTable columns={columns} rows={rows} rowKey={(r, i) => `${r.symbol}-${r.ex_date}-${i}`} />
      {events.length > FIRST_PAGE && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-3 sm:px-5">
          <span className="num text-[13px] text-muted">Showing {number(rows.length)} of {number(events.length)} payouts</span>
          <div className="flex items-center gap-2">
            {remaining > 0 ? (
              <>
                <Button size="sm" onClick={() => setShown((n) => n + PAGE_STEP)}>Show {number(Math.min(PAGE_STEP, remaining))} more</Button>
                {remaining > PAGE_STEP && <Button size="sm" variant="ghost" onClick={() => setShown(events.length)}>Show all</Button>}
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setShown(FIRST_PAGE)}>Show fewer</Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------- page
function Content({ id }: { id: string }) {
  const { name } = usePortfolio();
  const dividends = useDividends(id);
  const data = dividends.data;
  const none = !!data && data.events.length === 0;
  const nothing = !!data && data.events.length === 0 && data.forward_income <= 0 && data.companies.length === 0;
  const calendar = (
    <Link to="/calendar">
      <Button icon={<CalendarDays className="size-4" />}>Open calendar</Button>
    </Link>
  );

  return (
    <Page
      title={
        <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
          Dividends
          <Badge>Estimated</Badge>
        </span>
      }
      description={
        <>
          Income estimated from the shares {name || "the portfolio"} held on each ex-dividend date, using market dividend data. Actual credits can differ because of record dates and tax deducted at source.
          <span className="ml-1.5 inline-flex align-[-2px]"><InfoHint text={ESTIMATE_NOTE} /></span>
        </>
      }
    >
      {dividends.isError ? (
        <Card><ErrorState error={dividends.error} onRetry={() => dividends.refetch()} /></Card>
      ) : !data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className={i === 0 ? "col-span-2 h-[92px] xl:col-span-1" : "h-[92px]"} />)}
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-12">
            <CardSkeleton className="lg:col-span-4" />
            <CardSkeleton className="lg:col-span-8" />
            <CardSkeleton height={320} className="lg:col-span-12" />
          </div>
        </>
      ) : nothing ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<Coins />}
            title="No dividend income yet"
            description={`No company has gone ex-dividend while ${name || "this portfolio"} held its shares, and none of the current holdings paid a dividend in the last twelve months. The calendar lists upcoming ex-dividend dates.`}
            action={calendar}
          />
        </Card>
      ) : (
        <>
          <Tiles data={data} />
          {data.recorded > 0 && (
            <p className="mt-3 flex items-start gap-2.5 rounded-[10px] bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2 ring-1 ring-inset ring-line">
              <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
              <span>
                The ledger also holds <span className="num font-medium text-ink">{inr(data.recorded)}</span> of dividends recorded by hand. Those are the amounts as entered; the estimates on this page are worked out
                separately from market data and do not include them.{" "}
                <Link to="/transactions" className="font-medium text-accent hover:underline">View transactions</Link>
              </span>
            </p>
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-12">
            {none ? (
              <Card className="lg:col-span-12">
                <EmptyState
                  icon={<Coins />}
                  title="No dividends received yet"
                  description="None of the holdings has gone ex-dividend since it was bought. The forward figures show what today's shares would pay in a year at trailing payout rates."
                  action={calendar}
                />
              </Card>
            ) : (
              <Charts data={data} />
            )}
            {data.companies.length > 0 && <Companies rows={data.companies} />}
            {!none && <History events={data.events} />}
          </div>
        </>
      )}
    </Page>
  );
}

export function DividendsPage() {
  return <RequirePortfolio>{(id) => <Content id={id} />}</RequirePortfolio>;
}
