import { CalendarDays, ChevronLeft, ChevronRight, Coins, FileText, Plus, Split, type LucideIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAppActions } from "@/components/layout/AppShell";
import { capitalize, daysBetween, isoDay, longDay, monthTitle, parseDay, relativeDay, weekdayShort } from "@/components/market/shared";
import { Badge, Button, Card, CardSkeleton, EmptyState, ErrorState, IconButton, Page, Segmented, SymbolCell } from "@/components/ui";
import { date, number, shortDate } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useCalendar } from "@/lib/queries";
import type { CalendarEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

type EventType = CalendarEvent["type"];
type Tone = "gain" | "accent" | "warn";

/** Each type has its own icon as well as a tone, so it never rests on colour alone. */
const TYPES: Record<EventType, { label: string; tone: Tone; icon: LucideIcon }> = {
  dividend: { label: "Dividend", tone: "gain", icon: Coins },
  results: { label: "Results", tone: "accent", icon: FileText },
  split: { label: "Split or bonus", tone: "warn", icon: Split },
};
const TILE: Record<Tone, string> = {
  gain: "bg-gain-soft text-gain",
  accent: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
};
const TYPE_ORDER: EventType[] = ["results", "dividend", "split"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const AGENDA_PAGE = 12;

type TypeFilter = "all" | EventType;
type SourceFilter = "all" | CalendarEvent["source"];

const plural = (n: number, word: string) => `${number(n)} ${word}${n === 1 ? "" : "s"}`;

// -------------------------------------------------------------- event row
function EventRow({ event }: { event: CalendarEvent }) {
  const type = TYPES[event.type];
  return (
    <li className="flex items-start gap-3 py-3">
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", TILE[type.tone])} title={type.label}>
        <type.icon className="size-4" aria-hidden />
        <span className="sr-only">{type.label}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <SymbolCell symbol={event.symbol} name={event.name} />
          <Badge className="mt-0.5 shrink-0">{event.source === "portfolio" ? "Holdings" : "Watchlist"}</Badge>
        </div>
        <div className="mt-1.5 text-[13px] text-ink">{event.title}</div>
        {event.detail && <div className="mt-0.5 text-xs leading-relaxed text-muted">{event.detail}</div>}
      </div>
    </li>
  );
}

// ------------------------------------------------------------- month grid
function MonthGrid({
  year,
  month,
  today,
  selected,
  byDay,
  onSelect,
}: {
  year: number;
  month: number;
  today: string;
  selected: string;
  byDay: Map<string, CalendarEvent[]>;
  onSelect: (day: string) => void;
}) {
  const days = useMemo(() => {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const count = new Date(year, month + 1, 0).getDate();
    const cells = Math.ceil((lead + count) / 7) * 7;
    return Array.from({ length: cells }, (_, i) => {
      const d = new Date(year, month, 1 - lead + i);
      return { iso: isoDay(d), day: d.getDate(), inMonth: d.getMonth() === month };
    });
  }, [year, month]);

  return (
    <div className="@container">
      <div className="grid grid-cols-7 pb-1.5 text-center text-xs font-medium text-muted" aria-hidden>
        {WEEKDAYS.map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-line ring-1 ring-line">
        {days.map((cell) => {
          const events = byDay.get(cell.iso) ?? [];
          const isSelected = cell.iso === selected;
          const counts = TYPE_ORDER.map((t) => ({ type: t, count: events.filter((e) => e.type === t).length })).filter((c) => c.count > 0);
          return (
            <button
              key={cell.iso}
              type="button"
              aria-pressed={isSelected}
              aria-label={`${longDay(cell.iso)}, ${events.length ? plural(events.length, "event") : "no events"}`}
              onClick={() => onSelect(cell.iso)}
              className={cn(
                "relative flex min-h-[4.5rem] min-w-0 flex-col items-stretch gap-1 bg-surface p-1 text-left transition-colors focus-visible:-outline-offset-2 sm:min-h-[6.25rem] sm:p-1.5",
                isSelected ? "bg-surface-2 shadow-[inset_0_0_0_2px_var(--accent)]" : "hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "num flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                  cell.iso === today ? "bg-accent font-semibold text-on-accent" : cell.inMonth ? "text-ink-2" : "text-muted/60",
                )}
              >
                {cell.day}
              </span>

              {/* Narrow grids (phones, and the split layout on small laptops): one compact chip per type with a count. */}
              <span className={cn("flex flex-wrap items-start gap-0.5 @min-[37rem]:hidden", !cell.inMonth && "opacity-50")}>
                {counts.map(({ type, count }) => {
                  const Icon = TYPES[type].icon;
                  return (
                    <Badge key={type} tone={TYPES[type].tone} className="gap-0.5 px-1">
                      <Icon className="size-2.5" aria-hidden />
                      {count > 1 && <span className="num">{count}</span>}
                    </Badge>
                  );
                })}
              </span>

              {/* Roomier grids: name the first two events, then count the rest. */}
              <span className={cn("hidden min-w-0 flex-col gap-1 @min-[37rem]:flex", !cell.inMonth && "opacity-50")}>
                {events.slice(0, 2).map((e, i) => {
                  const Icon = TYPES[e.type].icon;
                  return (
                    <Badge key={`${e.symbol}-${e.type}-${i}`} tone={TYPES[e.type].tone} className="flex w-full min-w-0 justify-start">
                      <Icon className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{e.symbol}</span>
                    </Badge>
                  );
                })}
                {events.length > 2 && <span className="px-1 text-[11px] text-muted">+{events.length - 2} more</span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        {TYPE_ORDER.map((t) => {
          const Icon = TYPES[t].icon;
          return (
            <span key={t} className="inline-flex items-center gap-1.5">
              <span className={cn("flex size-5 items-center justify-center rounded-md", TILE[TYPES[t].tone])}>
                <Icon className="size-3" aria-hidden />
              </span>
              {TYPES[t].label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- page
export function CalendarPage() {
  const actions = useAppActions();
  const { investment } = usePortfolio();
  const calendar = useCalendar();
  const data = calendar.data;

  const [type, setType] = useState<TypeFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [showAll, setShowAll] = useState(false);

  const today = data?.today ?? isoDay(new Date());
  const todayDate = parseDay(today);
  const view = cursor ?? { year: todayDate.getFullYear(), month: todayDate.getMonth() };
  const selected = picked ?? today;

  const events = useMemo(
    () => (data?.events ?? []).filter((e) => (type === "all" || e.type === type) && (source === "all" || e.source === source)),
    [data, type, source],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [events]);
  const agenda = useMemo(() => {
    const rows = events.filter((e) => e.upcoming === (when === "upcoming"));
    const days = [...new Set(rows.map((e) => e.date))].sort();
    if (when === "past") days.reverse();
    return { count: rows.length, days: days.map((day) => ({ day, events: rows.filter((e) => e.date === day) })) };
  }, [events, when]);

  // The data covers the past year and whatever has been announced, so the grid stays within a year either side.
  const offset = (view.year - todayDate.getFullYear()) * 12 + (view.month - todayDate.getMonth());
  const shift = (by: number) => {
    const d = new Date(view.year, view.month + by, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };
  const goTo = (day: string) => {
    const d = parseDay(day);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
    setPicked(day);
  };
  const nextEvent = events.find((e) => e.date > selected);
  const selectedEvents = byDay.get(selected) ?? [];
  const filtered = type !== "all" || source !== "all";
  const visibleDays = showAll ? agenda.days : agenda.days.slice(0, AGENDA_PAGE);

  let body: ReactNode;
  if (!data) {
    body = calendar.isError ? (
      <Card>
        <ErrorState error={calendar.error} onRetry={() => calendar.refetch()} />
      </Card>
    ) : (
      <div className="grid gap-4 lg:grid-cols-12">
        <CardSkeleton height={520} className="lg:col-span-12 xl:col-span-7" />
        <CardSkeleton height={520} className="lg:col-span-12 xl:col-span-5" />
      </div>
    );
  } else if (data.symbols === 0) {
    body = (
      <Card>
        <EmptyState
          className="py-16"
          icon={<CalendarDays />}
          title="Nothing to track yet"
          description="The calendar follows the stocks you hold and the ones on your watchlists. Record a holding or add a stock to a watchlist and its dividends, splits and results dates appear here."
          action={
            <>
              {investment.length > 0 && (
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>
                  Add transaction
                </Button>
              )}
              <Link to="/watchlists">
                <Button variant={investment.length > 0 ? "secondary" : "primary"}>Open watchlists</Button>
              </Link>
            </>
          }
        />
      </Card>
    );
  } else {
    body = (
      <div className="grid gap-4 lg:grid-cols-12">
        <Card
          title={monthTitle(new Date(view.year, view.month, 1))}
          description={`${plural(events.filter((e) => e.date.startsWith(`${view.year}-${String(view.month + 1).padStart(2, "0")}`)).length, "event")} this month`}
          className="lg:col-span-12 xl:col-span-7"
          action={
            <>
              <Button size="sm" onClick={() => goTo(today)}>
                Today
              </Button>
              <IconButton label="Previous month" disabled={offset <= -12} onClick={() => shift(-1)}>
                <ChevronLeft className="size-4" />
              </IconButton>
              <IconButton label="Next month" disabled={offset >= 12} onClick={() => shift(1)}>
                <ChevronRight className="size-4" />
              </IconButton>
            </>
          }
        >
          <MonthGrid year={view.year} month={view.month} today={today} selected={selected} byDay={byDay} onSelect={setPicked} />

          <section className="mt-5 border-t border-line pt-4" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-ink">{longDay(selected)}</h3>
              <span className="text-xs text-muted">{capitalize(relativeDay(daysBetween(today, selected)))}</span>
            </div>
            {selectedEvents.length > 0 ? (
              <ul className="mt-1 divide-y divide-line">
                {selectedEvents.map((e, i) => (
                  <EventRow key={`${e.symbol}-${e.type}-${i}`} event={e} />
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[13px] text-muted">
                No events on this day{filtered ? " match the filters" : ""}.{" "}
                {nextEvent && (
                  <button type="button" className="font-medium text-accent hover:underline" onClick={() => goTo(nextEvent.date)}>
                    Next: {nextEvent.symbol} on {shortDate(nextEvent.date)}
                  </button>
                )}
              </p>
            )}
          </section>
          <p className="mt-4 text-xs leading-relaxed text-muted">
            Results dates are the data source's expected dates and can move. Board-meeting dates are not covered by the data source.
          </p>
        </Card>

        <Card
          title="Agenda"
          description={`${plural(agenda.count, "event")} ${when === "upcoming" ? "coming up" : "in the past 12 months"}${filtered ? ", filtered" : ""}`}
          className="lg:col-span-12 xl:col-span-5"
          flush
          action={
            <Segmented
              label="Agenda period"
              size="sm"
              value={when}
              onChange={(v) => {
                setWhen(v);
                setShowAll(false);
              }}
              options={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "Past 12 months" }]}
            />
          }
        >
          {agenda.days.length === 0 ? (
            <EmptyState
              className="py-10"
              icon={<CalendarDays />}
              title={when === "upcoming" ? "Nothing announced yet" : "Nothing in the past 12 months"}
              description={
                filtered
                  ? "No events match the type and source filters."
                  : when === "upcoming"
                    ? "Results and ex-dividend dates appear here as companies announce them."
                    : "No dividends or splits were recorded for the stocks you hold or watch."
              }
              action={
                filtered && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setType("all");
                      setSource("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )
              }
            />
          ) : (
            // Beside the month grid the agenda scrolls in place, so the two cards stay about the same height.
            <div className="border-t border-line xl:max-h-[46rem] xl:overflow-y-auto">
              <ol className="divide-y divide-line">
                {visibleDays.map((group) => (
                  <li key={group.day} className="flex gap-3 px-4 sm:gap-4 sm:px-5">
                    <button
                      type="button"
                      onClick={() => goTo(group.day)}
                      title="Show this day in the month view"
                      className="group w-[5.25rem] shrink-0 self-start py-3 text-left"
                    >
                      <span className="num block text-[13px] font-semibold text-ink group-hover:text-accent">{date(group.day)}</span>
                      <span className="block text-xs text-muted">{weekdayShort(group.day)}</span>
                      <span className="mt-0.5 block text-xs text-muted">{capitalize(relativeDay(daysBetween(today, group.day)))}</span>
                    </button>
                    <ul className="min-w-0 flex-1 divide-y divide-line">
                      {group.events.map((e, i) => (
                        <EventRow key={`${e.symbol}-${e.type}-${i}`} event={e} />
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
              {agenda.days.length > AGENDA_PAGE && (
                <div className="border-t border-line px-4 py-3 sm:px-5">
                  <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? "Show fewer" : `Show all ${plural(agenda.days.length, "date")}`}
                  </button>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    );
  }

  return (
    <Page
      title="Calendar"
      description={
        data && data.symbols > 0
          ? `Dividends, splits and bonuses, and results dates for the ${plural(data.symbols, "stock")} you hold or watch.`
          : "Dividends, splits and bonuses, and results dates for the stocks you hold or watch."
      }
      actions={
        data && data.symbols > 0 ? (
          <>
            <div className="max-w-full overflow-x-auto">
              <Segmented
                label="Event type"
                value={type}
                onChange={setType}
                className="whitespace-nowrap"
                options={[
                  { value: "all", label: "All types" },
                  { value: "dividend", label: "Dividends" },
                  { value: "results", label: "Results" },
                  { value: "split", label: "Splits" },
                ]}
              />
            </div>
            <Segmented
              label="Source"
              value={source}
              onChange={setSource}
              className="whitespace-nowrap"
              options={[
                { value: "all", label: "All stocks" },
                { value: "portfolio", label: "Holdings" },
                { value: "watchlist", label: "Watchlist" },
              ]}
            />
          </>
        ) : undefined
      }
    >
      {body}
    </Page>
  );
}
