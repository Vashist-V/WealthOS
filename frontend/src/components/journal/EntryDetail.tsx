import { ArrowUpRight, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TimeSeriesChart } from "@/components/charts";
import { Badge, Button, Dialog, ErrorState, Field, Input, KeyValue, Signed, Skeleton, StatTile, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { date, duration, number, price, signedPct, todayIso } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useAction, useJournalReview } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { JournalEntry, JournalInput, JournalReview } from "@/lib/types";
import { symbolPath } from "@/lib/utils";
import { ACTION_LABEL, ActionBadge, Conviction, JOURNAL_KEYS, StatusBadge, Tag, toInput } from "./shared";

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium uppercase tracking-wider text-muted">{children}</h3>;
}

function ReviewChart({ entry, review }: { entry: JournalEntry; review: JournalReview }) {
  const { chart } = useTheme();
  // The entry or close may fall on a holiday; pin each marker to a day the chart actually has.
  const marks = useMemo(() => {
    const onOrAfter = (day: string) => review.dates.find((d) => d >= day) ?? review.dates[review.dates.length - 1];
    const onOrBefore = (day: string) => [...review.dates].reverse().find((d) => d <= day) ?? review.dates[0];
    const out = [{ date: onOrAfter(review.entry_date), label: "Entry" }];
    if (entry.status === "closed" && review.closed_at) out.push({ date: onOrBefore(review.closed_at), label: "Closed" });
    return out;
  }, [review, entry.status]);
  const series = useMemo(
    () => [
      { name: entry.symbol, data: review.stock, area: true },
      ...(review.benchmark.length ? [{ name: review.benchmark_name ?? "Benchmark", data: review.benchmark, dashed: true, color: chart.muted }] : []),
    ],
    [review, entry.symbol, chart.muted],
  );
  return (
    <TimeSeriesChart
      label={`${entry.symbol} against the benchmark since the entry`}
      dates={review.dates}
      series={series}
      format="signedPct"
      zeroLine
      marks={marks}
      height={280}
    />
  );
}

