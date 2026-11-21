/**
 * News pieces shared by the News page, the dashboard and the holdings page:
 * a headline marked good, bad or neutral for its stock, a company's news
 * signal, and the "News about your stocks" card.
 */
import { ArrowRight, ExternalLink, Minus, Newspaper, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";
import { ScorePill } from "@/components/score";
import { Badge, Card, Skeleton } from "@/components/ui";
import { useNews } from "@/lib/queries";
import type { NewsItem, NewsStock, NewsTone } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";

export const TONE: Record<NewsTone, { label: string; tone: "gain" | "loss" | "neutral"; icon: typeof TrendingUp; bar: string }> = {
  good: { label: "Good", tone: "gain", icon: TrendingUp, bar: "bg-gain" },
  bad: { label: "Bad", tone: "loss", icon: TrendingDown, bar: "bg-loss" },
  neutral: { label: "Neutral", tone: "neutral", icon: Minus, bar: "bg-line-strong" },
};

/** "Just now", "3h ago", "2d ago". */
export function ago(iso: string): string {
  const minutes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

export function ToneBadge({ tone, className }: { tone: NewsTone; className?: string }) {
  const meta = TONE[tone];
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} className={className}>
      <Icon className="size-3" aria-hidden />
      {meta.label}
      <span className="sr-only"> for the stock</span>
    </Badge>
  );
}

/** One headline: what it is, whether it is good or bad for the stock and why, and where it came from. */
export function NewsRow({ item, compact, onStock }: { item: NewsItem; compact?: boolean; /** Filter by a stock instead of opening its page. */ onStock?: (symbol: string) => void }) {
  return (
    <li className="relative flex gap-3 py-3 pl-3.5 pr-1">
      <span className={cn("absolute inset-y-3 left-0 w-1 rounded-full", TONE[item.tone].bar)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <ToneBadge tone={item.tone} />
          {item.impact === "high" && item.tone !== "neutral" && <Badge tone="warn">Big news</Badge>}
          {item.why && item.tone !== "neutral" && <span className="text-xs font-medium text-ink-2">{item.why}</span>}
        </div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn("mt-1 block font-medium leading-snug text-ink hover:text-accent", compact ? "text-[13px]" : "text-sm")}
        >
          {item.title}
          <ExternalLink className="ml-1 inline size-3 align-baseline text-muted" aria-hidden />
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {item.symbols.slice(0, 3).map((s) =>
            onStock ? (
              <button key={s} type="button" onClick={() => onStock(s)} className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink-2 ring-1 ring-inset ring-line hover:text-accent" title={item.names[s]}>
                {s}
              </button>
            ) : (
              <Link key={s} to={symbolPath(s)} className="rounded bg-surface-2 px-1.5 py-0.5 font-medium text-ink-2 ring-1 ring-inset ring-line hover:text-accent" title={item.names[s]}>
                {s}
              </Link>
            ),
          )}
          {item.held && <span className="font-medium text-accent">You hold this</span>}
          <span>{item.source}</span>
          <span aria-hidden>·</span>
          <time dateTime={item.published}>{ago(item.published)}</time>
        </div>
      </div>
    </li>
  );
}

const SIGNAL = {
  good: { label: "Good signs", ring: "ring-gain/40 bg-gain-soft/50", text: "text-gain" },
  bad: { label: "Needs watching", ring: "ring-loss/35 bg-loss-soft/50", text: "text-loss" },
  mixed: { label: "Mixed news", ring: "ring-line bg-surface", text: "text-ink-2" },
  quiet: { label: "Quiet", ring: "ring-line bg-surface", text: "text-muted" },
} as const;

/** A company's past week of news in one card: green for good signs, red for news worth watching. */
export function SignalCard({ stock, active, onPick }: { stock: NewsStock; active?: boolean; onPick?: (symbol: string) => void }) {
  const meta = SIGNAL[stock.signal];
  return (
    <button
      type="button"
      onClick={() => onPick?.(stock.symbol)}
      aria-pressed={active}
      className={cn(
        "flex w-full min-w-0 flex-col rounded-xl px-3.5 py-3 text-left ring-1 ring-inset transition-shadow hover:shadow-md",
        meta.ring,
        active && "outline outline-2 outline-offset-2 outline-accent",
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="text-sm font-semibold text-ink">{stock.symbol}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{stock.name}</span>
        {stock.score && <ScorePill value={stock.score.value} tone={stock.score.tone} />}
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-xs">
        <span className={cn("font-semibold", meta.text)}>{meta.label}</span>
        <span className="text-muted">
          <span className="text-gain">{stock.good} good</span> · <span className="text-loss">{stock.bad} bad</span>
        </span>
        {stock.held && <span className="ml-auto font-medium text-accent">You hold</span>}
      </div>
      {stock.highlights.length > 0 && <p className="mt-1 line-clamp-1 text-xs text-ink-2">{stock.highlights.join(" · ")}</p>}
    </button>
  );
}

/** The latest news about the user's own stocks, for the dashboard and the holdings page. */
export function HoldingsNews({ className, limit = 6 }: { className?: string; limit?: number }) {
  const news = useNews({ scope: "mine", limit: 40 });
  const data = news.data;
  const items = (data?.items ?? []).slice(0, limit);
  const week = data?.stocks ?? [];
  const good = week.reduce((n, s) => n + s.good, 0);
  const bad = week.reduce((n, s) => n + s.bad, 0);
  const watch = week.filter((s) => s.signal === "bad").map((s) => s.symbol);
  const bright = week.filter((s) => s.signal === "good").map((s) => s.symbol);
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Newspaper className="size-4 text-accent" aria-hidden /> News about your stocks
        </span>
      }
      description={data && data.held.length ? `${good} good and ${bad} bad headlines this week, for the stocks you hold` : "Headlines about what you hold, marked good or bad for each stock"}
      className={className}
      action={
        <Link to="/news?scope=mine" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
          All news <ArrowRight className="size-3" />
        </Link>
      }
    >
      {!data ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : !data.held.length ? (
        <p className="py-4 text-center text-[13px] text-muted">Once you hold stocks, news about them shows up here.</p>
      ) : !items.length ? (
        <p className="py-4 text-center text-[13px] text-muted">No news about your stocks in the past two weeks.</p>
      ) : (
        <>
          {(bright.length > 0 || watch.length > 0) && (
            <div className="mb-1 flex flex-wrap gap-1.5 text-xs">
              {bright.length > 0 && <Badge tone="gain"><TrendingUp className="size-3" aria-hidden /> Good signs: {bright.slice(0, 4).join(", ")}</Badge>}
              {watch.length > 0 && <Badge tone="loss"><TrendingDown className="size-3" aria-hidden /> Needs watching: {watch.slice(0, 4).join(", ")}</Badge>}
            </div>
          )}
          <ul className="grid divide-y divide-line lg:grid-cols-2 lg:gap-x-6 lg:divide-y-0 [&>li]:lg:border-b [&>li]:lg:border-line">
            {items.map((item) => <NewsRow key={item.id} item={item} compact />)}
          </ul>
          {data.ai && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted">
              <Sparkles className="size-3" aria-hidden /> Good or bad is judged by AI from the headline. Read the article before acting on it.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
