import { Check, Save } from "lucide-react";
import { useMemo } from "react";
import { PriceChart, TimeSeriesChart, type TradeMarker } from "@/components/charts";
import { Badge, Button, Card, DataTable, EmptyState, KeyValue, Signed, StatTile, type Column } from "@/components/ui";
import { date, duration, inr, number, price, quantity, ratioPct, signedInr, signedRatioPct } from "@/lib/format";
import { useTheme } from "@/lib/theme";
import type { BacktestResult, BacktestTrade, Candle } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScenarioNote } from "./shared";

const STILL_OPEN = "Open at end";
const REASON_LABEL: Record<string, string> = { "Exit rule": "Sell rule", [STILL_OPEN]: "Still open" };

type TradeRow = BacktestTrade & { index: number };

function Versus({ children }: { children: React.ReactNode }) {
  return <span>Buy and hold {children}</span>;
}

export function BacktestResults({
  result,
  strategyName,
  stale,
  saved,
  saving,
  onSave,
}: {
  result: BacktestResult;
  strategyName: string;
  /** A newer run is in flight; the figures on screen are about to be replaced. */
  stale: boolean;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const { chart } = useTheme();
  const s = result.stats;
  const trades = result.trades;
  const wins = trades.filter((t) => t.pnl > 0).length;

  const candles = useMemo<Candle[]>(
    () => result.price.dates.map((t, i) => {
      const [o, c, l, h] = result.price.ohlc[i];
      return { t, o, h, l, c, v: 0 };
    }),
    [result],
  );
  const markers = useMemo<TradeMarker[]>(
    () => trades.flatMap((t) => [
      { date: t.entry_date, price: t.entry_price, side: "buy" as const },
      // A position still open on the last day was marked to market, not sold.
      ...(t.exit_reason === STILL_OPEN ? [] : [{ date: t.exit_date, price: t.exit_price, side: "sell" as const }]),
    ]),
    [trades],
  );
  const rows = useMemo<TradeRow[]>(() => trades.map((t, index) => ({ ...t, index: index + 1 })), [trades]);
  // Stable references: the page re-renders on every keystroke in the builder, and the charts should not.
  const equitySeries = useMemo(
    () => [
      { name: "Strategy", data: result.equity.strategy, area: true },
      { name: "Buy and hold", data: result.equity.buy_hold, dashed: true, color: chart.muted },
    ],
    [result, chart.muted],
  );
  const drawdownSeries = useMemo(() => [{ name: "Drawdown", data: result.equity.drawdown, area: true }], [result]);

  const columns: Column<TradeRow>[] = [
    { key: "index", header: "#", width: "44px", hide: "sm", sort: (r) => r.index, cell: (r) => <span className="num text-muted">{r.index}</span> },
    {
      key: "entry", header: "Bought", sort: (r) => r.entry_date,
      cell: (r) => (
        <div>
          <div className="whitespace-nowrap text-ink">{date(r.entry_date)}</div>
          <div className="num text-xs text-muted">{price(r.entry_price)}</div>
        </div>
      ),
    },
    {
      key: "exit", header: "Sold", sort: (r) => r.exit_date,
      cell: (r) => (
        <div>
          <div className="whitespace-nowrap text-ink">{r.exit_reason === STILL_OPEN ? "Not sold" : date(r.exit_date)}</div>
          <div className="num text-xs text-muted">{r.exit_reason === STILL_OPEN ? `Valued at ${price(r.exit_price)}` : price(r.exit_price)}</div>
        </div>
      ),
    },
    { key: "quantity", header: "Quantity", align: "right", hide: "md", sort: (r) => r.quantity, cell: (r) => quantity(r.quantity) },
    { key: "pnl", header: "P&L", align: "right", sort: (r) => r.pnl, cell: (r) => <Signed value={r.pnl}>{signedInr(r.pnl)}</Signed> },
    { key: "return", header: "Return", align: "right", sort: (r) => r.return_pct, cell: (r) => <Signed value={r.return_pct}>{signedRatioPct(r.return_pct)}</Signed> },
    { key: "days", header: "Days held", align: "right", hide: "sm", sort: (r) => r.holding_days, cell: (r) => number(r.holding_days) },
    {
      key: "reason", header: "Closed by", hide: "md", sort: (r) => r.exit_reason,
      cell: (r) => <Badge tone={r.exit_reason === STILL_OPEN ? "accent" : "neutral"}>{REASON_LABEL[r.exit_reason] ?? r.exit_reason}</Badge>,
    },
  ];

  return (
    <div className={cn("flex min-w-0 flex-col gap-4 transition-opacity", stale && "opacity-60")}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight text-ink">{strategyName} on {result.symbol}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {result.name} · {date(result.period.start)} to {date(result.period.end)} · started with {inr(s.initial_capital)}
          </p>
        </div>
        <Button icon={saved ? <Check className="size-4" /> : <Save className="size-4" />} disabled={saved || stale} loading={saving} onClick={onSave}>
          {saved ? "Result saved" : "Save this result"}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
        <StatTile label="Final value" value={inr(s.final_value)} sub={<Versus>{inr(s.buy_hold_final)}</Versus>} hint="What the starting capital became by following the rules, compared with buying on the first day and holding to the last." />
        <StatTile
          label="Total return"
          value={<Signed value={s.total_return}>{signedRatioPct(s.total_return)}</Signed>}
          sub={<Versus><Signed value={s.buy_hold_return}>{signedRatioPct(s.buy_hold_return)}</Signed></Versus>}
        />
        <StatTile
          label="CAGR"
          value={s.cagr == null ? "—" : <Signed value={s.cagr}>{signedRatioPct(s.cagr)}</Signed>}
          sub={<Versus>{s.buy_hold_cagr == null ? "—" : <Signed value={s.buy_hold_cagr}>{signedRatioPct(s.buy_hold_cagr)}</Signed>}</Versus>}
          hint="Compound annual growth rate: the steady yearly return that would turn the starting capital into the final value over this period."
        />
        <StatTile
          label="Maximum drawdown"
          value={signedRatioPct(s.max_drawdown, 1)}
          sub={<Versus>{signedRatioPct(s.buy_hold_max_drawdown, 1)}</Versus>}
          hint="The largest fall from a peak to a later low during the period. Closer to zero means shallower falls."
        />
        <StatTile label="Trades" value={number(s.total_trades)} sub={`In the market ${ratioPct(s.exposure, 0)} of the time`} hint="Completed round trips: one buy and the sell that closed it. A position still open on the last day counts at its value that day." />
        <StatTile
          label="Win rate"
          value={s.win_rate == null ? "—" : ratioPct(s.win_rate, 0)}
          sub={trades.length ? `${wins} of ${trades.length} trade${trades.length === 1 ? "" : "s"} made money` : "No trades in this period"}
          hint="Share of trades that closed with a profit after fees. A low win rate can still be profitable when the wins are larger than the losses."
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <Card title="Strategy against buy and hold" description="Value of the starting capital over time" className="xl:col-span-8">
          <TimeSeriesChart
            label="Value of the strategy compared with buying and holding"
            dates={result.equity.dates}
            format="inr"
            zoom
            series={equitySeries}
          />
        </Card>
        <Card title="More statistics" className="xl:col-span-4">
          <KeyValue
            items={[
              {
                label: "Profit factor",
                value: s.profit_factor == null ? "—" : number(s.profit_factor, 2),
                hint: "Total profit of winning trades divided by total loss of losing trades. Above 1 means the wins outweighed the losses.",
              },
              { label: "Time in market", value: ratioPct(s.exposure, 1), hint: "Share of trading days on which the strategy held a position. The rest of the time it sat in cash." },
              { label: "Average win", value: <Signed value={s.avg_win}>{signedRatioPct(s.avg_win)}</Signed> },
              { label: "Average loss", value: <Signed value={s.avg_loss}>{signedRatioPct(s.avg_loss)}</Signed> },
              { label: "Best trade", value: <Signed value={s.best_trade}>{signedRatioPct(s.best_trade)}</Signed> },
              { label: "Worst trade", value: <Signed value={s.worst_trade}>{signedRatioPct(s.worst_trade)}</Signed> },
              { label: "Average holding period", value: duration(s.avg_holding_days) },
              { label: "Volatility", value: ratioPct(s.volatility, 1), hint: "How much the strategy's value swung, annualised from its daily changes." },
              {
                label: "Sharpe ratio",
                value: s.sharpe == null ? "—" : number(Math.abs(s.sharpe) < 0.005 ? 0 : s.sharpe, 2),
                hint: "Yearly return divided by volatility, from daily changes, with no risk-free rate deducted. Higher means more return for each unit of swing.",
              },
            ]}
          />
        </Card>
      </div>

      <Card title="Drawdown" description="How far the strategy's value sat below its previous peak">
        <TimeSeriesChart
          label="Strategy drawdown over time"
          dates={result.equity.dates}
          format="pct"
          height={180}
          zeroLine
          zoom
          series={drawdownSeries}
        />
      </Card>

      <Card
        title="Price and trades"
        description={`${result.symbol} daily candles${result.price.overlays.length ? " with the strategy's indicators" : ""}. Upward triangles mark buys, downward triangles mark sells. Scroll or pinch to zoom.`}
      >
        <PriceChart label={`${result.symbol} price with the strategy's trades`} candles={candles} mode="candles" volume={false} overlays={result.price.overlays} markers={markers} height={420} />
      </Card>

      <Card title="Trades" description={trades.length ? `${trades.length} trade${trades.length === 1 ? "" : "s"}, each filled at the open after its signal` : undefined} flush>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => String(r.index)}
          defaultSort={{ key: "entry", dir: "asc" }}
          maxHeight={460}
          empty={
            <EmptyState
              title="No trades in this period"
              description="The buy rule never triggered between these dates, so the capital stayed in cash. A longer period or a different rule may produce trades."
            />
          }
        />
      </Card>

      <ScenarioNote>
        Past performance of a rule does not predict future results. This backtest reads signals on the close and fills at the next day's open; it ignores slippage, taxes and liquidity, so real trading would differ. It is scenario analysis on past data, and nothing here places a trade or changes your real portfolio.
      </ScenarioNote>
    </div>
  );
}
