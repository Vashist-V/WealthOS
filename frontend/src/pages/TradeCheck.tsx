/**
 * Trade check: a buy or a sell run through every check before it is made.
 *
 * The score and each check come from the server, computed from data alone.
 * "In plain words" explains them, with AI when the server has a key and
 * straight from the checks when it has none.
 */
import { ArrowRight, ClipboardCheck, ExternalLink, NotebookPen, Plus, RotateCw, Sparkles, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { RichText, Sources } from "@/components/assistant/Chat";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { parseNumber, ScenarioNote } from "@/components/lab/shared";
import { useAppActions } from "@/components/layout/AppShell";
import { Dial, VerdictMark, VERDICTS } from "@/components/score";
import { Badge, Button, Card, CardSkeleton, EmptyState, ErrorState, Field, InfoHint, Input, Page, Segmented, Select, Signed, Skeleton } from "@/components/ui";
import { explainTrade } from "@/lib/api";
import { date, inr, pct, price, quantity as fmtQty, signedInr, signedPct, signedRatioPct } from "@/lib/format";
import { ALL, usePortfolio } from "@/lib/portfolio";
import { errorMessage, useOverview, useStock, useTradeCheck } from "@/lib/queries";
import type { AssistantSource, TradeCheck, TradeCheckGroup, TradeCheckItem, TradeInput, TradeSide } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";

// -------------------------------------------------------------------- score
function ScoreCard({ report }: { report: TradeCheck }) {
  const s = report.score;
  const buying = report.side === "BUY";
  return (
    <Card tour="tc-score">
      <div className="flex items-center gap-1.5 text-[13px] text-muted">
        Confidence score
        <InfoHint text="How strongly the checks line up behind this trade. 50 is an even split; higher means more of them support it. It sums up evidence as it stands today. It does not predict the price and is not advice." />
      </div>
      <div className="mt-3 pb-4">
        <Dial value={s.value} tone={s.tone} />
      </div>
      <p className="mt-3 text-balance text-center text-[15px] font-semibold leading-snug tracking-tight text-ink">{s.label}</p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><VerdictMark verdict="for" className="size-[18px]" /> {s.for} support</span>
        <span className="inline-flex items-center gap-1.5"><VerdictMark verdict="against" className="size-[18px]" /> {s.against} against</span>
        <span className="inline-flex items-center gap-1.5"><VerdictMark verdict="neutral" className="size-[18px]" /> {s.neutral} neutral</span>
      </div>
      {s.unknown > 0 && <p className="mt-2 text-center text-xs text-muted">{s.unknown} more had no data and are left out of the score.</p>}
      <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-3.5 text-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{buying ? "Buying" : "Selling"}</dt>
          <dd className="font-medium text-ink">{fmtQty(report.quantity)} × {report.symbol}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Latest price</dt>
          <dd className="num text-ink-2">{price(report.price)} <span className="text-muted">· {date(report.as_of)}</span></dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">{buying ? "Order value" : "Sale proceeds"}</dt>
          <dd className="num font-medium text-ink">{inr(report.value)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted">Portfolio</dt>
          <dd className="min-w-0 truncate text-ink-2">{report.portfolio.name}</dd>
        </div>
      </dl>
    </Card>
  );
}

// -------------------------------------------------------------- explanation
interface Explained {
  text: string;
  mode?: "ai" | "data";
  status: string;
  pending: boolean;
  error?: string;
  sources?: AssistantSource[];
  searchHtml?: string;
}

function Explanation({ trade, report }: { trade: TradeInput; report: TradeCheck }) {
  const [state, setState] = useState<Explained>({ text: "", status: "", pending: true });

  useEffect(() => {
    const controller = new AbortController();
    setState({ text: "", status: "", pending: true });
    explainTrade(
      trade,
      (event) => {
        if (event.type === "meta") setState((s) => ({ ...s, mode: event.mode }));
        else if (event.type === "status") setState((s) => ({ ...s, status: event.text }));
        else if (event.type === "delta") setState((s) => ({ ...s, text: s.text + event.text, status: "" }));
        else if (event.type === "sources") setState((s) => ({ ...s, sources: event.items }));
        else if (event.type === "search_suggestions") setState((s) => ({ ...s, searchHtml: event.html }));
        else if (event.type === "error") setState((s) => ({ ...s, pending: false, error: event.message }));
        else if (event.type === "done") setState((s) => ({ ...s, pending: false }));
      },
      controller.signal,
    )
      .then(() => setState((s) => ({ ...s, pending: false })))
      .catch((error) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, pending: false, error: errorMessage(error) }));
      });
    return () => controller.abort();
  }, [trade]);

  // If the model's explanation never arrived, the one written from the checks stands in for it.
  const fellBack = !state.pending && !state.text;
  const text = fellBack ? report.summary : state.text;
  const fromChecks = fellBack || state.mode === "data";
  return (
    <Card
      tour="tc-explain"
      title={<span className="flex items-center gap-2"><Sparkles className="size-4 text-accent" aria-hidden /> In plain words</span>}
      description={fromChecks ? "The result, written out from the checks." : "The result explained, with what the news adds."}
      className="lg:col-span-8"
    >
      {state.pending && !text ? (
        <div role="status" className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
          <p className="mt-1 text-xs text-muted">{state.status || "Reading the checks and the news"}…</p>
        </div>
      ) : (
        <>
          <RichText text={text} />
          {state.pending && state.status && <p className="mt-2 text-xs text-muted">{state.status}…</p>}
          <Sources sources={state.sources} searchHtml={state.pending ? undefined : state.searchHtml} />
          {!state.pending && (
            <p className="mt-3 border-t border-line pt-3 text-xs leading-relaxed text-muted">
              {fellBack && state.error
                ? `The AI explanation didn't arrive (${state.error.replace(/\.$/, "")}), so this is written from the checks instead.`
                : fromChecks
                  ? "Written from the checks, without AI. With an AI key on the server, this card also reads the news."
                  : "Written by AI from the checks and recent news. It explains the evidence; the score itself is calculated, not guessed."}
            </p>
          )}
        </>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------- checks
function CheckRow({ item }: { item: TradeCheckItem }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <VerdictMark verdict={item.verdict} className="mt-px" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <span className="flex items-center gap-1 text-[13px] font-medium text-ink">
            {item.title}
            <InfoHint text={item.learn} />
          </span>
          <span className="num text-[13px] text-ink-2">{item.reading}</span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{item.detail}</p>
      </div>
    </li>
  );
}

function GroupCard({ group }: { group: TradeCheckGroup }) {
  return (
    <Card
      title={group.title}
      description={group.question}
      action={
        <>
          {group.for > 0 && <Badge tone="gain">{group.for} for</Badge>}
          {group.against > 0 && <Badge tone="loss">{group.against} against</Badge>}
        </>
      }
    >
      <ul className="flex flex-col divide-y divide-line">
        {group.checks.map((item) => (
          <CheckRow key={item.id} item={item} />
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------- before and after
function BeforeAfter({ report }: { report: TradeCheck }) {
  const p = report.position;
  const rows: { label: string; before: ReactNode; after: ReactNode; hint?: string }[] = [
    { label: "Shares", before: fmtQty(p.before.quantity), after: fmtQty(p.after.quantity) },
    { label: "Value", before: inr(p.before.value), after: inr(p.after.value) },
    { label: "Share of the portfolio", before: pct(p.before.weight, 1), after: pct(p.after.weight, 1), hint: "This holding's share of everything held in the portfolio, cash excluded." },
    { label: `${p.sector.name} sector`, before: pct(p.sector.before, 1), after: pct(p.sector.after, 1), hint: "The share of the portfolio in this stock's sector, this stock included." },
    { label: "Average cost", before: price(p.before.avg_cost), after: price(p.after.avg_cost), hint: "What each share held has cost on average across all the buys." },
  ];
  return (
    <Card title="Your holding, before and after" description={`In ${report.portfolio.name}, if the trade fills at the latest price`}>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-xs text-muted">
            <th scope="col" className="pb-2 text-left font-medium"><span className="sr-only">Measure</span></th>
            <th scope="col" className="pb-2 text-right font-medium">Now</th>
            <th scope="col" className="pb-2 text-right font-medium">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className="py-2.5 text-left font-normal text-ink-2">
                <span className="flex items-center gap-1">{row.label}{row.hint && <InfoHint text={row.hint} />}</span>
              </th>
              <td className="num py-2.5 text-right text-ink-2">{row.before}</td>
              <td className="num py-2.5 text-right font-medium text-ink">{row.after}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.realised && (
        <p className="mt-3 border-t border-line pt-3 text-[13px] text-ink-2">
          The sale would make real a {p.realised.amount >= 0 ? "gain" : "loss"} of{" "}
          <Signed value={p.realised.amount} className="font-medium">{signedInr(p.realised.amount)}</Signed> ({signedPct(p.realised.pct, 1)}) against your average cost.
        </p>
      )}
    </Card>
  );
}

function Outcomes({ report }: { report: TradeCheck }) {
  const o = report.outcomes;
  if (!o) return null;
  const cases = [
    { label: "A poor year", note: "1 in 20 were worse", change: o.poor, amount: o.poor_amount },
    { label: "A middle year", note: "half were better", change: o.median, amount: o.median_amount },
    { label: "A good year", note: "1 in 20 were better", change: o.good, amount: o.good_amount },
  ];
  return (
    <Card
      tour="tc-outcomes"
      title="A year of holding, historically"
      description={report.side === "BUY" ? `What happened to ${inr(report.value)} of ${report.symbol} held for one year` : `What a year of holding on to these ${fmtQty(report.quantity)} shares has looked like`}
    >
      <div className="grid grid-cols-3 gap-2.5">
        {cases.map((c) => (
          <div key={c.label} className="min-w-0 rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-line">
            <div className="truncate text-xs text-muted">{c.label}</div>
            <Signed value={c.change} className="mt-1 block truncate text-lg font-semibold tracking-tight">{signedRatioPct(c.change, 1)}</Signed>
            <div className="num truncate text-xs text-ink-2">{signedInr(c.amount)}</div>
            <div className="mt-1 truncate text-[11px] text-muted">{c.note}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
        Counting every one-year stretch in {o.years.toFixed(0)} years of prices, <span className="font-medium text-ink">{pct(o.positive * 100, 0)} ended higher</span> than they began.
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">Price only: dividends are not counted. This is what did happen, not what will.</p>
    </Card>
  );
}

function News({ report }: { report: TradeCheck }) {
  return (
    <Card title="In the news" description="Recent headlines. The checks don't read them; the explanation does when AI is on.">
      {report.news.length === 0 ? (
        <p className="text-[13px] text-muted">No headlines were found from the past three weeks.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {report.news.map((n) => (
            <li key={n.url || n.title} className="py-2.5 first:pt-0 last:pb-0">
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-2 text-[13px] leading-snug text-ink transition-colors hover:text-accent">
                <span className="min-w-0 flex-1">{n.title}</span>
                <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted group-hover:text-accent" aria-hidden />
              </a>
              <div className="mt-0.5 text-xs text-muted">{[n.source, date(n.published)].filter(Boolean).join(" · ")}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --------------------------------------------------------------- next steps
function NextSteps({ report }: { report: TradeCheck }) {
  const actions = useAppActions();
  const navigate = useNavigate();
  const { paper } = usePortfolio();
  const buying = report.side === "BUY";
  const inPaper = report.portfolio.kind === "paper";
  const toPaper = (account: string) =>
    navigate("/lab/paper", { state: { account, ticket: { side: report.side, symbol: report.symbol, quantity: String(report.quantity) } } });
  return (
    <Card tour="tc-actions" title="The decision is yours" description="WealthOS never places a trade. If you go ahead, these keep your records straight.">
      <div className="flex flex-col gap-2">
        {report.portfolio.kind === "investment" && (
          <Button
            variant="primary"
            className="w-full"
            icon={<Plus className="size-4" />}
            onClick={() =>
              actions.addTransaction({ portfolioId: report.portfolio.id, symbol: report.symbol, type: report.side, quantity: report.quantity, price: Math.round(report.price * 100) / 100 })
            }
          >
            Record this {buying ? "buy" : "sale"} once it's made
          </Button>
        )}
        {inPaper && (
          <Button variant="primary" className="w-full" icon={<Wallet className="size-4" />} onClick={() => toPaper(report.portfolio.id)}>
            Take it to the paper order ticket
          </Button>
        )}
        {!inPaper && buying && paper.length > 0 && (
          <Button className="w-full" icon={<Wallet className="size-4" />} onClick={() => toPaper(paper[0].id)}>
            Practise it with virtual money first
          </Button>
        )}
        <Button className="w-full" icon={<NotebookPen className="size-4" />} onClick={() => navigate("/journal")}>
          Write down your reasons
        </Button>
        <Link to={symbolPath(report.symbol)} className="mt-1 inline-flex items-center justify-center gap-1 text-[13px] font-medium text-accent hover:underline">
          Open {report.symbol}'s page <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
    </Card>
  );
}

function Result({ trade, report }: { trade: TradeInput; report: TradeCheck }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <ScoreCard report={report} />
          <NextSteps report={report} />
        </div>
        <Explanation trade={trade} report={report} />
      </div>

      <section data-tour="tc-checks" aria-label="The checks">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Every check, with its evidence</h2>
            <p className="mt-0.5 text-[13px] text-muted">{report.score.scored} scored checks in {report.groups.length} groups. The ⓘ beside a check says what it measures.</p>
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
            {(["for", "against", "neutral", "info"] as const).map((v) => (
              <li key={v} className="inline-flex items-center gap-1.5">
                <VerdictMark verdict={v} className="size-[18px]" />
                {VERDICTS[v].label}
              </li>
            ))}
          </ul>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {report.groups.map((group) => (
            <GroupCard key={group.id} group={group} />
          ))}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <BeforeAfter report={report} />
        <Outcomes report={report} />
        <News report={report} />
        <Card title="What the checks can't see" description="Weigh these yourself: no figure on this page knows them.">
          <ul className="flex flex-col gap-2">
            {report.blind_spots.map((line) => (
              <li key={line} className="flex gap-2 text-[13px] leading-relaxed text-ink-2">
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-muted" />
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <ScenarioNote>
        Trade check lays out evidence from past prices, company filings and your own portfolio. It is not investment advice or a forecast, and it cannot know your goals. WealthOS never places a trade: any order is made by you, with your broker.
      </ScenarioNote>
    </div>
  );
}

// --------------------------------------------------------------------- page
export function TradeCheckPage() {
  const [params, setParams] = useSearchParams();
  const { portfolios, investment, id: activeId, isLoading } = usePortfolio();
  const [side, setSide] = useState<TradeSide>(params.get("side")?.toUpperCase() === "SELL" ? "SELL" : "BUY");
  const [symbol, setSymbol] = useState((params.get("symbol") ?? "").toUpperCase());
  const [qty, setQty] = useState(params.get("qty") ?? "");
  const [picked, setPicked] = useState(params.get("portfolio") ?? "");
  const [trade, setTrade] = useState<TradeInput | null>(null);

  // The portfolio chosen here, else the one selected for the whole app, else the first.
  const portfolioId =
    portfolios.find((p) => p.id === picked)?.id ?? (activeId && activeId !== ALL ? activeId : null) ?? investment[0]?.id ?? portfolios[0]?.id ?? null;
  const portfolio = portfolios.find((p) => p.id === portfolioId) ?? null;
  const stock = useStock(symbol || undefined);
  const overview = useOverview(portfolioId);
  const check = useTradeCheck(trade);

  const quote = stock.data?.quote;
  const held = overview.data?.holdings.find((h) => h.symbol === symbol)?.quantity ?? 0;
  const amount = parseNumber(qty);
  const selling = side === "SELL";

  // Why the check can't run yet. A `next` step is plain guidance; anything else is a blocker.
  const blocker = ((): { text: string; next?: boolean } | null => {
    if (!symbol) return { text: "Choose a company to check.", next: true };
    if (stock.isError) return { text: `No market price is available for ${symbol}, so it can't be checked.` };
    if (stock.data?.is_index) return { text: `${symbol} is an index and can't be traded directly. Choose a stock or an ETF.` };
    if (qty.trim() === "") return { text: "Enter how many shares.", next: true };
    if (amount === null || amount <= 0) return { text: "Enter a number of shares above zero." };
    if (selling && overview.data && held <= 0) return { text: `${portfolio?.name ?? "This portfolio"} holds no ${symbol}, so there is nothing to sell.` };
    if (selling && overview.data && amount > held + 1e-9) return { text: `${portfolio?.name ?? "This portfolio"} holds ${fmtQty(held)} ${symbol}. A sale can't be larger than that.` };
    return null;
  })();

  const current = useMemo<TradeInput | null>(
    () => (symbol && amount !== null && amount > 0 ? { symbol, side, quantity: amount, portfolio_id: portfolioId } : null),
    [symbol, side, amount, portfolioId],
  );
  const run = (next: TradeInput) => {
    setTrade(next);
    setParams({ symbol: next.symbol, side: next.side, qty: String(next.quantity), ...(next.portfolio_id ? { portfolio: next.portfolio_id } : {}) }, { replace: true });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!blocker && current) run(current);
  };

  // A link that names the whole trade (from a stock page, the docs or a dialog) runs it straight away.
  const [linked] = useState(() => !!params.get("symbol") && !!params.get("qty"));
  useEffect(() => {
    // Once, when the portfolios have loaded and the default one is known.
    if (linked && !trade && !isLoading && current) run(current);
  }, [linked, isLoading]);

  const changed = trade !== null && JSON.stringify(trade) !== JSON.stringify(current);

  return (
    <Page title="Trade check" description="Thinking of buying or selling? Run it through every check first, then decide for yourself.">
      <div className="flex flex-col gap-4">
        <Card tour="tc-form">
          <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-x-3 gap-y-4 xl:grid-cols-[auto_7.5rem_minmax(0,1fr)_minmax(0,15rem)_auto] xl:items-end">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink-2">I'm thinking of</span>
                <Segmented<TradeSide>
                  tour="tc-side"
                  label="Buy or sell"
                  value={side}
                  onChange={setSide}
                  options={[{ value: "BUY", label: "Buying" }, { value: "SELL", label: "Selling" }]}
                  className="h-9 w-full [&>button]:h-8 [&>button]:flex-1 [&>button]:px-3.5"
                />
              </div>
              <Field label="How many shares" tour="tc-quantity">
                {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} className="num" />}
              </Field>
              <Field label="Of which company" tour="tc-symbol" className="col-span-2 xl:col-span-1">
                {(props) => <SymbolPicker id={props.id} value={symbol} placeholder="Type a name, for example hero" onSelect={(item) => setSymbol(item.symbol)} />}
              </Field>
              <Field label="In which portfolio" tour="tc-portfolio" className="col-span-2 xl:col-span-1">
                {(props) => (
                  <Select {...props} value={portfolioId ?? ""} onChange={(e) => setPicked(e.target.value)} disabled={!portfolios.length}>
                    {!portfolios.length && <option value="">No portfolio yet</option>}
                    {portfolios.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.kind === "paper" ? " (paper)" : ""}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="primary" type="submit" data-tour="tc-run" className="col-span-2 xl:col-span-1" icon={<ClipboardCheck className="size-4" />} loading={check.isFetching} disabled={!!blocker}>
                Run the check
              </Button>
            </div>
            <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              {symbol && quote && stock.data && !stock.data.is_index && (
                <span data-tour="tc-price" className="text-ink-2">
                  <span className="font-medium text-ink">{stock.data.name}</span> · latest price <span className="num">{price(quote.price)}</span>
                  {amount !== null && amount > 0 && <> · {selling ? "proceeds" : "an order"} of about <span className="num font-medium text-ink">{inr(amount * quote.price)}</span></>}
                  {held > 0 && <> · you hold <span className="num">{fmtQty(held)}</span></>}
                </span>
              )}
              {blocker && <span role={blocker.next ? undefined : "alert"} className={blocker.next ? "text-muted" : "text-loss"}>{blocker.text}</span>}
              {!blocker && changed && <span className="text-muted">You changed the trade. Run the check again to update the result below.</span>}
            </div>
          </form>
        </Card>

        {!trade ? (
          <Card>
            <EmptyState
              className="py-14"
              icon={<ClipboardCheck />}
              title="Check a trade before you make it"
              description="Say what you're thinking of doing above. WealthOS tests the trend, the valuation, the business, the risk, what it does to your portfolio and what's coming up, then scores how the evidence stacks up and explains it in plain words. Nothing is bought or sold."
            />
          </Card>
        ) : check.isError ? (
          <Card>
            <ErrorState error={check.error} onRetry={() => check.refetch()} />
          </Card>
        ) : !check.data ? (
          <div className="grid gap-4 lg:grid-cols-12">
            <CardSkeleton height={300} className="lg:col-span-4" />
            <CardSkeleton height={300} className="lg:col-span-8" />
            <CardSkeleton height={260} className="lg:col-span-6" />
            <CardSkeleton height={260} className="lg:col-span-6" />
          </div>
        ) : (
          <div className={cn("flex flex-col gap-3 transition-opacity", changed && "opacity-60")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted">
                Checked at prices as of {date(check.data.as_of)}. Market {check.data.market.toLowerCase()}.
              </p>
              <Button size="sm" variant="ghost" icon={<RotateCw className="size-3.5" />} onClick={() => check.refetch()} loading={check.isFetching}>
                Check again
              </Button>
            </div>
            <Result trade={trade} report={check.data} />
          </div>
        )}
      </div>
    </Page>
  );
}
