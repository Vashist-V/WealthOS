/**
 * Companies side by side, on the same questions the stock page asks of one.
 *
 * The companies compared live in the address (?symbols=TCS,INFY), so a
 * comparison can be linked to, bookmarked and stepped back out of.
 */
import { Scale, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { ScenarioNote } from "@/components/lab/shared";
import { bigInr, multiple } from "@/components/market/shared";
import { TradeCheckButton } from "@/components/QuickTradeCheck";
import { ScorePill, VerdictMark } from "@/components/score";
import { Button, Card, CardSkeleton, EmptyState, ErrorState, Page, Signed } from "@/components/ui";
import { date, number, price, ratioPct, signedPct, signedRatioPct } from "@/lib/format";
import { useStockComparison } from "@/lib/queries";
import type { CompanyCard } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";

const MAX = 4;
/** Pairs in the same line of business, to start from. */
const STARTERS: [string, string][] = [["HDFCBANK", "ICICIBANK"], ["TCS", "INFY"], ["HINDUNILVR", "ITC"]];

const has = (v: number | null | undefined): v is number => v !== null && v !== undefined && !Number.isNaN(v);

/** The plain figures under the verdicts, for anyone who wants the numbers themselves. */
const FIGURES: { label: string; hint: string; show: (c: CompanyCard) => ReactNode }[] = [
  { label: "Market value", hint: "Share price times the number of shares: what the whole company is valued at.", show: (c) => bigInr(c.figures.market_cap) },
  { label: "P/E", hint: "Rupees paid for each rupee of yearly profit.", show: (c) => multiple(c.figures.pe) },
  { label: "Return on equity", hint: "A year's profit as a share of shareholders' money.", show: (c) => ratioPct(c.figures.roe, 1) },
  { label: "Profit margin", hint: "The part of each rupee of sales kept as profit.", show: (c) => ratioPct(c.figures.profit_margin, 1) },
  { label: "Sales growth", hint: "Sales against the same quarter a year earlier.", show: (c) => (has(c.figures.revenue_growth) ? <Signed value={c.figures.revenue_growth}>{signedRatioPct(c.figures.revenue_growth, 1)}</Signed> : "—") },
  { label: "Profit growth", hint: "Profit against the same quarter a year earlier.", show: (c) => (has(c.figures.earnings_growth) ? <Signed value={c.figures.earnings_growth}>{signedRatioPct(c.figures.earnings_growth, 1)}</Signed> : "—") },
  { label: "Debt / equity", hint: "Borrowings divided by shareholders' money. Not comparable for banks and lenders.", show: (c) => number(c.figures.debt_to_equity, 2) },
  { label: "Dividend yield", hint: "Dividends over the past year as a share of today's price.", show: (c) => (c.figures.dividend_yield ? ratioPct(c.figures.dividend_yield, 1) : "None") },
  { label: "Yearly swing", hint: "Volatility: how widely the price has moved over the past year.", show: (c) => ratioPct(c.figures.volatility, 0) },
  { label: "Past year", hint: "The change in price over the past year.", show: (c) => (has(c.figures.return_1y) ? <Signed value={c.figures.return_1y}>{signedPct(c.figures.return_1y, 1)}</Signed> : "—") },
  { label: "From its 1-year high", hint: "How far the price sits below the highest of the past year.", show: (c) => (has(c.figures.from_high) ? signedPct(c.figures.from_high, 1) : "—") },
];

const HEAD = "sticky left-0 z-[1] bg-surface py-2.5 pl-4 pr-2 text-left align-top font-normal sm:pl-5 sm:pr-3";
const CELL = "px-2 py-2.5 align-top sm:px-3";

function Table({ companies, areas, onRemove }: { companies: CompanyCard[]; areas: { id: string; question: string; title: string }[]; onRemove: (symbol: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[calc(104px+var(--n)*124px)] table-fixed border-separate border-spacing-0 text-[13px] sm:min-w-[calc(210px+var(--n)*170px)]"
        style={{ "--n": companies.length } as CSSProperties}
      >
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, "w-[104px] border-b border-line text-xs text-muted sm:w-[210px]")}>The question</th>
            {companies.map((c) => (
              <th key={c.symbol} scope="col" className={cn(CELL, "border-b border-line text-left font-normal")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={symbolPath(c.symbol)} className="font-semibold text-ink hover:underline">{c.symbol}</Link>
                    <div className="truncate text-xs text-muted">{c.name}</div>
                  </div>
                  <button type="button" onClick={() => onRemove(c.symbol)} aria-label={`Remove ${c.symbol}`} className="-mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-ink">
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="num mt-1 text-[13px] text-ink">
                  {price(c.price)} <Signed value={c.change_pct} className="text-xs">{signedPct(c.change_pct)}</Signed>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(["long", "short"] as const).map((horizon) => (
            <tr key={horizon}>
              <th scope="row" className={cn(HEAD, "border-b border-line")}>
                <span className="font-medium text-ink">{horizon === "long" ? "Score for a year or more" : "Score for the next few weeks"}</span>
                <span className="mt-0.5 block text-xs text-muted max-sm:hidden">{horizon === "long" ? "Trend, price, business and risk" : "Price behaviour only"}</span>
              </th>
              {companies.map((c) => (
                <td key={c.symbol} className={cn(CELL, "border-b border-line")}>
                  <div className="flex items-center gap-2">
                    <ScorePill value={c.score[horizon].value} tone={c.score[horizon].tone} />
                    <span className="text-xs leading-snug text-ink-2 max-sm:hidden">{c.score[horizon].label}</span>
                  </div>
                </td>
              ))}
            </tr>
          ))}
          {areas.map((area) => (
            <tr key={area.id}>
              <th scope="row" className={cn(HEAD, "border-b border-line")}>
                <span className="font-medium text-ink">{area.question}</span>
                <span className="mt-0.5 block text-xs text-muted max-sm:hidden">{area.title}</span>
              </th>
              {companies.map((c) => {
                const found = c.areas.find((a) => a.id === area.id);
                return (
                  <td key={c.symbol} className={cn(CELL, "border-b border-line")}>
                    {found ? (
                      <>
                        <div className="flex items-center gap-2">
                          <VerdictMark verdict={found.verdict} plain className="size-5" />
                          <span className="num font-medium text-ink">{found.reading}</span>
                        </div>
                        <p className="mt-1 line-clamp-4 text-xs leading-relaxed text-muted max-sm:hidden" title={found.summary}>{found.summary}</p>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <th scope="colgroup" colSpan={companies.length + 1} className="sticky left-0 bg-surface px-4 pb-1 pt-5 text-left text-[13px] font-semibold text-ink sm:px-5">
              The figures behind them
            </th>
          </tr>
          {FIGURES.map((row, i) => (
            <tr key={row.label}>
              <th scope="row" title={row.hint} className={cn(HEAD, "py-2 text-ink-2", i < FIGURES.length - 1 && "border-b border-line")}>{row.label}</th>
              {companies.map((c) => (
                <td key={c.symbol} className={cn(CELL, "num py-2 font-medium text-ink", i < FIGURES.length - 1 && "border-b border-line")}>{row.show(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CompareStocksPage() {
  const [params, setParams] = useSearchParams();
  const chosen = [...new Set((params.get("symbols") ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX);
  const comparison = useStockComparison(chosen);
  const set = (symbols: string[]) => setParams(symbols.length ? { symbols: symbols.join(",") } : {}, { replace: true });
  const data = comparison.data;
  const figuresAsOf = data?.companies.map((c) => c.figures_as_of).filter(Boolean).sort()[0];

  return (
    <Page
      title="Compare stocks"
      description="Up to four companies side by side, on the same questions and the same checks."
      actions={data && data.companies.length === 1 ? <TradeCheckButton symbol={data.companies[0].symbol} /> : undefined}
    >
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {chosen.map((symbol) => (
            <span key={symbol} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-accent-soft pl-3 pr-1.5 text-sm font-medium text-ink">
              {symbol}
              <button type="button" onClick={() => set(chosen.filter((s) => s !== symbol))} aria-label={`Remove ${symbol}`} className="inline-flex size-6 items-center justify-center rounded-md text-ink-2 hover:bg-surface hover:text-ink">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {chosen.length < MAX && (
            <div className="min-w-56 flex-1">
              {/* Re-made after each pick so the box empties. */}
              <SymbolPicker
                key={chosen.join(",")}
                value=""
                placeholder={chosen.length ? "Add another company" : "Which company? e.g. hdfc bank"}
                onSelect={(item) => set([...chosen, item.symbol.toUpperCase()])}
              />
            </div>
          )}
        </div>
        {chosen.length < 2 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            Or start from a pair:
            {STARTERS.map(([a, b]) => (
              <Button key={a} size="sm" onClick={() => set([a, b])}>
                {a} and {b}
              </Button>
            ))}
          </div>
        )}
      </Card>

      {chosen.length === 0 ? (
        <Card>
          <EmptyState
            className="py-14"
            icon={<Scale />}
            title="Pick two companies to set side by side"
            description="Comparing companies in the same line of business tells you the most: their prices and profits are measured against the same yardsticks."
          />
        </Card>
      ) : comparison.isError ? (
        <Card>
          <ErrorState error={comparison.error} onRetry={() => comparison.refetch()} />
        </Card>
      ) : !data ? (
        <CardSkeleton height={420} />
      ) : (
        <>
          {data.skipped.length > 0 && (
            <p className="mb-3 rounded-[10px] bg-warn-soft px-3 py-2 text-[13px] text-ink-2">
              {data.skipped.join(", ")} {data.skipped.length === 1 ? "is not a company" : "are not companies"} WealthOS scores (an index, a fund, or outside the tracked list), so {data.skipped.length === 1 ? "it is" : "they are"} left out.
            </p>
          )}
          {data.companies.length > 0 && (
            <Card flush bodyClassName="!pt-0">
              <Table companies={data.companies} areas={data.areas} onRemove={(symbol) => set(chosen.filter((s) => s !== symbol))} />
            </Card>
          )}
          <ScenarioNote className="mt-4">
            This lays today's evidence side by side; it does not pick a winner. A mark sums up the checks under one question, and the checks cannot see management, news still to come, or what you already hold. Prices as of{" "}
            {date(data.as_of)}{figuresAsOf ? `; company figures as of ${date(figuresAsOf)}` : ""}. Not investment advice.
          </ScenarioNote>
        </>
      )}
    </Page>
  );
}
