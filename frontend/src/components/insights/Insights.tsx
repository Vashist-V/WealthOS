/**
 * The newcomer's view of a portfolio: how sound it is, why its value moved, and
 * the few things worth knowing today. Each is a card on the dashboard that opens
 * to the full reasoning, so the first screen stays short.
 *
 * Nothing here is worked out in the browser. The server sends the score, the
 * checks behind it and the sentences; this file only draws them.
 */
import { Activity, AlertTriangle, ArrowRight, CalendarClock, Check, ChevronRight, Compass, HeartPulse, Target, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CheckList, Dial, VerdictMark } from "@/components/score";
import { Button, Card, CardSkeleton, Dialog, ErrorState, InfoHint, Signed, Skeleton } from "@/components/ui";
import { date, signedInr, signedPct } from "@/lib/format";
import type { BriefItem, Movement, PortfolioHealth, TradeCheckItem } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";

/** The two panels a dashboard card can open. The server names them the same way in a brief item's link. */
export type Panel = "health" | "movement";

/** What a card needs to draw itself before, without and with its data. */
interface Loadable {
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}

function Unavailable({ title, error, onRetry, className }: Loadable & { title: string }) {
  return (
    <Card title={title} className={className}>
      <ErrorState error={error} onRetry={onRetry} className="py-6" />
    </Card>
  );
}

// -------------------------------------------------------------- questions
const QUESTIONS: { icon: LucideIcon; title: string; sub: string; panel?: Panel; to?: string }[] = [
  { icon: HeartPulse, title: "Understand my portfolio", sub: "What it is made of, in plain words", panel: "health" },
  { icon: Activity, title: "Why did it move?", sub: "Which holdings did it, and how much was the market", panel: "movement" },
  { icon: Compass, title: "What could I look into next?", sub: "Sectors and companies, each with a score", to: "/market" },
  { icon: Target, title: "Am I on track for my goals?", sub: "A target, a date and a monthly amount", to: "/goals" },
];