/** One journal entry in full: the thesis as written, what the price did since, and the review. */
export function EntryDetail({
  entry,
  onClose,
  onEdit,
  onDelete,
}: {
  entry: JournalEntry;
  onClose: () => void;
  onEdit: (entry: JournalEntry) => void;
  onDelete: (entry: JournalEntry) => void;
}) {
  const { portfolios } = usePortfolio();
  const review = useJournalReview(entry.id);
  const closed = entry.status === "closed";
  const [notes, setNotes] = useState(entry.outcome_notes ?? "");
  const [closeDate, setCloseDate] = useState(todayIso());
  useEffect(() => setNotes(entry.outcome_notes ?? ""), [entry.id, entry.outcome_notes]);

  const update = useAction((change: { patch: Partial<JournalInput>; message: string }) => api.updateJournal(entry.id, { ...toInput(entry), ...change.patch }), {
    invalidate: JOURNAL_KEYS,
    success: (_, change) => change.message,
  });

  const entryDay = entry.entry_date.slice(0, 10);
  const today = todayIso();
  const closeDateError = !closeDate ? "Choose the close date" : closeDate < entryDay ? "The close date can't be before the entry" : closeDate > today ? "The close date can't be in the future" : null;
  const notesChanged = notes.trim() !== (entry.outcome_notes ?? "").trim();
  const portfolio = portfolios.find((p) => p.id === entry.portfolio_id);

  const startPrice = entry.reference_price ?? entry.entry_price;
  const restated = entry.entry_price != null && entry.reference_price != null && Math.abs(entry.reference_price - entry.entry_price) > 0.005;
  const endPrice = closed ? (entry.end_price ?? null) : (entry.current_price ?? entry.end_price ?? null);
  const difference = entry.return_pct != null && entry.benchmark_return_pct != null ? entry.return_pct - entry.benchmark_return_pct : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      size="xl"
      title={`${entry.symbol} · ${entry.name}`}
      description={`${ACTION_LABEL[entry.action]} decision recorded for ${date(entry.entry_date)}`}
      footer={
        <>
          <Button variant="ghost" className="mr-auto text-loss hover:text-loss" icon={<Trash2 className="size-4" />} onClick={() => onDelete(entry)}>
            Delete
          </Button>
          <Button icon={<Pencil className="size-4" />} onClick={() => onEdit(entry)}>
            Edit entry
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-wrap items-center gap-2">
          <ActionBadge action={entry.action} />
          <StatusBadge status={entry.status} />
          {entry.held && <Badge>Still held</Badge>}
          {entry.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
          <Link to={symbolPath(entry.symbol)} className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
            Open {entry.symbol} <ArrowUpRight className="size-3.5" />
          </Link>
        </div>

        <div className="grid gap-x-8 gap-y-6 md:grid-cols-5">
          <div className="flex flex-col gap-5 md:col-span-3">
            <section>
              <Heading>Thesis</Heading>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink">{entry.thesis || "No thesis was written for this entry."}</p>
            </section>
            {entry.reasons.length > 0 && (
              <section>
                <Heading>Reasons</Heading>
                <ol className="mt-2 flex flex-col gap-1.5">
                  {entry.reasons.map((reason, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
                      <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[11px] font-medium text-muted ring-1 ring-inset ring-line">{i + 1}</span>
                      <span>{reason}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
            {entry.exit_conditions && (
              <section>
                <Heading>Exit conditions</Heading>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-2">{entry.exit_conditions}</p>
              </section>
            )}
          </div>
          <aside className="md:col-span-2">
            <div className="rounded-xl bg-surface-2 p-4 ring-1 ring-inset ring-line">
              <KeyValue
                items={[
                  { label: "Decision", value: ACTION_LABEL[entry.action] },
                  { label: "Date", value: date(entry.entry_date) },
                  { label: "Entry price", value: entry.entry_price != null ? price(entry.entry_price) : "Not recorded" },
                  { label: "Holding period", value: entry.horizon || "—" },
                  { label: "Conviction", value: <span className="inline-flex items-center gap-2"><Conviction value={entry.conviction} />{entry.conviction} of 5</span> },
                  { label: "Portfolio", value: portfolio?.name ?? "None" },
                  ...(closed ? [{ label: "Closed on", value: date(entry.closed_at) }] : []),
                ]}
              />
            </div>
          </aside>
        </div>

        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <Heading>Thesis vs. reality</Heading>
            <span className="text-xs text-muted">{closed ? `From the entry to the close on ${date(entry.closed_at)}` : "From the entry to the latest close"}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 [&>*]:max-sm:px-3">
            <StatTile label="Entry price" value={price(startPrice)} sub={entry.entry_price == null ? "Close on the entry date" : restated ? "Restated for splits since" : date(entry.entry_date)} />
            <StatTile label={closed ? "Closing price" : "Current price"} value={price(endPrice)} sub={closed ? date(entry.closed_at) : "Latest traded price"} />
            <StatTile label="Days" value={number(entry.days)} sub={duration(entry.days)} />
            <StatTile
              label={`${entry.symbol} return`}
              value={<Signed value={entry.return_pct}>{signedPct(entry.return_pct)}</Signed>}
              sub="Price change, dividends excluded"
            />
            <StatTile label={`${entry.benchmark_name ?? "Benchmark"} return`} value={<Signed value={entry.benchmark_return_pct}>{signedPct(entry.benchmark_return_pct)}</Signed>} sub="Over the same days" />
            <StatTile
              label="Difference"
              value={<Signed value={difference}>{signedPct(difference)}</Signed>}
              sub="Stock minus benchmark, in points"
              hint="The stock's return minus the benchmark's return over the same period, in percentage points."
            />
          </div>
          <div className="mt-4 rounded-xl p-4 ring-1 ring-inset ring-line">
            {review.isError ? (
              <ErrorState error={review.error} onRetry={() => review.refetch()} className="py-8" />
            ) : !review.data ? (
              <Skeleton className="h-[280px] w-full" />
            ) : review.data.dates.length < 2 ? (
              <div className="flex h-[200px] items-center justify-center px-6 text-center text-[13px] text-muted">There is no price history for {entry.symbol} around this entry yet.</div>
            ) : (
              <>
                <ReviewChart entry={entry} review={review.data} />
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  The stock is measured from your entry price and the benchmark from its close on the entry date. The chart starts a few weeks earlier for context.
                </p>
              </>
            )}
          </div>
        </section>

        <section>
          <Heading>Review</Heading>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            {closed
              ? "This entry is closed, so the comparison above stops at the close date. Reopen it to keep tracking."
              : "When the decision has played out, note what happened against the thesis and close the entry. Closing fixes the comparison at the close date."}
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Outcome notes">
              {(props) => (
                <Textarea {...props} rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened, and how did it compare with what you expected?" />
              )}
            </Field>
            <div className="flex flex-wrap items-end justify-between gap-3">
              {closed ? (
                <span />
              ) : (
                <Field label="Close date" error={closeDateError} className="w-44">
                  {(props) => <Input {...props} type="date" min={entryDay} max={today} value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />}
                </Field>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!notesChanged} loading={update.isPending && update.variables?.message === "Notes saved"} onClick={() => update.mutate({ patch: { outcome_notes: notes.trim() }, message: "Notes saved" })}>
                  Save notes
                </Button>
                {closed ? (
                  <Button
                    icon={<RotateCcw className="size-4" />}
                    loading={update.isPending && update.variables?.message === "Entry reopened"}
                    onClick={() => update.mutate({ patch: { status: "open", closed_at: null, outcome_notes: notes.trim() }, message: "Entry reopened" })}
                  >
                    Reopen
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    disabled={!!closeDateError}
                    loading={update.isPending && update.variables?.message === "Entry closed"}
                    onClick={() => update.mutate({ patch: { status: "closed", closed_at: closeDate, outcome_notes: notes.trim() }, message: "Entry closed" })}
                  >
                    Close entry
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </Dialog>
  );
}
