/**
 * The market assistant on the Market page: an ask bar, a scoreboard of
 * confidence scores, and the chat they both open.
 *
 * The chat answers from the server's market pulse (scores for the market,
 * every sector and every company). The figures and the cards beside an answer
 * are always the app's own; AI, when the server has a key, writes the words
 * and reads the news for the why.
 *
 * The ask bar is kept to two slim rows so the market itself starts right
 * under it. Once it has scrolled out of view, a small floating button keeps
 * the chat one tap away.
 */
import { ArrowRight, MessagesSquare, Sparkles } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CheckList, Dial, ScorePill } from "@/components/score";
import { Button, Card, DataTable, ErrorState, IconButton, InfoHint, Signed, Skeleton, type Column } from "@/components/ui";
import { askMarket } from "@/lib/api";
import { date, signedPct } from "@/lib/format";
import { useMarketOpening, usePulse } from "@/lib/queries";
import type { MarketCard, PulseSector } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ChatDrawer, ChatPanel, type Asked } from "./Chat";
import { MarketCards } from "./MarketCards";

interface MarketAsk {
  /** Open the chat and ask a question in it. Without one, just open it. */
  ask: (question?: string, intent?: string) => void;
  /** Tells the assistant where the ask bar is, so it knows when the bar has scrolled out of view. */
  watch: (bar: HTMLElement | null) => void;
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
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const [away, setAway] = useState(false);
  const opening = useMarketOpening();
  const ask = useCallback((question?: string, intent?: string) => {
    if (question?.trim()) setAsked({ text: question, intent, key: Date.now() });
    setOpen(true);
  }, []);
  const value = useMemo(() => ({ ask, watch: setBar }), [ask]);
  const cards = useCallback((items: MarketCard[], follow: (question: string) => void) => <MarketCards cards={items} ask={follow} />, []);

  useEffect(() => {
    if (!bar) return;
    const seen = new IntersectionObserver(([entry]) => setAway(!entry.isIntersecting));
    seen.observe(bar);
    return () => seen.disconnect();
  }, [bar]);

  return (
    <AskContext.Provider value={value}>
      {children}
      {away &&
        !open &&
        // Placed on the page itself, not inside the Market page's own box: that box is animated, and an
        // animated box becomes what "fixed" is measured from, which would pin the button to it, not the screen.
        createPortal(
          <button
            type="button"
            onClick={() => ask()}
            className="fixed bottom-[76px] right-4 z-30 inline-flex h-11 animate-pop items-center gap-2 rounded-full bg-accent pl-3.5 pr-4 text-sm font-medium text-on-accent shadow-lg shadow-accent/30 transition-transform hover:scale-[1.03] active:scale-95 lg:bottom-6 lg:right-6 print:hidden"
          >
            <Sparkles className="size-4" aria-hidden />
            Ask the market
          </button>,
          document.body,
        )}
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

// What the box suggests typing, one at a time, so it shows what can be asked without a paragraph of explanation.
const EXAMPLES = [
  "Why did the market move today?",
  "I have ₹50,000. Which sector looks best for the long term?",
  "Is it a good time for IT stocks?",
  "Which companies score highest right now?",
];

/** The bar at the top of the Market page: type a question or pick one, and the chat opens with the answer. */
export function AskBar({ className }: { className?: string }) {
  const { ask, watch } = useMarketAsk();
  const opening = useMarketOpening();
  const [draft, setDraft] = useState("");
  const [example, setExample] = useState(0);
  const [wide] = useState(() => window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    if (draft) return;
    const turn = window.setInterval(() => setExample((i) => (i + 1) % EXAMPLES.length), 3500);
    return () => window.clearInterval(turn);
  }, [draft]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(draft);
    setDraft("");
  };
  return (
    <section ref={watch} data-tour="market-ask" aria-label="Ask about the market" className={cn("card overflow-hidden transition-colors focus-within:border-accent/60", className)}>
      <form onSubmit={submit} className="flex items-center gap-1.5 py-1.5 pl-3 pr-1.5 sm:gap-2 sm:pl-4">
        <Sparkles className="size-[18px] shrink-0 text-accent" aria-hidden />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1000}
          aria-label="Ask about the market"
          // A phone has room for the example alone; the example is a question, which says enough.
          placeholder={wide ? `Ask the market: ${EXAMPLES[example]}` : EXAMPLES[example]}
          className="h-10 min-w-0 flex-1 bg-transparent pl-1 text-[15px] text-ink outline-none placeholder:text-muted"
        />
        <IconButton label="Open the conversation" onClick={() => ask()}>
          <MessagesSquare className="size-[18px]" />
        </IconButton>
        <Button variant="primary" size="sm" type="submit" aria-label="Ask" className="rounded-[9px] max-sm:w-8 max-sm:px-0" disabled={!draft.trim()}>
          <span className="max-sm:hidden">Ask</span> <ArrowRight className="size-3.5" />
        </Button>
      </form>
      {/* One line of ready-made questions that slides sideways, instead of several rows of them. */}
      <div className="relative border-t border-line bg-surface-2/50">
        <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] sm:px-4 [&::-webkit-scrollbar]:hidden">
          {(opening.data?.suggestions ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => ask(s.label, s.id)}
              className="shrink-0 whitespace-nowrap rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-ink"
            >
              {s.label}
            </button>
          ))}
          <span className="w-6 shrink-0" aria-hidden />
        </div>
        <span className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface to-transparent" aria-hidden />
      </div>
    </section>
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
