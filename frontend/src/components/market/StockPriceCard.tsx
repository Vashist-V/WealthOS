import { useMemo, useState } from "react";
import { PriceChart } from "@/components/charts";
import { Card, Delta, ErrorState, InfoHint, Segmented, Signed, Skeleton } from "@/components/ui";
import { date, signedPct } from "@/lib/format";
import { useHistory } from "@/lib/queries";
import type { StockDetail } from "@/lib/types";
import { cn } from "@/lib/utils";
import { level, signedPrice } from "./shared";

const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"] as const;
type Range = (typeof RANGES)[number];

/** What the change beside the controls is measured over. */
const PERIOD: Record<string, string> = {
  "1D": "since the previous close",
  "5D": "over the past 5 days",
  "1M": "over the past month",
  "6M": "over the past 6 months",
  YTD: "since the start of the year",
  "1Y": "over the past year",
  "3Y": "over the past 3 years",
  "5Y": "over the past 5 years",
};

const RETURNS = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y"] as const;
const CHART_HEIGHT = 360;

/** Last price, the change over the selected period, the price chart with its controls, and returns by period. */
export function PriceCard({ symbol, detail, className }: { symbol: string; detail: StockDetail; className?: string }) {
  const [range, setRange] = useState<Range>("1Y");
  const [mode, setMode] = useState<"line" | "candles">("line");
  const history = useHistory(symbol, range);
  const h = history.data;
  const q = detail.quote;
  const plain = detail.is_index;

  const candles = h?.candles;
  const hasVolume = useMemo(() => !!candles?.some((c) => c.v > 0), [candles]);
  const period = useMemo(() => {
    // A daily series needs two closes to show a change; an intraday one can lean on the previous close.
    if (!h || h.candles.length < (h.intraday ? 1 : 2)) return null;
    const first = h.candles[0];
    const last = h.candles[h.candles.length - 1].c;
    // Intraday bars start at the open, so a day is measured from the previous close and five days from the first open.
    const base = h.intraday ? (h.range === "1D" ? q.prev_close : first.o) : first.c;
    if (!base) return null;
    return {
      change: last - base,
      pct: (last / base - 1) * 100,
      label: PERIOD[h.range] ?? `since ${date(first.t.slice(0, 10))}`,
      base,
      // A one-day view starts from yesterday's close, which the label already says.
      since: h.range === "1D" ? null : date(first.t.slice(0, 10)),
      isToday: h.range === "1D",
    };
  }, [h, q.prev_close]);
  // The server falls back to daily prices when intraday bars are unavailable.
  const fellBack = !!h && !history.isPlaceholderData && (range === "1D" || range === "5D") && !h.intraday;

  return (
    <Card tour="stock-price" className={className} bodyClassName="flex flex-col">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="text-[13px] text-muted">{plain ? "Last level" : "Last price"}</div>
          <div className="num mt-1 text-[36px] font-semibold leading-none tracking-[-0.03em] text-ink sm:text-[44px]">{level(q.price, plain)}</div>
          {/* The headline change follows the selected period; today's move drops to the line below. */}
          <div className={cn("mt-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 transition-opacity", history.isPlaceholderData && "opacity-50")}>
            {period ? (
              <>
                <Delta value={period.change} size="md" className="text-lg font-semibold sm:text-xl [&>svg]:size-5 [&>svg]:self-center">
                  {signedPrice(period.change, plain)} ({signedPct(period.pct)})
                </Delta>
                <span className="text-sm text-ink-2">{period.label}</span>
              </>
            ) : history.isError || (h && h.candles.length < 2) ? (
              <>
                <Delta value={q.change} size="md" className="text-lg font-semibold sm:text-xl [&>svg]:size-5 [&>svg]:self-center">
                  {signedPrice(q.change, plain)} ({signedPct(q.change_pct)})
                </Delta>
                <span className="text-sm text-ink-2">since the previous close</span>
              </>
            ) : (
              <Skeleton className="h-7 w-64" />
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            {period?.since && (
              <span>
                From {level(period.base, plain)} on {period.since}
              </span>
            )}
            {period && !period.isToday && (
              <span className="inline-flex items-center gap-1">
                {period.since && "·"} Today
                <Signed value={q.change} className="font-medium">
                  {signedPrice(q.change, plain)} ({signedPct(q.change_pct)})
                </Signed>
              </span>
            )}
            <span>
              {period && "· "}as of {date(q.as_of)}
            </span>
          </div>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Segmented label="Chart style" size="sm" value={mode} onChange={setMode} options={[{ value: "line", label: "Line" }, { value: "candles", label: "Candles" }]} />
          <div className="max-w-full overflow-x-auto">
            <Segmented tour="stock-range" label="Period" size="sm" value={range} onChange={setRange} options={RANGES} className="whitespace-nowrap" />
          </div>
        </div>
      </div>

      <div className={cn("mt-5 transition-opacity", history.isPlaceholderData && "opacity-60")}>
        {!h ? (
          history.isError ? (
            <ErrorState error={history.error} onRetry={() => history.refetch()} className="py-16" />
          ) : (
            <Skeleton className="h-[360px] w-full" />
          )
        ) : h.candles.length < 2 ? (
          <div className="flex items-center justify-center text-[13px] text-muted" style={{ height: CHART_HEIGHT }}>
            The data source has too little price history to draw a chart for this period.
          </div>
        ) : (
          <PriceChart
            label={`${detail.name} price, ${period?.label ?? range}`}
            candles={h.candles}
            mode={mode}
            volume={hasVolume}
            height={CHART_HEIGHT}
            intraday={h.intraday}
            baseline={h.intraday && h.range === "1D" ? q.prev_close : undefined}
          />
        )}
      </div>
      {fellBack && <p className="mt-2 text-xs text-muted">Intraday prices aren't available for this symbol right now, so the past month of daily prices is shown.</p>}

      <div className="mt-4 border-t border-line pt-3.5">
        <div className="mb-2.5 flex items-center gap-1.5 text-xs text-muted">
          Price change by period
          <InfoHint text="Change in the closing price over each period. Dividends are not included." />
        </div>
        <dl className="grid grid-cols-4 gap-x-4 gap-y-3 sm:grid-cols-8">
          {RETURNS.map((key) => {
            const value = detail.returns[key];
            return (
              <div key={key} className="min-w-0">
                <dt className="text-xs text-muted">{key}</dt>
                <dd className="mt-0.5 truncate text-[13px] font-medium">
                  <Signed value={value}>{signedPct(value, 1)}</Signed>
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </Card>
  );
}
