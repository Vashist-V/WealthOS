/**
 * The chat the assistants share: a side panel with a greeting, suggested
 * questions and a conversation whose answers arrive as a stream.
 *
 * The stock assistant and the market assistant differ only in what they are
 * asked about and in what an answer can carry beside its words (the market
 * assistant adds cards of scores), so both are this panel with different props.
 */
import { ArrowUp, ExternalLink, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { AssistantQuestion } from "@/lib/api";
import { errorMessage } from "@/lib/queries";
import type { AssistantEvent, AssistantSource, MarketCard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { IconButton, Skeleton } from "../ui";

interface Message {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Where the answer came from: the language model, or the app's data alone. */
  mode?: "ai" | "data";
  sources?: AssistantSource[];
  /** Search-suggestion chips from Google, shown as provided. */
  searchHtml?: string;
  /** The app's own figures for what was asked. */
  cards?: MarketCard[];
  /** Something to know about how the answer was produced. */
  notice?: string;
  /** What the assistant is doing before text arrives, e.g. searching the web. */
  status?: string;
  pending?: boolean;
  failed?: boolean;
}

/** What a chat opens with. */
export interface ChatOpening {
  greeting: string;
  /** False when no AI key is configured: only the suggested questions can be answered, from data. */
  ai: boolean;
  suggestions: { id: string; label: string }[];
}

/** A question handed to the chat from outside it, such as a chip on the page. `key` tells two askings of the same thing apart. */
export interface Asked {
  text: string;
  intent?: string;
  key: number;
}

function load(storageKey: string): Message[] {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as Message[];
  } catch {
    return [];
  }
}

/** **bold** inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Paragraphs, "- " bullets and **bold**: the only formatting the assistants are asked to use. */
export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
    if (bullets.length)
      blocks.push(
        <ul key={blocks.length} className="flex flex-col gap-1.5 pl-1">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[9px] size-1 shrink-0 rounded-full bg-muted" />
              <span className="min-w-0">{inline(b)}</span>
            </li>
          ))}
        </ul>,
      );
    paragraph = [];
    bullets = [];
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      // Models sometimes add headings anyway; show them as a bold line.
      flush();
      blocks.push(
        <p key={blocks.length} className="font-semibold text-ink">
          {heading[1].replace(/\*\*/g, "")}
        </p>,
      );
    } else if (bullet) {
      if (paragraph.length) flush();
      bullets.push(bullet[1]);
    } else if (!line.trim()) {
      flush();
    } else {
      if (bullets.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <div className="flex flex-col gap-2.5 text-[13.5px] leading-relaxed text-ink-2">{blocks}</div>;
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Where an answer's claims came from, and Google's search chips when it used Search. */
export function Sources({ sources, searchHtml }: { sources?: AssistantSource[]; searchHtml?: string }) {
  return (
    <>
      {!!sources?.length && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {sources.map((s) => (
            <a
              key={s.url}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              title={s.title}
              className="inline-flex max-w-full items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-2 ring-1 ring-inset ring-line transition-colors hover:text-accent"
            >
              <span className="truncate">{s.label ?? host(s.url)}</span>
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ))}
        </div>
      )}
      {searchHtml && (
        // Sandboxed: the markup comes from Google and is shown unmodified, but gets no access to the app.
        <iframe
          title="Google Search suggestions"
          srcDoc={searchHtml}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="mt-2.5 h-[52px] w-full rounded-lg border-0 [color-scheme:normal]"
        />
      )}
    </>
  );
}

function Bubble({ message, cards }: { message: Message; /** Draws the cards an answer carries. */ cards?: (cards: MarketCard[]) => ReactNode }) {
  if (message.role === "user")
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[13.5px] leading-relaxed text-on-accent">{message.text}</div>
      </div>
    );
  const waiting = message.pending && !message.text;
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        {waiting ? (
          <div className="flex h-6 items-center gap-2 text-[13px] text-muted" role="status">
            <span className="flex gap-1">
              {[0, 150, 300].map((delay) => (
                <span key={delay} className="size-1.5 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
            {message.status || "Thinking"}
          </div>
        ) : (
          <div className={cn(message.failed && "rounded-xl bg-loss-soft px-3 py-2 [&_p]:text-loss")}>
            <RichText text={message.text} />
            {message.pending && message.status && <p className="mt-2 text-xs text-muted">{message.status}…</p>}
          </div>
        )}
        {!!message.cards?.length && cards && <div className="mt-3 flex flex-col gap-2.5">{cards(message.cards)}</div>}
        <Sources sources={message.sources} searchHtml={message.pending ? undefined : message.searchHtml} />
        {message.notice && !message.pending && <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{message.notice}</p>}
        {message.mode === "data" && !message.notice && !message.pending && !message.failed && <p className="mt-1.5 text-[11px] text-muted">Answered from the app's data, without AI.</p>}
      </div>
    </div>
  );
}

export function ChatPanel({
  storageKey,
  title,
  subtitle,
  opening,
  send,
  placeholder,
  footnote,
  cards,
  asked,
  onAsked,
  onClose,
}: {
  /** Where the conversation is kept for this browser tab. */
  storageKey: string;
  title: string;
  subtitle: string;
  opening: { data?: ChatOpening; isLoading: boolean; isError: boolean; error: unknown };
  send: (body: AssistantQuestion, onEvent: (event: AssistantEvent) => void, signal: AbortSignal) => Promise<void>;
  /** The input's hint when free-form questions can be answered. */
  placeholder: string;
  footnote: string;
  /** Draws the cards an answer carries. It is given a way to ask a follow-up, for cards that offer one. */
  cards?: (cards: MarketCard[], ask: (question: string) => void) => ReactNode;
  /** A question to ask as soon as the panel can, from a chip or a box outside it. */
  asked?: Asked | null;
  /** Called once that question has been put, so it is not put again the next time the panel opens. */
  onAsked?: () => void;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>(() => load(storageKey));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nextId = useRef(messages.reduce((max, m) => Math.max(max, m.id), 0) + 1);
  const used = useRef(new Set<string>());

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(messages.filter((m) => !m.pending).slice(-40)));
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, storageKey]);
  useEffect(() => () => abort.current?.abort(), []);

  const ask = useCallback(
    async (question: string, intent?: string) => {
      const text = question.trim();
      if (!text || busy) return;
      if (intent) used.current.add(intent);
      const history = messages.filter((m) => !m.failed && m.text).map((m) => ({ role: m.role, content: m.text }));
      const userId = nextId.current;
      const replyId = userId + 1;
      nextId.current += 2;
      setMessages((list) => [...list, { id: userId, role: "user", text }, { id: replyId, role: "assistant", text: "", pending: true }]);
      setDraft("");
      setBusy(true);
      const patch = (change: (m: Message) => Message) => setMessages((list) => list.map((m) => (m.id === replyId ? change(m) : m)));
      const controller = new AbortController();
      abort.current = controller;
      try {
        await send(
          { question: text, intent: intent ?? null, history },
          (event) => {
            if (event.type === "meta") patch((m) => ({ ...m, mode: event.mode }));
            else if (event.type === "status") patch((m) => ({ ...m, status: event.text }));
            else if (event.type === "delta") patch((m) => ({ ...m, text: m.text + event.text, status: "" }));
            else if (event.type === "sources") patch((m) => ({ ...m, sources: event.items }));
            else if (event.type === "search_suggestions") patch((m) => ({ ...m, searchHtml: event.html }));
            else if (event.type === "cards") patch((m) => ({ ...m, cards: event.items }));
            else if (event.type === "notice") patch((m) => ({ ...m, notice: event.text }));
            else if (event.type === "error") patch((m) => ({ ...m, text: m.text || event.message, failed: !m.text, pending: false }));
            else if (event.type === "done")
              patch((m) => ({ ...m, pending: false, text: event.truncated ? `${m.text}\n\n(The answer was cut short. Ask me to continue.)` : m.text }));
          },
          controller.signal,
        );
        patch((m) => (m.pending ? { ...m, pending: false, text: m.text || "No answer came back. Try again.", failed: !m.text } : m));
      } catch (error) {
        const stopped = (error as Error).name === "AbortError";
        patch((m) => ({ ...m, pending: false, status: "", text: m.text || (stopped ? "Stopped." : errorMessage(error)), failed: !m.text && !stopped }));
      } finally {
        setBusy(false);
        abort.current = null;
      }
    },
    [busy, messages, send],
  );

  // A question from outside waits its turn if an answer is still arriving.
  const [waiting, setWaiting] = useState<Asked | null>(asked ?? null);
  useEffect(() => {
    if (asked) setWaiting(asked);
  }, [asked?.key]);
  useEffect(() => {
    if (!waiting || busy) return;
    // Asked on the next tick, so a remount in the same breath (as React's strict mode does) cannot cut the request off.
    const timer = window.setTimeout(() => {
      setWaiting(null);
      onAsked?.();
      void ask(waiting.text, waiting.intent);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [waiting, busy]);

  const reset = () => {
    abort.current?.abort();
    used.current.clear();
    setMessages([]);
  };

  const pills = (opening.data?.suggestions ?? []).filter((s) => !used.current.has(s.id));
  const started = messages.length > 0;
  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent ring-1 ring-inset ring-accent/15">
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <RDialog.Title className="truncate text-sm font-semibold text-ink">{title}</RDialog.Title>
          <RDialog.Description className="truncate text-xs text-muted">{subtitle}</RDialog.Description>
        </div>
        {started && (
          <IconButton label="Start a new conversation" onClick={reset}>
            <RotateCcw className="size-4" />
          </IconButton>
        )}
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {opening.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : opening.isError ? (
          <p className="rounded-xl bg-loss-soft px-3 py-2 text-[13px] text-loss">{errorMessage(opening.error)}</p>
        ) : (
          opening.data && (
            <>
              <Bubble message={{ id: 0, role: "assistant", text: opening.data.greeting }} />
              {!opening.data.ai && (
                <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-2 ring-1 ring-line">
                  AI answers are off on this install, so the questions below are answered from the latest data. To ask anything in your own words,
                  add a Gemini or Anthropic API key to the server's <span className="font-mono text-[11px]">backend/.env</span>.
                </p>
              )}
            </>
          )
        )}
        {messages.map((m) => (
          <Bubble key={m.id} message={m} cards={cards && ((items) => cards(items, (question) => void ask(question)))} />
        ))}
      </div>

      <footer className="border-t border-line px-4 pb-3 pt-3">
        {pills.length > 0 && !busy && (
          <div className={cn("mb-2.5 flex gap-1.5", started ? "overflow-x-auto pb-0.5 [scrollbar-width:none]" : "flex-wrap")}>
            {pills.slice(0, started ? 5 : 9).map((s) => (
              <button
                key={s.id}
                onClick={() => void ask(s.label, s.id)}
                className="shrink-0 rounded-full border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-accent/50 hover:bg-accent-soft hover:text-ink"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(draft);
          }}
          className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface-2 py-1.5 pl-3.5 pr-1.5 transition-colors focus-within:border-accent"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            rows={1}
            maxLength={1000}
            aria-label={placeholder}
            placeholder={opening.data?.ai === false ? "Type a question, or pick one above" : placeholder}
            className="max-h-28 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-muted [field-sizing:content]"
          />
          {busy ? (
            <button type="button" aria-label="Stop" onClick={() => abort.current?.abort()} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink transition-colors hover:bg-line-strong">
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button type="submit" aria-label="Send" disabled={!draft.trim()} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-opacity disabled:opacity-35">
              <ArrowUp className="size-4" strokeWidth={2.4} />
            </button>
          )}
        </form>
        <p className="mt-2 text-center text-[11px] text-muted">{footnote}</p>
      </footer>
    </>
  );
}

/** The side panel a chat sits in. It is not modal: the page behind stays scrollable, so a chart can be read while chatting. */
export function ChatDrawer({
  open,
  onOpenChange,
  trigger,
  wide,
  tour,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The button that opens it, when the chat owns one. */
  trigger?: ReactNode;
  wide?: boolean;
  /** Name the hands-on guide points at the panel by. */
  tour?: string;
  children: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Content
          data-tour={tour}
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "fixed inset-0 z-40 flex flex-col bg-surface shadow-pop outline-none data-[state=open]:animate-fade-in sm:inset-y-3 sm:left-auto sm:right-3 sm:rounded-2xl sm:border sm:border-line-strong print:hidden",
            wide ? "sm:w-[460px]" : "sm:w-[420px]",
          )}
        >
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
