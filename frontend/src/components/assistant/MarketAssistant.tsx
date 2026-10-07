/**
 * The market assistant on the Market page: an ask bar, a scoreboard of
 * confidence scores, and the chat they both open.
 *
 * The chat answers from the server's market pulse (scores for the market,
 * every sector and every company). The figures and the cards beside an answer
 * are always the app's own; AI, when the server has a key, writes the words
 * and reads the news for the why.
 */
import { ArrowRight, MessagesSquare, Sparkles } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CheckList, Dial, ScorePill } from "@/components/score";
import { Button, Card, DataTable, ErrorState, InfoHint, Signed, Skeleton, type Column } from "@/components/ui";
import { askMarket } from "@/lib/api";
import { date, signedPct } from "@/lib/format";
import { useMarketOpening, usePulse } from "@/lib/queries";
import type { MarketCard, PulseSector } from "@/lib/types";
import { ChatDrawer, ChatPanel, type Asked } from "./Chat";
import { MarketCards } from "./MarketCards";

interface MarketAsk {
  /** Open the chat and ask a question in it. Without one, just open it. */
  ask: (question?: string, intent?: string) => void;
}

const AskContext = createContext<MarketAsk | null>(null);

function useMarketAsk(): MarketAsk {
  const ctx = useContext(AskContext);
  if (!ctx) throw new Error("useMarketAsk must be used inside MarketAssistant");
  return ctx;
}

/** Holds the chat for the Market page. The ask bar and the scoreboard inside it can open the chat with a question. */
export function MarketAssistant({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState<Asked | null>(null);
  const opening = useMarketOpening();
  const ask = useCallback((question?: string, intent?: string) => {
    if (question?.trim()) setAsked({ text: question, intent, key: Date.now() });
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ ask }), [ask]);
  const cards = useCallback((items: MarketCard[], follow: (question: string) => void) => <MarketCards cards={items} ask={follow} />, []);
  return (
    <AskContext.Provider value={value}>
      {children}
      <ChatDrawer open={open} onOpenChange={setOpen} wide tour="market-chat">
        <ChatPanel
          storageKey="wealthos.assistant.market"
          title="Ask about the market"
          subtitle="Scores for the market, every sector and every company"
          opening={opening}
          send={askMarket}
          placeholder="Ask about today, a sector, or where a sum could go"
          footnote="Scores sum up evidence as it stands today. Not investment advice."
          cards={cards}
          asked={asked}
          onAsked={() => setAsked(null)}
          onClose={() => setOpen(false)}
        />
      </ChatDrawer>
    </AskContext.Provider>
  );
}

/** The box at the top of the Market page: type a question or pick one, and the chat opens with the answer. */
export function AskBar({ className }: { className?: string }) {
  const { ask } = useMarketAsk();
  const opening = useMarketOpening();
  const [draft, setDraft] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
    setDraft("");
  };
  return (
    <Card tour="market-ask" className={className} bodyClassName="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent ring-1 ring-inset ring-accent/15">
            <Sparkles className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Ask about the market</h2>
            <p className="text-[13px] text-muted">What happened and why, which sectors look strong, where a sum of money could go. Every answer carries a confidence score.</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" icon={<MessagesSquare className="size-4" />} onClick={() => ask()}>
          Open the chat
        </Button>
      </div>
      <form onSubmit={submit} className="flex items-center gap-2 rounded-2xl border border-line-strong bg-surface-2 py-1.5 pl-4 pr-1.5 transition-colors focus-within:border-accent">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1000}
          aria-label="Ask about the market"
          placeholder="For example: I have ₹50,000, which sector looks best for the long term?"
          className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
        <Button variant="primary" size="sm" type="submit" className="rounded-xl" disabled={!draft.trim()}>
          Ask <ArrowRight className="size-3.5" />
        </Button>
      </form>
      <div className="flex min-h-8 flex-wrap gap-1.5">
        {opening.isLoading
          ? [200, 168, 184, 152].map((width) => <div key={width} className="skeleton h-8 rounded-full" style={{ width }} aria-hidden />)
          : (opening.data?.suggestions ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => ask(s.label, s.id)}
                className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-ink"
              >
                {s.label}
              </button>
            ))}
      </div>
    </Card>
  );
}

