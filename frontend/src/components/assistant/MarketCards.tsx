/**
 * The cards the market chat shows beside an answer: the market mood, the
 * sector scoreboard, one sector, one company, a ranking, and where a sum of
 * money could go. Every figure on them comes from the app's own checks.
 */
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckList, ScorePill, VerdictMark } from "@/components/score";
import { Signed } from "@/components/ui";
import { inr, price, quantity, signedPct } from "@/lib/format";
import type { Horizon, MarketCard, ScoreBrief, ScoredCompany } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";

const TERM: Record<Horizon, string> = { short: "Short term", long: "Long term" };
const KIND: Record<Horizon, string> = { short: "short-term", long: "long-term" };

function Frame({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface-2/60 p-3">
      <header className="mb-2 flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[13px] font-semibold leading-snug text-ink">{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** A follow-up question offered as a chip. */
function Follow({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-ink"
    >
      {children}
    </button>
  );
}

function Scores({ score, horizon }: { score: Record<Horizon, ScoreBrief>; horizon: Horizon }) {
  return (
    <div className="flex shrink-0 gap-1.5">
      {(["short", "long"] as const).map((h) => (
        <span key={h} className={cn("flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-[11px] text-muted ring-1 ring-inset", h === horizon ? "bg-surface ring-line-strong" : "ring-transparent")}>
          {TERM[h]}
          <ScorePill value={score[h].value} tone={score[h].tone} className="h-5 min-w-8" />
        </span>
      ))}
    </div>
  );
}

function Reasons({ row }: { row: ScoredCompany }) {
  const chips = [...row.for.slice(0, 2).map((r) => ({ ...r, verdict: "for" as const })), ...row.against.slice(0, 1).map((r) => ({ ...r, verdict: "against" as const }))];
  if (!chips.length) return null;
  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {chips.map((chip) => (
        <li key={chip.title} className="flex items-center gap-1.5 text-xs text-ink-2">
          <VerdictMark verdict={chip.verdict} plain className="size-4 [&>svg]:size-2.5" />
          <span className="min-w-0 truncate">
            {chip.title} <span className="num text-muted">{chip.reading}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One company in a ranking: its score, its price, and optionally what a sum of money buys of it. */
function CompanyRow({ row, rank, budget, why }: { row: ScoredCompany; rank?: number; /** The sum being placed, when there is one. */ budget?: { each: number }; why?: boolean }) {
  // An equal split is what gets checked; when that cannot buy a share, one share is.
  const shares = budget ? (row.split_shares && row.split_shares > 0 ? row.split_shares : 1) : null;
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-center gap-2.5">
        {rank !== undefined && <span className="num w-4 shrink-0 text-center text-xs text-muted">{rank}</span>}
        <Link to={symbolPath(row.symbol)} className="group min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink group-hover:text-accent">{row.symbol}</div>
          <div className="truncate text-xs text-muted">{row.name}</div>
        </Link>
        <div className="shrink-0 text-right">
          <div className="num text-[13px] text-ink">{price(row.price)}</div>
          <Signed value={row.change_pct} className="text-xs">{signedPct(row.change_pct)}</Signed>
        </div>
        <ScorePill value={row.score} tone={row.tone} />
      </div>
      {(why || budget) && (
        <div className={cn(rank !== undefined && "pl-[26px]")}>
          {why && <Reasons row={row} />}
          {budget && shares !== null && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
              <span className="text-xs text-ink-2">
                {row.split_shares && row.split_shares > 0
                  ? <>An equal share of {inr(budget.each)} buys <span className="num font-medium text-ink">{quantity(row.split_shares)}</span></>
                  : <>One share costs more than an equal share of {inr(budget.each)}</>}
              </span>
              <Link
                to={`/lab/trade-check?${new URLSearchParams({ symbol: row.symbol, side: "BUY", qty: String(shares) })}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <ClipboardCheck className="size-3.5" aria-hidden />
                Check buying {quantity(shares)}
              </Link>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Mood({ card }: { card: Extract<MarketCard, { kind: "mood" }> }) {
  return (
    <Frame title="Market mood" aside={<ScorePill value={card.score.value} tone={card.score.tone} />}>
      <p className="text-xs leading-relaxed text-ink-2">
        {card.score.label}.
        {card.index && (
          <>
            {" "}{card.index.name} is <Signed value={card.index.change_pct} className="font-medium">{signedPct(card.index.change_pct)}</Signed> today; {card.breadth.advances} of {card.breadth.total} companies are up.
          </>
        )}
      </p>
      <CheckList checks={card.checks} className="mt-1.5" />
    </Frame>
  );
}

function Sectors({ card, ask }: { card: Extract<MarketCard, { kind: "sectors" }>; ask: (question: string) => void }) {
  const [all, setAll] = useState(false);
  const rows = all ? card.rows : card.rows.slice(0, 8);
  return (
    <Frame title="Sector scoreboard" aside={<span className="shrink-0 text-[11px] text-muted">sorted by {KIND[card.horizon]} score</span>}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[11px] text-muted">
            <th scope="col" className="pb-1.5 text-left font-medium">Sector</th>
            <th scope="col" className="pb-1.5 text-right font-medium">Today</th>
            <th scope="col" className="pb-1.5 pl-2 text-right font-medium">Short</th>
            <th scope="col" className="pb-1.5 pl-1.5 text-right font-medium">Long</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.name}>
              <th scope="row" className="py-1.5 text-left font-normal">
                <button type="button" onClick={() => ask(`Is it a good time for ${row.name} stocks?`)} className="text-left text-[13px] font-medium text-ink hover:text-accent">
                  {row.name}
                </button>
              </th>
              <td className="py-1.5 text-right">
                <Signed value={row.change_pct}>{signedPct(row.change_pct)}</Signed>
              </td>
              <td className="py-1.5 pl-2 text-right"><ScorePill value={row.short.value} tone={row.short.tone} className="h-5 min-w-8" /></td>
              <td className="py-1.5 pl-1.5 text-right"><ScorePill value={row.long.value} tone={row.long.tone} className="h-5 min-w-8" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {card.rows.length > 8 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-xs font-medium text-accent hover:underline">
          {all ? "Show fewer" : `Show all ${card.rows.length} sectors`}
        </button>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted">Select a sector to see the checks behind its score.</p>
    </Frame>
  );
}

function Sector({ card, ask }: { card: Extract<MarketCard, { kind: "sector" }>; ask: (question: string) => void }) {
  const other: Horizon = card.horizon === "short" ? "long" : "short";
  return (
    <Frame title={<>{card.name} <span className="font-normal text-muted">· {card.count} companies</span></>} aside={<Scores score={card.score} horizon={card.horizon} />}>
      <p className="text-xs leading-relaxed text-ink-2">
        {TERM[card.horizon]}: {card.score[card.horizon].label.toLowerCase()}.
        {card.change_pct !== null && <> Today <Signed value={card.change_pct} className="font-medium">{signedPct(card.change_pct)}</Signed>, one month <Signed value={card.returns["1 month"]} className="font-medium">{signedPct(card.returns["1 month"], 1)}</Signed>.</>}
      </p>
      <CheckList checks={card.checks} className="mt-1.5" />
      {card.companies.length > 0 && (
        <>
          <h4 className="mt-3 text-[11px] font-medium uppercase tracking-wider text-muted">Highest {KIND[card.horizon]} scores</h4>
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {card.companies.map((row) => (
              <CompanyRow key={row.symbol} row={row} />
            ))}
          </ul>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Follow onClick={() => ask(`And ${card.name} stocks over the ${other} term?`)}>The {KIND[other]} view</Follow>
        <Follow onClick={() => ask(`I have ₹50,000. Where could it go in ${card.name} stocks?`)}>Where could ₹50,000 go here?</Follow>
      </div>
    </Frame>
  );
}

function Ideas({ card, ask }: { card: Extract<MarketCard, { kind: "ideas" }>; ask: (question: string) => void }) {
  const others = card.sectors.filter((s) => s.name !== card.sector);
  return (
    <Frame
      title={<>Where {inr(card.amount)} could go <span className="font-normal text-muted">· {KIND[card.horizon]} score</span></>}
      aside={card.sector_score && <ScorePill value={card.sector_score.score} tone={card.sector_score.tone} />}
    >
      <p className="text-xs leading-relaxed text-ink-2">
        {card.sector
          ? card.asked
            ? <>The highest-scoring companies in <span className="font-medium text-ink">{card.sector}</span> that the sum can buy.</>
            : <><span className="font-medium text-ink">{card.sector}</span> has the highest sector score. These are its highest-scoring companies the sum can buy.</>
          : "No sector could be scored yet."}
      </p>
      {card.companies.length > 0 ? (
        <ul className="mt-2.5 flex flex-col divide-y divide-line">
          {card.companies.map((row, i) => (
            <CompanyRow key={row.symbol} row={row} rank={i + 1} budget={{ each: card.each }} why />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted">No scored company here costs less than {inr(card.amount)} a share.</p>
      )}
      {card.too_dear > 0 && <p className="mt-2 text-[11px] text-muted">{card.too_dear} left out: one share costs more than {inr(card.amount)}.</p>}
      {others.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Other leading sectors</span>
          {others.map((s) => (
            <Follow key={s.name} onClick={() => ask(`What about ${s.name} stocks?`)}>
              {s.name} <span className="num text-muted">{s.score ?? "—"}</span>
            </Follow>
          ))}
        </div>
      )}
      <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-relaxed text-muted">
        A ranking by today's checks, not advice. Companies in one sector tend to rise and fall together. Market mood is {card.mood.value ?? "unscored"} out of 100. Check a trade to see how one fits what you already hold.
      </p>
    </Frame>
  );
}

function Companies({ card }: { card: Extract<MarketCard, { kind: "companies" }> }) {
  return (
    <Frame title={<>Highest {KIND[card.horizon]} scores <span className="font-normal text-muted">· {card.sector ?? "all sectors"}</span></>}>
      <ul className="flex flex-col divide-y divide-line">
        {card.rows.map((row, i) => (
          <CompanyRow key={row.symbol} row={row} rank={i + 1} why />
        ))}
      </ul>
      <p className="mt-2.5 border-t border-line pt-2.5 text-[11px] leading-relaxed text-muted">A high score means most checks are positive today. It is not a forecast.</p>
    </Frame>
  );
}

function Company({ card }: { card: Extract<MarketCard, { kind: "company" }> }) {
  return (
    <Frame title={<>{card.name} <span className="font-normal text-muted">· {card.sector}</span></>} aside={<Scores score={card.score} horizon={card.horizon} />}>
      <p className="text-xs leading-relaxed text-ink-2">
        <span className="num font-medium text-ink">{price(card.price)}</span>, <Signed value={card.change_pct} className="font-medium">{signedPct(card.change_pct)}</Signed> today. {TERM[card.horizon]}: {card.score[card.horizon].label.toLowerCase()}.
      </p>
      {card.groups.map((group) => (
        <div key={group.title} className="mt-2.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">{group.title}</h4>
          <CheckList checks={group.checks} />
        </div>
      ))}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        <Link to={symbolPath(card.symbol)} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          Open {card.symbol}'s page <ArrowRight className="size-3.5" aria-hidden />
        </Link>
        <Link to={`/lab/trade-check?symbol=${encodeURIComponent(card.symbol)}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          <ClipboardCheck className="size-3.5" aria-hidden /> Check a trade in it
        </Link>
      </div>
    </Frame>
  );
}

function Movers({ card }: { card: Extract<MarketCard, { kind: "movers" }> }) {
  const column = (title: string, rows: ScoredCompany[]) => (
    <div className="min-w-0">
      <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h4>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={row.symbol} className="flex items-baseline justify-between gap-2 text-[13px]">
            <Link to={symbolPath(row.symbol)} className="min-w-0 truncate font-medium text-ink hover:text-accent">{row.symbol}</Link>
            <Signed value={row.change_pct} className="shrink-0 text-xs">{signedPct(row.change_pct)}</Signed>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <Frame title="Today's biggest moves">
      <div className="grid grid-cols-2 gap-x-5">
        {column("Up most", card.gainers)}
        {column("Down most", card.losers)}
      </div>
    </Frame>
  );
}

/** Draws the cards an answer carries. `ask` sends a follow-up question, for the cards that offer one. */
export function MarketCards({ cards, ask }: { cards: MarketCard[]; ask: (question: string) => void }) {
  return (
    <>
      {cards.map((card, i) => {
        switch (card.kind) {
          case "mood": return <Mood key={i} card={card} />;
          case "sectors": return <Sectors key={i} card={card} ask={ask} />;
          case "sector": return <Sector key={i} card={card} ask={ask} />;
          case "ideas": return <Ideas key={i} card={card} ask={ask} />;
          case "companies": return <Companies key={i} card={card} />;
          case "company": return <Company key={i} card={card} />;
          case "movers": return <Movers key={i} card={card} />;
        }
      })}
    </>
  );
}
