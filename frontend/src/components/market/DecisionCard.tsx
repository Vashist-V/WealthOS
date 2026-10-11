/**
 * A company in the questions a newcomer asks of it: does it earn well, is it
 * growing, does it owe too much, is the price reasonable, and so on.
 *
 * The answers are the market pulse's own checks, grouped by the server. This
 * card says where the company stands today on each question. It deliberately
 * stops short of "buy" or "don't": that turns on the price paid and on what
 * else is held, which is what Trade check looks at.
 */
import { ChevronDown, Scale } from "lucide-react";
import { Link } from "react-router-dom";
import { TradeCheckButton } from "@/components/QuickTradeCheck";
import { CheckList, ScorePill, VerdictMark } from "@/components/score";
import { Card, CardSkeleton } from "@/components/ui";
import { date } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useStockCard } from "@/lib/queries";
import type { CardArea, CompanyCard, Score } from "@/lib/types";

/** The address of a side-by-side comparison of the given companies. */
export const comparePath = (symbols: string[]): string => `/market/compare?symbols=${symbols.map(encodeURIComponent).join(",")}`;

function Reading({ label, score, hint }: { label: string; score: Score; hint: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3" title={hint}>
      <ScorePill value={score.value} tone={score.tone} className="h-8 min-w-11 text-sm" />
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        <div className="truncate text-[13px] font-medium text-ink">{score.label}</div>
      </div>
    </div>
  );
}

/** One question: the mark, the answer in a few words, and the checks behind it on request. */
export function AreaTile({ area }: { area: CardArea }) {
  return (
    <details className="group rounded-xl bg-surface-2 ring-1 ring-inset ring-line open:bg-surface">
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <VerdictMark verdict={area.verdict} plain className="mt-0.5 size-5" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium leading-snug text-ink">{area.question}</span>
          <span className="num mt-0.5 block truncate text-xs text-ink-2">{area.reading}</span>
        </span>
        <ChevronDown className="mt-1 size-3.5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-3 pb-2">
        <CheckList checks={area.checks} />
      </div>
    </details>
  );
}

function Body({ card }: { card: CompanyCard }) {
  const { id } = usePortfolio();
  return (
    <Card
      tour="stock-card"
      title="The company in seven questions"
      description="Where it stands today on each. Open one to see the check behind it."
      action={<TradeCheckButton symbol={card.symbol} portfolio={id}>Check a trade</TradeCheckButton>}
    >
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Reading label="For holding a year or more" score={card.score.long} hint="Trend, valuation, the business and risk, taken together." />
        <Reading label="For the next few weeks" score={card.score.short} hint="Price behaviour only: trend and risk." />
      </div>

      <div className="mt-4 grid items-start gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {card.areas.map((area) => (
          <AreaTile key={area.id} area={area} />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3.5">
        {card.peers.length > 0 && (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <Scale className="size-3.5" aria-hidden /> Set it beside
            </span>
            {card.peers.slice(0, 3).map((peer) => (
              <Link
                key={peer.symbol}
                to={comparePath([card.symbol, peer.symbol])}
                title={`${card.name} and ${peer.name}, side by side`}
                className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line transition-colors hover:text-ink hover:ring-line-strong"
              >
                {peer.symbol}
                <span className="num text-muted">{peer.score}</span>
              </Link>
            ))}
          </>
        )}
        <span className="ml-auto text-xs text-muted">
          A score sums up evidence as it stands; it is not advice.{card.figures_as_of ? ` Company figures as of ${date(card.figures_as_of)}.` : ""}
        </span>
      </div>
    </Card>
  );
}

/** Nothing is drawn for an index, a fund, or a company the app does not score. */
export function DecisionCard({ symbol, className }: { symbol: string; className?: string }) {
  const card = useStockCard(symbol);
  if (card.isLoading) return <CardSkeleton height={180} className={className} />;
  if (!card.data || !card.data.available) return null;
  return (
    <div className={className}>
      <Body card={card.data} />
    </div>
  );
}