/** The market mood and every sector's confidence score, side by side. Selecting a sector asks the chat about it. */
export function Scoreboard({ className }: { className?: string }) {
  const { ask } = useMarketAsk();
  const pulse = usePulse();
  const data = pulse.data;

  const columns: Column<PulseSector>[] = [
    {
      key: "name", header: "Sector", sort: (r) => r.name,
      cell: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-ink group-hover/row:text-accent">{r.name}</div>
          <div className="truncate text-xs text-muted">{r.count} companies{r.leaders.long[0] ? ` · led by ${r.leaders.long[0].symbol}` : ""}</div>
        </div>
      ),
    },
    { key: "today", header: "Today", align: "right", sort: (r) => r.change_pct, cell: (r) => <Signed value={r.change_pct}>{signedPct(r.change_pct)}</Signed> },
    { key: "month", header: "1 month", align: "right", hide: "sm", sort: (r) => r.returns["1 month"], cell: (r) => <Signed value={r.returns["1 month"]}>{signedPct(r.returns["1 month"], 1)}</Signed> },
    {
      key: "short", header: "Short term", align: "right", sort: (r) => r.score.short.value,
      hint: "How the sector's prices are behaving now: how many of its companies are in an uptrend, and how it compares with the market. Out of 100; 50 is an even split.",
      cell: (r) => <ScorePill value={r.score.short.value} tone={r.score.short.tone} />,
    },
    {
      key: "long", header: "Long term", align: "right", sort: (r) => r.score.long.value,
      hint: "Adds the businesses themselves: growth, profit on shareholders' money and what the sector costs. Out of 100; 50 is an even split.",
      cell: (r) => <ScorePill value={r.score.long.value} tone={r.score.long.tone} />,
    },
  ];

  return (
    <Card
      tour="market-scores"
      title="Confidence scores"
      description={data?.as_of ? `How the evidence stacks up for the market and each sector, at prices as of ${date(data.as_of)}` : "How the evidence stacks up for the market and each sector"}
      className={className}
      flush
    >
      {pulse.isError && !data ? (
        <ErrorState error={pulse.error} onRetry={() => pulse.refetch()} />
      ) : !data ? (
        <div className="grid gap-4 px-4 pb-4 sm:px-5 sm:pb-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="grid xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="border-b border-line px-4 pb-4 sm:px-5 xl:border-b-0 xl:border-r xl:pb-5">
            <div className="flex items-center gap-1.5 text-[13px] text-muted">
              Market mood
              <InfoHint text="How the market as a whole is behaving: the index against its averages, how many stocks are taking part, new highs against lows, and the fear gauge. Out of 100; 50 is an even split. It reads the present; it does not predict." />
            </div>
            <Dial value={data.mood.score.value} tone={data.mood.score.tone} className="mt-2 max-w-[200px]" />
            <p className="mt-6 text-balance text-center text-sm font-semibold tracking-tight text-ink">{data.mood.score.label}</p>
            <CheckList checks={data.mood.checks} className="mt-3" />
            <Button variant="ghost" size="sm" className="mt-2 w-full text-accent" onClick={() => ask("Is this a good time to invest?", "mood")}>
              Ask what this means <ArrowRight className="size-3.5" />
            </Button>
          </div>
          <div className="min-w-0">
            <DataTable
              columns={columns}
              rows={data.sectors}
              rowKey={(r) => r.name}
              defaultSort={{ key: "short", dir: "desc" }}
              onRowClick={(r) => ask(`Is it a good time for ${r.name} stocks?`)}
              dense
            />
            <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-muted sm:px-5">
              Select a sector to ask about it. A score counts how the checks line up today; it is not a forecast and not advice.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
