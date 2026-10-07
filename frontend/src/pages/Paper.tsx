import { FlaskConical, Plus, ReceiptText, Wallet } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { TimeSeriesChart } from "@/components/charts";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { Chip, parseNumber, ScenarioNote } from "@/components/lab/shared";
import { useAppActions } from "@/components/layout/AppShell";
import {
  Badge, Button, Card, CardSkeleton, DataTable, Delta, EmptyState, ErrorState, Field, Input, Meter, Page, Segmented, Select, Signed, Skeleton, StatTile,
  SymbolCell, type Column,
} from "@/components/ui";
import { RANGES, type Range } from "@/components/widgets";
import { api } from "@/lib/api";
import { date, inr, pct, price, quantity, ratioPct, signedInr, signedPct, signedRatioPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useAction, useMe, useOverview, usePerformance, useStock, useTransactions } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Holding, Overview, Portfolio, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

type Side = "BUY" | "SELL";
interface Ticket {
  side: Side;
  symbol: string;
  quantity: string;
}

const FILLS = [0.25, 0.5, 1] as const;

// Five tiles: the account value leads on a phone, 3 + 2 on mid widths, one row on wide screens.
const TILE_GRID = "grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-5 [&>*]:max-sm:px-3";
const TILE_SPANS = ["col-span-2 xl:col-span-1", "md:col-span-2 xl:col-span-1", "md:col-span-2 xl:col-span-1", "md:col-span-3 xl:col-span-1", "md:col-span-3 xl:col-span-1"];

/** +₹31.60 / −₹4.05: a price move, signed. */
function signedPrice(change: number): string {
  const body = price(Math.abs(change));
  return change > 0 ? `+${body}` : change < 0 ? `−${body}` : body;
}

function SimulatedBadge() {
  return (
    <Badge tone="warn" className="px-2 py-1 text-xs">
      <FlaskConical className="size-3.5" aria-hidden />
      Simulated — no real orders are placed
    </Badge>
  );
}

