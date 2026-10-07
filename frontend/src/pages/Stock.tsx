import { ArrowLeft, BellPlus, ClipboardCheck, ExternalLink, Plus } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { StockAssistant } from "@/components/assistant/StockAssistant";
import { AlertDialog } from "@/components/forms/AlertDialog";
import { useAppActions } from "@/components/layout/AppShell";
import { bigInr, level, multiple } from "@/components/market/shared";
import { CorporateActionsCard } from "@/components/market/StockEvents";
import { FinancialsCard } from "@/components/market/StockFinancials";
import { PriceCard } from "@/components/market/StockPriceCard";
import { WatchlistMenu } from "@/components/market/WatchlistMenu";
import { Badge, Button, Card, CardSkeleton, ErrorState, InfoHint, KeyValue, Page, RangeBar, Signed } from "@/components/ui";
import { PnlDelta } from "@/components/widgets";
import { ApiError } from "@/lib/api";
import { compactNumber, duration, inr, number, price, quantity, ratioPct, signedRatioPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useFinancials, useStock } from "@/lib/queries";
import type { Financials, StockDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

// --------------------------------------------------------- key statistics
interface Stat {
  label: string;
  value: ReactNode;
  hint?: string;
  /** False when the data source has no figure; such rows are dropped for indices and funds. */
  has: boolean;
}

const present = (v: number | null | undefined): v is number => v !== null && v !== undefined && !Number.isNaN(v);

function keyStats(d: StockDetail, ratios: Financials["ratios"] | undefined): Stat[] {
  const q = d.quote;
  const f = d.fundamentals;
  const t = d.technicals;
  const px = (v: number | null | undefined) => level(v, d.is_index);
  // Yahoo's own ratios come first; otherwise use the ones derived from the latest annual statements.
  const roe = f.roe ?? ratios?.roe;
  const roce = ratios?.roce;
  const debtToEquity = f.debt_to_equity ?? ratios?.debt_to_equity;
  const growth = (v: number | null) => (present(v) ? <Signed value={v}>{signedRatioPct(v, 1)}</Signed> : "—");

  const trading: Stat[] = [
    { label: "Open", value: px(q.open), has: present(q.open) },
    { label: "Day high", value: px(q.high), has: present(q.high) },
    { label: "Day low", value: px(q.low), has: present(q.low) },
    { label: "Previous close", value: px(q.prev_close), has: present(q.prev_close), hint: "The closing price of the session before. Today's change is measured from it." },
    { label: "Volume", value: compactNumber(q.volume), has: q.volume > 0, hint: "Shares traded in the latest session." },
    { label: "Average volume", value: compactNumber(q.avg_volume), has: q.volume > 0 && q.avg_volume > 0, hint: "Average shares traded per day over the previous 20 sessions." },
    { label: "52-week high", value: px(q.high_52w), has: present(q.high_52w), hint: "The highest traded price in the past year." },
    { label: "52-week low", value: px(q.low_52w), has: present(q.low_52w), hint: "The lowest traded price in the past year." },
    {
      label: "52-week position",
      has: q.high_52w > q.low_52w,
      hint: "Where the latest price sits between the 52-week low (left) and high (right).",
      value: (
        <div className="flex h-5 items-center px-1.5">
          <RangeBar low={q.low_52w} high={q.high_52w} value={q.price} />
        </div>
      ),
    },
  ];
  const valuation: Stat[] = [
    { label: "Market cap", value: bigInr(f.market_cap), has: present(f.market_cap), hint: "Share price multiplied by the number of shares: the market value of the whole company." },
    { label: "P/E", value: multiple(f.pe), has: present(f.pe), hint: "Price divided by earnings per share over the past 12 months: the rupees paid for each rupee of yearly profit." },
    { label: "Forward P/E", value: multiple(f.forward_pe), has: present(f.forward_pe), hint: "Price divided by the earnings per share analysts expect over the next year." },
    { label: "P/B", value: multiple(f.pb), has: present(f.pb), hint: "Price divided by book value per share. 1.0 means the price equals the net assets behind each share." },
    { label: "EPS", value: price(f.eps), has: present(f.eps), hint: "Earnings per share: net profit over the past 12 months divided by the number of shares." },
    { label: "Book value", value: price(f.book_value), has: present(f.book_value), hint: "Net assets (what the company owns minus what it owes) per share." },
    { label: "ROE", value: ratioPct(roe, 1), has: present(roe), hint: "Return on equity: a year's net profit as a share of shareholders' equity." },
    { label: "ROCE", value: ratioPct(roce, 1), has: present(roce), hint: "Return on capital employed: operating profit as a share of total assets less current liabilities, from the latest annual statements." },
    { label: "Debt / equity", value: number(debtToEquity, 2), has: present(debtToEquity), hint: "Total debt divided by shareholders' equity. 1.00 means the company owes as much as its shareholders own." },
    { label: "Dividend yield", value: ratioPct(f.dividend_yield), has: f.dividend_per_share > 0, hint: "Dividends paid over the past 12 months as a share of the latest price." },
    { label: "Dividend per share", value: price(f.dividend_per_share), has: f.dividend_per_share > 0, hint: "Total dividends paid on each share over the past 12 months." },
  ];
  const technical: Stat[] = [
    { label: "Beta", value: number(t.beta, 2), has: present(t.beta), hint: "How far the price has moved for each 1% move in the benchmark index over the past year. 1.00 means in step with it." },
    { label: "Volatility", value: ratioPct(t.volatility, 1), has: present(t.volatility), hint: "The yearly swing implied by a year of daily returns. A higher figure means larger day-to-day moves." },
    { label: "50-day average", value: px(t.sma_50), has: present(t.sma_50), hint: "Average closing price over the last 50 sessions." },
    { label: "200-day average", value: px(t.sma_200), has: present(t.sma_200), hint: "Average closing price over the last 200 sessions." },
  ];
  const business: Stat[] = [
    { label: "Profit margin", value: ratioPct(f.profit_margin, 1), has: present(f.profit_margin), hint: "Net profit as a share of revenue." },
    { label: "Operating margin", value: ratioPct(f.operating_margin, 1), has: present(f.operating_margin), hint: "Operating profit as a share of revenue, before interest and tax." },
    { label: "Revenue growth", value: growth(f.revenue_growth), has: present(f.revenue_growth), hint: "Latest reported revenue against the same period a year earlier." },
    { label: "Earnings growth", value: growth(f.earnings_growth), has: present(f.earnings_growth), hint: "Latest reported earnings against the same period a year earlier." },
  ];

  // A company always shows the full set, with a dash while fundamentals warm up. Indices and funds only show what applies.
  if (d.asset_class === "Equity" && !d.is_index) return [...trading, ...valuation, ...technical, ...business];
  return [...trading, ...(d.is_index ? [] : valuation), ...technical].filter((s) => s.has);
}

// ---------------------------------------------------------------- position
function Position({ d }: { d: StockDetail }) {
  const p = d.position;
  if (!p) return null;
  // P&L carries an amount and a percentage, so it gets a double-width cell where columns are narrow.
  const items: { label: string; value: ReactNode; hint?: string; wide?: boolean }[] = [
    { label: "Quantity", value: quantity(p.quantity) },
    { label: "Average cost", value: price(p.avg_cost), hint: "What each share you hold cost on average, including fees." },
    { label: "Invested", value: inr(p.invested) },
    { label: "Current value", value: inr(p.value) },
    { label: "Unrealised P&L", value: <PnlDelta amount={p.pnl} percent={p.pnl_pct} />, hint: "Current value minus what you invested. Not yet locked in.", wide: true },
    { label: "Held for", value: duration(p.holding_days), hint: "Average age of the shares you hold, weighted by quantity." },
  ];
  return (
    <Card
      tour="stock-position"
      title="Your position"
      description="Combined across your investment portfolios"
      className="lg:col-span-12"
      action={
        <Link to="/holdings" className="text-xs font-medium text-accent hover:underline">
          All holdings
        </Link>
      }
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {items.map((item) => (
          <div key={item.label} className={cn("min-w-0", item.wide && "col-span-2 sm:col-span-1 lg:col-span-2")}>
            <dt className="flex items-center gap-1 text-xs text-muted">
              <span className="truncate">{item.label}</span>
              {item.hint && <InfoHint text={item.hint} />}
            </dt>
            <dd className="num mt-0.5 truncate text-sm font-medium text-ink">{item.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// ------------------------------------------------------------------- about
function About({ d }: { d: StockDetail }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const text = useRef<HTMLParagraphElement>(null);
  const a = d.about;

  // Offer "Show more" only when the summary really is cut off at this card width.
  useEffect(() => {
    const el = text.current;
    if (!el || open) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, a.summary]);

  const site = a.website && /^https?:\/\//i.test(a.website) ? a.website : null;
  const facts: { label: string; value: ReactNode }[] = [];
  if (site) {
    facts.push({
      label: "Website",
      value: (
        <a href={site} target="_blank" rel="noreferrer noopener" className="inline-flex max-w-full items-center gap-1 text-accent hover:underline">
          <span className="truncate">{site.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
        </a>
      ),
    });
  }
  if (a.employees) facts.push({ label: "Employees", value: number(a.employees) });
  if (a.city) facts.push({ label: "Headquarters", value: a.city });

  return (
    <Card title={`About ${d.name}`}>
      {a.summary && (
        <>
          <p ref={text} className={cn("text-[13px] leading-relaxed text-ink-2", !open && "line-clamp-5")}>
            {a.summary}
          </p>
          {(clamped || open) && (
            <button type="button" aria-expanded={open} className="mt-1.5 text-xs font-medium text-accent hover:underline" onClick={() => setOpen((v) => !v)}>
              {open ? "Show less" : "Show more"}
            </button>
          )}
        </>
      )}
      {facts.length > 0 && <KeyValue items={facts} columns={1} className={cn(a.summary && "mt-4 border-t border-line pt-4")} />}
    </Card>
  );
}

// -------------------------------------------------------------------- page
function BackLink() {
  const navigate = useNavigate();
  // React Router numbers history entries; anything above zero means there is an in-app page to return to.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  const back = (e: MouseEvent) => {
    if (!canGoBack) return;
    e.preventDefault();
    navigate(-1);
  };
  return (
    <Link
      to="/market"
      onClick={back}
      className="mb-2 flex w-fit items-center gap-1 text-[13px] font-normal tracking-normal text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft className="size-3.5" aria-hidden />
      {canGoBack ? "Back" : "Market"}
    </Link>
  );
}

function Loaded({ d }: { d: StockDetail }) {
  const actions = useAppActions();
  const navigate = useNavigate();
  const { investment } = usePortfolio();
  const [alertOpen, setAlertOpen] = useState(false);
  const financials = useFinancials(d.symbol, !d.is_index);

  const tags = d.is_index ? ["Index"] : [...new Set([d.sector, d.industry, d.asset_class === "Equity" ? "" : d.asset_class].filter(Boolean))];
  const stats = keyStats(d, financials.data?.ratios);
  const hasAbout = !!(d.about.summary || d.about.website || d.about.employees || d.about.city);
  const lastPrice = Math.round(d.quote.price * 100) / 100;

  return (
    <Page
      eyebrow={<BackLink />}
      title={d.name}
      description={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="font-medium text-ink-2">{d.symbol}</span>
          {tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </span>
      }
      actions={
        <>
          <StockAssistant symbol={d.symbol} name={d.name} />
          {!d.is_index && (
            <Button data-tour="check-trade" icon={<ClipboardCheck className="size-4" />} onClick={() => navigate(`/lab/trade-check?symbol=${encodeURIComponent(d.symbol)}`)}>
              Check a trade
            </Button>
          )}
          <WatchlistMenu symbol={d.symbol} />
          <Button data-tour="set-alert" icon={<BellPlus className="size-4" />} onClick={() => setAlertOpen(true)}>
            Set alert
          </Button>
          {!d.is_index && investment.length > 0 && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction({ symbol: d.symbol, price: lastPrice })}>
              Add transaction
            </Button>
          )}
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-12">
        <PriceCard symbol={d.symbol} detail={d} className="lg:col-span-12" />
        <Position d={d} />

        {d.is_index ? (
          <Card title="Key statistics" className="lg:col-span-12">
            <KeyValue items={stats} columns={4} />
          </Card>
        ) : (
          <>
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-12 xl:col-span-8">
              <Card tour="stock-stats" title="Key statistics" description={financials.isFetching && !financials.data ? "Loading ratios from the latest statements…" : undefined}>
                <KeyValue items={stats} columns={4} />
              </Card>
              <FinancialsCard symbol={d.symbol} />
            </div>
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-12 xl:col-span-4">
              <CorporateActionsCard symbol={d.symbol} />
              {hasAbout && <About d={d} />}
            </div>
          </>
        )}
      </div>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen} symbol={d.symbol} price={lastPrice} />
    </Page>
  );
}

function StockView({ symbol }: { symbol: string }) {
  const stock = useStock(symbol);

  if (stock.data) return <Loaded d={stock.data} />;

  if (stock.isError) {
    const unknown = stock.error instanceof ApiError && stock.error.status === 404;
    return (
      <Page title={symbol.toUpperCase()} description={unknown ? "WealthOS has no market data for this symbol." : undefined}>
        <Card>
          <ErrorState error={stock.error} onRetry={unknown ? undefined : () => stock.refetch()} className="pb-5" />
          <div className="flex justify-center pb-12">
            <Link to="/market">
              <Button variant={unknown ? "primary" : "secondary"} icon={<ArrowLeft className="size-4" />}>
                Back to Market
              </Button>
            </Link>
          </div>
        </Card>
      </Page>
    );
  }

  return (
    <Page title={symbol.toUpperCase()}>
      <div className="grid gap-4 lg:grid-cols-12">
        <CardSkeleton height={420} className="lg:col-span-12" />
        <CardSkeleton height={280} className="lg:col-span-12 xl:col-span-8" />
        <CardSkeleton height={280} className="lg:col-span-12 xl:col-span-4" />
      </div>
    </Page>
  );
}

export function StockPage() {
  const { symbol = "" } = useParams<{ symbol: string }>();
  // Keyed by symbol so chart range, tabs and dialogs reset when moving from one stock to another.
  return <StockView key={symbol} symbol={symbol} />;
}