/** The questions a newcomer arrives with, each one tap from its answer. */
export function Questions({ onOpen, className }: { onOpen: (panel: Panel) => void; className?: string }) {
  const tile = "group flex min-w-0 items-start gap-3 rounded-[12px] border border-line bg-surface px-3.5 py-3 text-left shadow-card transition-colors hover:border-line-strong";
  return (
    <nav aria-label="Start from a question" data-tour="dash-questions" className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {QUESTIONS.map((q) => {
        const body = (
          <>
            <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-accent-soft text-accent">
              <q.icon className="size-4" strokeWidth={2.2} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-snug text-ink">{q.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted max-sm:hidden">{q.sub}</span>
            </span>
          </>
        );
        return q.panel ? (
          <button key={q.title} type="button" className={tile} onClick={() => onOpen(q.panel!)}>
            {body}
          </button>
        ) : (
          <Link key={q.title} to={q.to!} className={tile}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}

// ----------------------------------------------------------------- health
/** The checks that most deserve a reader's eye: what goes against the portfolio first, then what sits in between, heaviest first. */
function flagged(health: PortfolioHealth): TradeCheckItem[] {
  const all = health.groups.flatMap((g) => g.checks);
  const rank = (c: TradeCheckItem) => (c.verdict === "against" ? 0 : 1);
  return all.filter((c) => c.verdict === "against" || c.verdict === "neutral").sort((a, b) => rank(a) - rank(b) || b.weight - a.weight);
}

function Tally({ health }: { health: PortfolioHealth }) {
  const s = health.score;
  const parts: [number, string, string][] = [
    [s.for, "going well", "bg-gain"],
    [s.neutral, "in between", "bg-muted"],
    [s.against, "worth a look", "bg-loss"],
  ];
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
      {parts.map(([count, label, dot]) => (
        <li key={label} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", dot)} aria-hidden />
          <span className="num font-semibold text-ink">{count}</span> {label}
        </li>
      ))}
    </ul>
  );
}

export function HealthCard({ health, onOpen, error, onRetry, className }: Loadable & { health: PortfolioHealth | undefined; onOpen: () => void }) {
  if (error) return <Unavailable title="Portfolio health" error={error} onRetry={onRetry} className={className} />;
  if (!health) return <CardSkeleton height={300} className={className} />;
  const worth = flagged(health);
  // Always five lines: what to look at first, then the strongest of what is going well.
  const rest = health.groups.flatMap((g) => g.checks).filter((c) => c.verdict === "for").sort((a, b) => b.weight - a.weight);
  const lines = [...worth, ...rest].slice(0, 5);
  return (
    <Card
      tour="dash-health"
      title="Portfolio health"
      description="How it is built and how it has behaved"
      className={className}
      bodyClassName="flex flex-col"
      action={<InfoHint text="A score out of 100 from plain checks on spread, concentration, risk, cash and the past year against the index. It describes the portfolio; it is not a forecast or advice." />}
    >
      <Dial value={health.score.value} tone={health.score.tone} name="Health score" className="max-w-[212px]" />
      <p className="mt-7 text-center text-[15px] font-semibold tracking-tight text-ink">{health.score.label}</p>
      <div className="mt-2">
        <Tally health={health} />
      </div>
      <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-3.5">
        {lines.map((c) => (
          <li key={c.id} className="flex items-center gap-2.5">
            <VerdictMark verdict={c.verdict} plain className="size-5" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{c.title}</span>
            <span className="num shrink-0 text-xs text-ink-2">{c.reading}</span>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-4">
        <Button className="w-full" icon={<HeartPulse className="size-4" />} onClick={onOpen}>
          See what is behind the score
        </Button>
      </div>
    </Card>
  );
}

function Finding({ check }: { check: TradeCheckItem }) {
  return (
    <li className="flex gap-2.5 py-2.5">
      <VerdictMark verdict={check.verdict} plain className="mt-px size-5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium text-ink">{check.title}</span>
          <span className="num shrink-0 text-xs text-ink-2">{check.reading}</span>
        </div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{check.detail}</p>
        <details className="mt-1">
          <summary className="cursor-pointer list-none text-xs font-medium text-accent [&::-webkit-details-marker]:hidden">What this measures</summary>
          <p className="mt-1 text-xs leading-relaxed text-muted">{check.learn}</p>
        </details>
      </div>
    </li>
  );
}

function Heading({ children, count }: { children: ReactNode; count: number }) {
  return (
    <h3 className="mt-5 flex items-center gap-2 text-[13px] font-semibold text-ink">
      {children}
      <span className="num rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-2 ring-1 ring-inset ring-line">{count}</span>
    </h3>
  );
}

/** "Understand my portfolio": the score taken apart, what to look at first. */
export function HealthDialog({ open, onOpenChange, health, benchmark }: { open: boolean; onOpenChange: (open: boolean) => void; health: PortfolioHealth | undefined; benchmark?: string }) {
  const all = health?.groups.flatMap((g) => g.checks) ?? [];
  const worth = health ? flagged(health) : [];
  const well = all.filter((c) => c.verdict === "for");
  const unknown = all.filter((c) => c.verdict === "unknown");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Understand my portfolio"
      description="The health score, taken apart check by check."
      footer={
        <>
          {/* Leaving the page closes the panel; closing it here as well would race the navigation. */}
          <Link to="/xray">
            <Button variant="ghost">
              Open the full X-Ray <ArrowRight className="size-4" aria-hidden />
            </Button>
          </Link>
          <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
        </>
      }
    >
      {!health ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <div className="flex flex-col items-center gap-x-6 gap-y-7 sm:flex-row">
            <Dial value={health.score.value} tone={health.score.tone} name="Health score" className="shrink-0 sm:mx-0 sm:mb-5 sm:w-[200px]" />
            <div className="min-w-0 max-sm:text-center">
              <p className="text-base font-semibold tracking-tight text-ink">{health.score.label}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{health.summary}</p>
              <div className="mt-2.5 sm:[&>ul]:justify-start">
                <Tally health={health} />
              </div>
            </div>
          </div>

          {worth.length > 0 && (
            <>
              <Heading count={worth.length}>Worth a look</Heading>
              <ul className="mt-1 divide-y divide-line">
                {worth.map((c) => (
                  <Finding key={c.id} check={c} />
                ))}
              </ul>
            </>
          )}
          {well.length > 0 && (
            <>
              <Heading count={well.length}>Going well</Heading>
              <CheckList checks={well} className="mt-1" />
            </>
          )}
          {unknown.length > 0 && (
            <>
              <Heading count={unknown.length}>Not enough history yet</Heading>
              <CheckList checks={unknown} className="mt-1" />
            </>
          )}

          <p className="mt-5 rounded-xl bg-surface-2 px-3.5 py-3 text-xs leading-relaxed text-muted ring-1 ring-inset ring-line">
            <span className="font-medium text-ink-2">How the score is worked out.</span> It starts at 50. Every check that goes well moves it up and every one that goes against moves it down, by more
            when the check matters more; the ones in between leave it where it is. It is plain arithmetic, the same for everyone. A score of 100 means every check passed, not that the portfolio
            cannot fall: it describes how the portfolio is built and how it behaved{benchmark ? ` beside ${benchmark}` : ""}, and says nothing about what the market will do next.
          </p>
        </>
      )}
    </Dialog>
  );
}

// --------------------------------------------------------------- movement
/** One line of a breakdown: a name, a bar sized against the largest mover, and the rupees it added or took. */
function Impact({ name, title, to, amount, share, max }: { name: string; title?: string; to?: string; amount: number; share?: number | null; max: number }) {
  const width = `${Math.max(3, Math.min(100, (Math.abs(amount) / max) * 100))}%`;
  return (
    <li className={cn("grid items-center gap-x-3 py-1.5", share === undefined ? "grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto_2.25rem]")}>
      <span className="truncate text-[13px] font-medium text-ink" title={title ?? name}>
        {to ? <Link to={to} className="hover:underline">{name}</Link> : name}
      </span>
      <span className="h-2 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        <span className="block h-full rounded-full" style={{ width, background: amount < 0 ? "var(--loss)" : "var(--gain)" }} />
      </span>
      <Signed value={amount} className="num min-w-[4.5rem] text-right text-[13px] font-medium">{signedInr(amount)}</Signed>
      {share !== undefined && <span className="num text-right text-xs text-muted">{share == null ? "" : `${share.toFixed(0)}%`}</span>}
    </li>
  );
}

const largest = (rows: { day_pnl: number }[]) => Math.max(1, ...rows.map((r) => Math.abs(r.day_pnl)));

export function MovementCard({ movement, onOpen, error, onRetry, className }: Loadable & { movement: Movement | undefined; onOpen: () => void }) {
  if (error) return <Unavailable title="Why it moved" error={error} onRetry={onRetry} className={className} />;
  if (!movement) return <CardSkeleton height={220} className={className} />;
  const rows = movement.holdings.slice(0, 4);
  const max = largest(movement.holdings);
  return (
    <Card
      tour="dash-movement"
      title={`Why it moved ${movement.when}`}
      description={movement.market ? `${movement.market.benchmark} ${signedPct(movement.market.change_pct)}` : "By rupee impact on this portfolio"}
      className={className}
      bodyClassName="flex flex-col"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <Signed value={movement.day_pnl} className="num text-[26px] font-semibold leading-none tracking-tight">{signedInr(movement.day_pnl)}</Signed>
        <Signed value={movement.day_pct} className="num text-[13px] font-medium">{signedPct(movement.day_pct)}</Signed>
      </div>
      {movement.cause && <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{movement.cause}</p>}
      {rows.length > 0 ? (
        <ul className="mt-3 border-t border-line pt-2">
          {rows.map((h) => (
            <Impact key={h.symbol} name={h.symbol} title={h.name} to={symbolPath(h.symbol)} amount={h.day_pnl} max={max} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted">No holding changed in price.</p>
      )}
      <div className="mt-auto pt-3.5">
        <Button className="w-full" icon={<Activity className="size-4" />} onClick={onOpen}>
          See the full breakdown
        </Button>
      </div>
    </Card>
  );
}

function Part({ label, value, children, hint }: { label: string; value: number; children: string; hint?: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="truncate">{label}</span>
        {hint && <InfoHint text={hint} />}
      </div>
      <Signed value={value} className="num mt-0.5 block truncate text-[17px] font-semibold tracking-tight">{children}</Signed>
    </div>
  );
}

/** "Why did it move?": the day's change split by holding, by sector, and into the market's part and the holdings' own. */
export function MovementDialog({ open, onOpenChange, movement }: { open: boolean; onOpenChange: (open: boolean) => void; movement: Movement | undefined }) {
  const down = (movement?.day_pnl ?? 0) < 0;
  const share = `Share of the ${down ? "falls" : "gains"}`;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={movement ? `Why your portfolio moved ${movement.when}` : "Why your portfolio moved"}
      description={movement && !movement.is_today && movement.as_of ? `Prices are from ${date(movement.as_of)}, the latest trading day.` : "The change in value since the previous close."}
      footer={<Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>}
    >
      {!movement ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Signed value={movement.day_pnl} className="num text-[32px] font-semibold leading-none tracking-[-0.02em]">{signedInr(movement.day_pnl)}</Signed>
            <Signed value={movement.day_pct} className="num text-sm font-medium">{signedPct(movement.day_pct)}</Signed>
          </div>
          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-2">{movement.summary}</p>

          {movement.market && (
            <section className="mt-4 rounded-xl bg-surface-2 p-3.5 ring-1 ring-inset ring-line">
              <h3 className="text-[13px] font-semibold text-ink">The market's part and your holdings' own</h3>
              <div className="mt-3 grid gap-x-3 gap-y-1.5 sm:grid-cols-3">
                <Part label={movement.market.benchmark} value={movement.market.change_pct}>{signedPct(movement.market.change_pct)}</Part>
                <Part
                  label="The market's part"
                  value={movement.market.expected_pnl}
                  hint={`What holdings that follow the index the way yours usually do would have gained or lost on the index's move alone. Yours have moved ${movement.market.beta.toFixed(2)} times as much as the index over the past year.`}
                >
                  {signedInr(movement.market.expected_pnl)}
                </Part>
                <Part label="Your holdings' own" value={movement.market.own_pnl} hint="What is left over: news and price moves particular to the companies you hold.">
                  {signedInr(movement.market.own_pnl)}
                </Part>
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{movement.market.summary}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">An estimate from how closely each holding has followed the index over the past year, not an exact split.</p>
            </section>
          )}

          <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
            <section>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-ink">By holding</h3>
                <span className="text-[11px] text-muted">{share}</span>
              </div>
              {movement.holdings.length ? (
                <ul className="mt-1.5">
                  {movement.holdings.map((h) => (
                    <Impact key={h.symbol} name={h.symbol} title={h.name} to={symbolPath(h.symbol)} amount={h.day_pnl} share={h.share} max={largest(movement.holdings)} />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">No holding changed in price.</p>
              )}
            </section>
            <section>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[13px] font-semibold text-ink">By sector</h3>
                <span className="text-[11px] text-muted">{share}</span>
              </div>
              {movement.sectors.length ? (
                <ul className="mt-1.5">
                  {movement.sectors.map((s) => (
                    <Impact key={s.name} name={s.name} amount={s.day_pnl} share={s.share} max={largest(movement.sectors)} />
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-muted">Nothing to break down.</p>
              )}
            </section>
          </div>
        </>
      )}
    </Dialog>
  );
}

// ------------------------------------------------------------------ brief
const TONE: Record<BriefItem["tone"], { icon: LucideIcon; className: string; label: string }> = {
  attention: { icon: AlertTriangle, className: "bg-warn-soft text-warn", label: "Worth a look" },
  info: { icon: CalendarClock, className: "bg-accent-soft text-accent", label: "Good to know" },
  good: { icon: Check, className: "bg-gain-soft text-gain", label: "Good news" },
};

/** The few things worth knowing right now, most pressing first. Each line opens where the detail is. */
export function BriefCard({ items, onOpen, error, onRetry, className }: Loadable & { items: BriefItem[] | undefined; onOpen: (panel: Panel) => void }) {
  if (error) return <Unavailable title="Worth knowing today" error={error} onRetry={onRetry} className={className} />;
  if (!items) return <CardSkeleton height={220} className={className} />;
  const row = "flex w-full items-start gap-3 px-4 py-3 text-left sm:px-5";
  return (
    <Card tour="dash-brief" title="Worth knowing today" description="About this portfolio, most pressing first" className={className} flush>
      <ul className="divide-y divide-line">
        {items.map((item) => {
          const tone = TONE[item.tone];
          const body = (
            <>
              <span role="img" aria-label={tone.label} title={tone.label} className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", tone.className)}>
                <tone.icon className="size-3.5" strokeWidth={2.4} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium leading-snug text-ink">{item.title}</span>
                <span className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">{item.detail}</span>
              </span>
              {item.id !== "quiet" && <ChevronRight className="mt-1.5 size-4 shrink-0 text-muted" aria-hidden />}
            </>
          );
          return (
            <li key={item.id}>
              {item.id === "quiet" ? (
                <div className={row}>{body}</div>
              ) : item.to.startsWith("#") ? (
                <button type="button" className={cn(row, "transition-colors hover:bg-surface-2")} onClick={() => onOpen(item.to.slice(1) as Panel)}>
                  {body}
                </button>
              ) : (
                <Link to={item.to} className={cn(row, "transition-colors hover:bg-surface-2")}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