// ------------------------------------------------------------ order ticket
function OrderTicket({
  paperId,
  data,
  ticket,
  onChange,
  quantityRef,
}: {
  paperId: string;
  data: Overview;
  ticket: Ticket;
  onChange: (patch: Partial<Ticket>) => void;
  quantityRef: React.RefObject<HTMLInputElement | null>;
}) {
  const me = useMe();
  const stock = useStock(ticket.symbol || undefined);
  const buying = ticket.side === "BUY";
  const cash = data.summary.cash;
  const held = data.holdings.find((h) => h.symbol === ticket.symbol)?.quantity ?? 0;
  const quote = stock.data?.quote;
  const last = quote?.price ?? null;
  const qty = parseNumber(ticket.quantity);
  const value = qty !== null && qty > 0 && last !== null ? qty * last : null;
  const cashAfter = value === null ? null : buying ? cash - value : cash + value;

  const fill = (fraction: number): number => {
    if (!buying) return fraction === 1 ? held : Math.floor(held * fraction);
    return last ? Math.floor((cash * fraction) / last) : 0;
  };

  const order = useAction((input: { symbol: string; side: Side; quantity: number }) => api.placeOrder(paperId, input), {
    invalidate: "portfolio",
    success: (out) => `${out.transaction_type === "BUY" ? "Bought" : "Sold"} ${quantity(out.quantity)} ${out.symbol} at ${price(out.price)}`,
    onSuccess: () => onChange({ quantity: "" }),
  });

  // Why the order can't be placed yet. A `next` step is plain guidance; anything else is a blocker.
  const blocker = ((): { text: string; next?: boolean } | null => {
    if (!ticket.symbol) return { text: "Pick a stock to see its price.", next: true };
    if (stock.isError) return { text: `No market price is available for ${ticket.symbol}, so an order can't be filled.` };
    if (stock.data?.is_index) return { text: `${ticket.symbol} is an index and can't be traded directly. Pick a stock or an ETF.` };
    if (!buying && held <= 0) return { text: `This account holds no ${ticket.symbol} to sell.` };
    if (ticket.quantity.trim() === "") return { text: "Enter a quantity.", next: true };
    if (qty === null || qty <= 0) return { text: "Enter a quantity above zero." };
    if (!buying && qty > held + 1e-9) return { text: `This account holds ${quantity(held)} ${ticket.symbol}. An order can't sell more than that.` };
    if (buying && value !== null && value > cash + 0.005) return { text: `This order needs about ${inr(value)}, and ${inr(cash)} of virtual cash is available.` };
    return null;
  })();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (blocker || qty === null || !last) return;
    order.mutate({ symbol: ticket.symbol, side: ticket.side, quantity: qty });
  };

  const closed = me.data && !me.data.market.is_open;

  return (
    <Card tour="paper-ticket" title="Order ticket" description="A market order in this paper account">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Segmented<Side>
          label="Order side"
          value={ticket.side}
          onChange={(side) => onChange({ side, quantity: "" })}
          options={[{ value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" }]}
          className="grid w-full grid-cols-2 [&>button]:h-8"
        />

        <Field label="Stock" tour="paper-symbol">
          {(props) => <SymbolPicker id={props.id} value={ticket.symbol} onSelect={(item) => onChange({ symbol: item.symbol, quantity: "" })} />}
        </Field>

        {ticket.symbol && (
          <div data-tour="paper-quote" className="rounded-xl bg-surface-2 px-3.5 py-3 ring-1 ring-inset ring-line">
            {stock.isPending ? (
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-24" />
              </div>
            ) : stock.isError || !quote ? (
              <p className="text-[13px] text-muted">The price for {ticket.symbol} didn't load.</p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-ink">{stock.data!.name}</div>
                  <div className="text-xs text-muted">Latest traded price{quote.as_of ? ` · ${date(quote.as_of)}` : ""}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="num text-lg font-semibold leading-6 tracking-tight text-ink">{price(quote.price)}</div>
                  <Delta value={quote.change} size="xs">
                    {signedPrice(quote.change)} ({signedPct(quote.change_pct)})
                  </Delta>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Field label="Quantity" tour="paper-quantity" hint={!buying && ticket.symbol ? `Held now: ${quantity(held)}` : buying && held > 0 ? `Already held: ${quantity(held)}` : undefined}>
            {(props) => (
              <Input
                {...props}
                ref={quantityRef}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="0"
                value={ticket.quantity}
                onChange={(e) => onChange({ quantity: e.target.value })}
                className="num"
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-1.5">
            {FILLS.map((fraction) => {
              const shares = fill(fraction);
              return (
                <Chip key={fraction} disabled={!ticket.symbol || !(shares > 0)} onClick={() => onChange({ quantity: String(shares) })}>
                  {ratioPct(fraction, 0)}
                </Chip>
              );
            })}
            <span className="text-xs text-muted">{buying ? "of available cash, in whole shares" : "of the quantity held"}</span>
          </div>
        </div>

        <dl className="flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Estimated order value</dt>
            <dd className="num font-medium text-ink">{inr(value)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Cash available</dt>
            <dd className="num text-ink-2">{inr(cash)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Cash after the order</dt>
            <dd className={cn("num font-medium", cashAfter !== null && cashAfter < 0 ? "text-loss" : "text-ink")}>{inr(cashAfter)}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2">
          <Button variant="primary" type="submit" size="lg" data-tour="paper-submit" className="w-full" loading={order.isPending} disabled={!!blocker || stock.isPending}>
            {buying ? "Place buy order" : "Place sell order"}
          </Button>
          {blocker && <p role={blocker.next ? undefined : "alert"} className={cn("text-xs leading-relaxed", blocker.next ? "text-muted" : "text-loss")}>{blocker.text}</p>}
          <p className="text-xs leading-relaxed text-muted">
            Orders fill immediately at the latest traded price{closed ? ". The market is closed now, so that is the last close" : ""}. This is a simulation: nothing is sent to a broker and no real money moves.
          </p>
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------- account
function Account({ portfolio, startWith }: { portfolio: Portfolio; startWith?: Ticket }) {
  const { chart } = useTheme();
  const [range, setRange] = useState<Range>("ALL");
  const [ticket, setTicket] = useState<Ticket>(startWith ?? { side: "BUY", symbol: "", quantity: "" });
  const overview = useOverview(portfolio.id);
  const performance = usePerformance(portfolio.id, range);
  const transactions = useTransactions(portfolio.id);
  const ticketRef = useRef<HTMLDivElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);

  const data = overview.data;
  const perf = performance.data;
  const maxWeight = useMemo(() => Math.max(1, ...(data?.holdings ?? []).map((h) => h.weight)), [data]);
  // A stable reference, so typing in the ticket doesn't redraw the chart.
  const valueSeries = useMemo(
    () => [
      { name: "Account value", data: perf?.value ?? [], area: true },
      { name: "Starting capital", data: perf?.invested ?? [], dashed: true, color: chart.muted },
    ],
    [perf, chart.muted],
  );

  if (overview.isError) {
    return (
      <Card>
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      </Card>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <div className={TILE_GRID}>
          {TILE_SPANS.map((span, i) => (
            <StatTile key={i} className={span} label="" value="" loading />
          ))}
        </div>
        <div className="grid gap-4 xl:grid-cols-12">
          <CardSkeleton height={380} className="xl:col-span-4" />
          <CardSkeleton height={380} className="xl:col-span-8" />
        </div>
        <CardSkeleton height={240} />
      </div>
    );
  }

  const s = data.summary;
  const total = s.net_worth - s.initial_capital;
  const totalPct = s.initial_capital > 0 ? (total / s.initial_capital) * 100 : 0;
  const stats = perf?.stats;

  const sell = (row: Holding) => {
    setTicket({ side: "SELL", symbol: row.symbol, quantity: "" });
    ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    quantityRef.current?.focus({ preventScroll: true });
  };

  const positionColumns: Column<Holding>[] = [
    {
      key: "symbol", header: "Position", sort: (r) => r.symbol,
      cell: (r) => (
        <div className="max-w-[7.5rem] sm:max-w-none">
          <SymbolCell
            symbol={r.symbol}
            sub={
              <>
                <span className="num sm:hidden">{quantity(r.quantity)} · {inr(r.value)}</span>
                <span className="max-sm:hidden">{r.name}</span>
              </>
            }
          />
        </div>
      ),
    },
    { key: "quantity", header: "Quantity", align: "right", hide: "sm", sort: (r) => r.quantity, cell: (r) => quantity(r.quantity) },
    { key: "avg", header: "Avg cost", align: "right", hide: "md", sort: (r) => r.avg_cost, cell: (r) => price(r.avg_cost) },
    {
      key: "price", header: "Price", align: "right", hide: "sm", sort: (r) => r.day_change_pct,
      cell: (r) => (
        <div>
          <div className="text-ink">{price(r.price)}</div>
          <Signed value={r.day_change_pct} className="text-xs">{signedPct(r.day_change_pct)}</Signed>
        </div>
      ),
    },
    { key: "value", header: "Value", align: "right", hide: "sm", sort: (r) => r.value, cell: (r) => <span className="font-medium text-ink">{inr(r.value)}</span> },
    {
      key: "pnl", header: "P&L", align: "right", sort: (r) => r.pnl,
      cell: (r) => (
        <div>
          <Signed value={r.pnl}>{signedInr(r.pnl)}</Signed>
          <div><Signed value={r.pnl_pct} className="text-xs">{signedPct(r.pnl_pct)}</Signed></div>
        </div>
      ),
    },
    {
      key: "weight", header: "Weight", align: "right", hide: "lg", sort: (r) => r.weight, hint: "This position's share of the value held in positions, cash excluded.",
      cell: (r) => (
        <div className="ml-auto flex w-20 items-center gap-2">
          <Meter value={r.weight} max={maxWeight} />
          <span className="w-10 shrink-0 text-right">{pct(r.weight, 1)}</span>
        </div>
      ),
    },
    {
      key: "action", header: <span className="sr-only">Actions</span>, align: "right", width: "64px",
      cell: (r) => (
        <Button size="sm" aria-label={`Sell ${r.symbol}`} onClick={() => sell(r)}>
          Sell
        </Button>
      ),
    },
  ];

  const orderColumns: Column<Transaction>[] = [
    { key: "date", header: "Date", hide: "sm", sort: (r) => r.transaction_date, cell: (r) => <span className="whitespace-nowrap">{date(r.transaction_date)}</span> },
    {
      key: "order", header: "Order", sort: (r) => r.symbol,
      cell: (r) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Badge tone={r.transaction_type === "BUY" ? "accent" : "neutral"} className="w-9 justify-center">{r.transaction_type === "BUY" ? "Buy" : r.transaction_type === "SELL" ? "Sell" : "Div"}</Badge>
          <div className="max-w-[9.5rem] sm:max-w-none">
            <SymbolCell
              symbol={r.symbol}
              sub={
                <>
                  <span className="num sm:hidden">{date(r.transaction_date)} · {quantity(r.quantity)} × {price(r.price)}</span>
                  <span className="max-sm:hidden">{r.name}</span>
                </>
              }
            />
          </div>
        </div>
      ),
    },
    { key: "quantity", header: "Quantity", align: "right", hide: "sm", sort: (r) => r.quantity, cell: (r) => quantity(r.quantity) },
    { key: "price", header: "Fill price", align: "right", hide: "sm", sort: (r) => r.price, cell: (r) => price(r.price) },
    { key: "amount", header: "Amount", align: "right", sort: (r) => r.amount, cell: (r) => <span className="font-medium text-ink">{inr(r.amount)}</span> },
    { key: "notes", header: "Note", hide: "lg", cell: (r) => <span className="block max-w-64 truncate text-muted">{r.notes || "—"}</span> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className={TILE_GRID}>
        <StatTile className={TILE_SPANS[0]} label="Account value" value={inr(s.net_worth)} sub={`Started with ${inr(s.initial_capital)}`} hint="Cash plus the current value of every open position." />
        <StatTile className={TILE_SPANS[1]} label="Cash available" value={inr(s.cash)} sub={s.net_worth > 0 ? `${pct((s.cash / s.net_worth) * 100, 0)} of the account` : undefined} />
        <StatTile className={TILE_SPANS[2]} label="In positions" value={inr(s.value)} sub={`${s.holdings_count} position${s.holdings_count === 1 ? "" : "s"}`} />
        <StatTile
          className={TILE_SPANS[3]}
          label="Total P&L"
          value={<Signed value={total}>{signedInr(total)}</Signed>}
          sub={<><Delta value={totalPct}>{signedPct(totalPct)}</Delta><span>against starting capital</span></>}
          hint="Account value minus the starting capital. It includes profit and loss on positions already closed and on those still open."
        />
        <StatTile
          className={TILE_SPANS[4]}
          label="Today's P&L"
          value={<Signed value={s.day_pnl}>{signedInr(s.day_pnl)}</Signed>}
          sub={<><Delta value={s.day_pct}>{signedPct(s.day_pct)}</Delta><span>on open positions</span></>}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <div ref={ticketRef} className="order-1 scroll-mt-20 xl:col-span-4">
          <OrderTicket paperId={portfolio.id} data={data} ticket={ticket} onChange={(patch) => setTicket((t) => ({ ...t, ...patch }))} quantityRef={quantityRef} />
        </div>

        <Card
          title="Account value over time"
          description="Cash and positions together, against the capital the account started with"
          className="order-3 xl:order-2 xl:col-span-8"
          bodyClassName="flex flex-col"
          action={<Segmented label="Period" size="sm" value={range} onChange={setRange} options={RANGES} />}
        >
          {performance.isError ? (
            <ErrorState error={performance.error} onRetry={() => performance.refetch()} />
          ) : !perf ? (
            <Skeleton className="h-[300px] w-full" />
          ) : perf.dates.length < 2 ? (
            <div className="flex h-[300px] items-center justify-center px-6 text-center text-[13px] text-muted">The chart appears once the account has two trading days of history.</div>
          ) : (
            <TimeSeriesChart
              label="Paper account value over time"
              dates={perf.dates}
              format="inr"
              height={300}
              series={valueSeries}
            />
          )}
          {stats && (
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-3.5 text-[13px]">
              <span className="text-muted">
                {range === "ALL" ? "Since the first order" : `Past ${range}`}
                <Delta value={stats.period_return} className="ml-2">{signedRatioPct(stats.period_return)}</Delta>
              </span>
              <span className="text-muted">
                {perf!.benchmark}
                <Signed value={stats.benchmark_return} className="ml-2 font-medium">{signedRatioPct(stats.benchmark_return)}</Signed>
              </span>
              <span className="text-muted">
                Largest fall
                <span className="num ml-2 font-medium text-ink">{signedRatioPct(stats.max_drawdown.value, 1)}</span>
              </span>
            </div>
          )}
        </Card>

        <Card tour="paper-positions" title="Positions" description={data.holdings.length ? `${data.holdings.length} open, largest first` : undefined} className="order-2 xl:order-3 xl:col-span-12" flush>
          <DataTable
            columns={positionColumns}
            rows={data.holdings}
            rowKey={(r) => r.symbol}
            defaultSort={{ key: "value", dir: "desc" }}
            empty={<EmptyState icon={<Wallet />} title="No open positions" description="Place a buy order in the ticket and the position shows up here, valued at live prices." />}
          />
        </Card>

        <Card
          title="Order history"
          description={
            transactions.data?.transactions.length ? (
              <>
                {transactions.data.transactions.length} filled order{transactions.data.transactions.length === 1 ? "" : "s"} · realised P&L{" "}
                <Signed value={transactions.data.totals.realized_pnl}>{signedInr(transactions.data.totals.realized_pnl)}</Signed>
              </>
            ) : undefined
          }
          className="order-4 xl:col-span-12"
          flush
        >
          {transactions.isError ? (
            <ErrorState error={transactions.error} onRetry={() => transactions.refetch()} />
          ) : !transactions.data ? (
            <div className="flex flex-col gap-2 px-4 pb-4 sm:px-5 sm:pb-5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <DataTable
              columns={orderColumns}
              rows={transactions.data.transactions}
              rowKey={(r) => r.id}
              defaultSort={{ key: "date", dir: "desc" }}
              maxHeight={440}
              empty={<EmptyState icon={<ReceiptText />} title="No orders yet" description="Every simulated order is listed here with the price it filled at." />}
            />
          )}
        </Card>
      </div>

      <ScenarioNote>
        Paper trading is a simulation at live prices, not a forecast of how real trading would go: fills ignore brokerage, taxes, slippage and liquidity. No real order is placed, and nothing here changes your investment portfolios.
      </ScenarioNote>
    </div>
  );
}

export function PaperPage() {
  const { paper, id, isLoading } = usePortfolio();
  const actions = useAppActions();
  // A trade check can hand over an order to try: the account it was checked against and the ticket filled in.
  const sent = useLocation().state as { account?: string; ticket?: Ticket } | null;
  const [chosen, setChosen] = useState<string | null>(sent?.account ?? null);

  // The account picked here, else the globally selected one if it is a paper account, else the first.
  const active = paper.find((p) => p.id === chosen) ?? paper.find((p) => p.id === id) ?? paper[0] ?? null;

  return (
    <Page
      title="Paper trading"
      description={
        active
          ? `${active.name} · practise with ${inr(active.initial_capital)} of virtual money at live prices`
          : "Practise buying and selling with virtual money at live prices."
      }
      actions={
        <>
          <SimulatedBadge />
          {paper.length > 1 && active && (
            <Select aria-label="Paper account" value={active.id} onChange={(e) => setChosen(e.target.value)} className="w-auto max-w-56">
              {paper.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          )}
          {paper.length > 0 && (
            <Button variant="ghost" icon={<Plus className="size-4" />} onClick={() => actions.newPortfolio("paper")}>
              New account
            </Button>
          )}
        </>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-4">
          <div className={TILE_GRID}>
            {TILE_SPANS.map((span, i) => (
              <StatTile key={i} className={span} label="" value="" loading />
            ))}
          </div>
          <CardSkeleton height={380} />
        </div>
      ) : !active ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<Wallet />}
            title="No paper account yet"
            description="A paper account starts with virtual cash. Orders fill at live market prices, and nothing is ever sent to a broker."
            action={
              <Button variant="primary" data-tour="paper-create" icon={<Plus className="size-4" />} onClick={() => actions.newPortfolio("paper")}>
                Create paper account
              </Button>
            }
          />
        </Card>
      ) : (
        <Account key={active.id} portfolio={active} startWith={sent?.account === active.id ? sent.ticket : undefined} />
      )}
    </Page>
  );
}
