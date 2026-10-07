import { NotebookPen, Plus, Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { EntryDetail } from "@/components/journal/EntryDetail";
import { EntryDialog } from "@/components/journal/EntryDialog";
import { ActionBadge, Conviction, JOURNAL_KEYS, StatusBadge, Tag } from "@/components/journal/shared";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Input, Page, Segmented, Signed, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { date, duration, price, signedPct } from "@/lib/format";
import { useAction, useJournal } from "@/lib/queries";
import type { JournalEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "open" | "closed";

function Outcome({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted">{label}</div>
      <Signed value={value} className="text-[13px] font-medium">{signedPct(value)}</Signed>
    </div>
  );
}

function EntryCard({ entry, onOpen }: { entry: JournalEntry; onOpen: () => void }) {
  const closed = entry.status === "closed";
  return (
    <article className="card group relative flex min-w-0 flex-col p-4 transition-colors hover:border-line-strong sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {/* The stretched button makes the whole card open the entry. */}
            <button type="button" onClick={onOpen} className="truncate text-[15px] font-semibold tracking-tight text-ink outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent group-hover:text-accent">
              {entry.symbol}
            </button>
            <ActionBadge action={entry.action} />
          </div>
          <div className="truncate text-xs text-muted">{entry.name}</div>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <div>
          <dt className="sr-only">Entered</dt>
          <dd className="num">
            {date(entry.entry_date)}
            {entry.entry_price != null && ` at ${price(entry.entry_price)}`}
          </dd>
        </div>
        {entry.horizon && (
          <div className="flex gap-1">
            <dt>Horizon</dt>
            <dd className="text-ink-2">{entry.horizon}</dd>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <dt>Conviction</dt>
          <dd className="flex"><Conviction value={entry.conviction} /></dd>
        </div>
      </dl>

      <p className="mt-3 line-clamp-3 text-[13px] leading-relaxed text-ink-2">{entry.thesis || "No thesis written."}</p>

      {entry.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {entry.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      )}

      <div className="mt-auto pt-4">
        <div className="flex items-end justify-between gap-3 border-t border-line pt-3">
          <div className="flex min-w-0 gap-5">
            <Outcome label={closed ? "Entry to close" : "Since entry"} value={entry.return_pct} />
            <Outcome label={entry.benchmark_name ?? "Benchmark"} value={entry.benchmark_return_pct} />
            <div className="min-w-0">
              <div className="truncate text-[11px] text-muted">{closed ? "Open for" : "Elapsed"}</div>
              <div className="num text-[13px] font-medium text-ink-2">{duration(entry.days)}</div>
            </div>
          </div>
          {entry.held && <Badge className="shrink-0">Still held</Badge>}
        </div>
      </div>
    </article>
  );
}

export function JournalPage() {
  const journal = useJournal();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; editing: JournalEntry | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<JournalEntry | null>(null);

  const entries = useMemo(() => journal.data ?? [], [journal.data]);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    entries.forEach((e) => e.tags.forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
  }, [entries]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (status !== "all" && e.status !== status) return false;
      if (tag && !e.tags.includes(tag)) return false;
      if (!q) return true;
      return [e.symbol, e.name, e.thesis, e.exit_conditions, ...e.tags, ...e.reasons].some((text) => text?.toLowerCase().includes(q));
    });
  }, [entries, status, tag, search]);

  const openCount = entries.filter((e) => e.status === "open").length;
  const comparable = entries.filter((e) => e.return_pct != null && e.benchmark_return_pct != null);
  const ahead = comparable.filter((e) => e.return_pct! > e.benchmark_return_pct!).length;
  const filtered = status !== "all" || !!tag || !!search.trim();
  const detail = entries.find((e) => e.id === detailId) ?? null;

  const remove = useAction((entry: JournalEntry) => api.deleteJournal(entry.id), {
    invalidate: JOURNAL_KEYS,
    success: "Journal entry deleted",
    onSuccess: () => {
      setDeleting(null);
      setDetailId(null);
    },
  });

  const newEntry = () => setEditor({ open: true, editing: null });
  const clearFilters = () => {
    setStatus("all");
    setTag(null);
    setSearch("");
  };

  return (
    <Page
      title="Journal"
      description="A record of why you made each decision, so you can later compare the thesis with what actually happened."
      actions={
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={newEntry}>
          New entry
        </Button>
      }
    >
      {journal.isError ? (
        <Card>
          <ErrorState error={journal.error} onRetry={() => journal.refetch()} />
        </Card>
      ) : !journal.data ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-2 h-3.5 w-48" />
              <Skeleton className="mt-5 h-16 w-full" />
              <Skeleton className="mt-5 h-9 w-full" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<NotebookPen />}
            title="No journal entries yet"
            description="Write down why you are buying, selling or holding at the moment you decide, then come back later to see how the thesis held up against the price."
            action={
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={newEntry}>
                New entry
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Segmented<StatusFilter>
                label="Status"
                value={status}
                onChange={setStatus}
                options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "closed", label: "Closed" }]}
              />
              <div className="relative min-w-0 flex-1 sm:max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <Input aria-label="Search the journal" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search symbol, thesis or tag" className="pl-9" />
              </div>
              <p className="text-[13px] text-muted sm:ml-auto">
                {entries.length} {entries.length === 1 ? "entry" : "entries"} · {openCount} open
                {comparable.length > 0 && <> · the stock is ahead of the benchmark in {ahead} of {comparable.length}</>}
              </p>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by tag">
                <span className="mr-1 text-xs text-muted">Tags</span>
                {tags.map((t) => {
                  const active = tag === t.name;
                  return (
                    <button
                      key={t.name}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setTag(active ? null : t.name)}
                      className={cn(
                        "inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium ring-1 ring-inset transition-colors",
                        active ? "bg-accent-soft text-accent ring-transparent" : "bg-surface text-ink-2 ring-line hover:text-ink hover:ring-line-strong",
                      )}
                    >
                      {t.name}
                      <span className={cn("num", active ? "text-accent" : "text-muted")}>{t.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={<SearchX />}
                title="No entries match these filters"
                description="Try a different status, tag or search term."
                action={<Button onClick={clearFilters}>Clear filters</Button>}
              />
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {visible.map((entry) => (
                  <EntryCard key={entry.id} entry={entry} onOpen={() => setDetailId(entry.id)} />
                ))}
              </div>
              {filtered && (
                <p className="text-xs text-muted">
                  Showing {visible.length} of {entries.length}.{" "}
                  <button type="button" className="font-medium text-accent hover:underline" onClick={clearFilters}>
                    Clear filters
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {detail && (
        <EntryDetail
          key={detail.id}
          entry={detail}
          onClose={() => setDetailId(null)}
          onDelete={setDeleting}
          onEdit={(entry) => {
            setDetailId(null);
            setEditor({ open: true, editing: entry });
          }}
        />
      )}
      <EntryDialog open={editor.open} onOpenChange={(open) => setEditor((s) => ({ ...s, open }))} editing={editor.editing} knownTags={tags.map((t) => t.name)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this journal entry?"
        description={deleting ? `The ${deleting.symbol} entry from ${date(deleting.entry_date)}, with its thesis and review notes, will be deleted. This can't be undone.` : ""}
        confirmLabel="Delete entry"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Page>
  );
}
