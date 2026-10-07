import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { Button, Dialog, Field, IconButton, Input, Segmented, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useAction } from "@/lib/queries";
import type { JournalEntry, JournalInput } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ACTIONS, JOURNAL_KEYS, Labeled, type JournalAction } from "./shared";

const HORIZONS = ["6 months", "1 year", "3–5 years", "5+ years"];
const MAX_LINES = 12;
type Level = "1" | "2" | "3" | "4" | "5";

function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
}

/** Record a new decision, or edit one when `editing` is given. */
export function EntryDialog({
  open,
  onOpenChange,
  editing,
  knownTags,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: JournalEntry | null;
  /** Tags already used elsewhere in the journal, offered as one-tap suggestions. */
  knownTags: string[];
}) {
  const { portfolios } = usePortfolio();
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [action, setAction] = useState<JournalAction>("BUY");
  const [entryPrice, setEntryPrice] = useState("");
  const [priceEdited, setPriceEdited] = useState(false);
  const [entryDate, setEntryDate] = useState(todayIso());
  const [horizon, setHorizon] = useState("");
  const [conviction, setConviction] = useState<Level>("3");
  const [thesis, setThesis] = useState("");
  const [reasons, setReasons] = useState<string[]>([""]);
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const [exitConditions, setExitConditions] = useState("");
  const [tags, setTags] = useState("");
  const [portfolioId, setPortfolioId] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setFocusLine(null);
    setSymbol(editing?.symbol ?? "");
    setName(editing?.name ?? "");
    setAction(editing?.action ?? "BUY");
    setEntryPrice(editing?.entry_price != null ? String(editing.entry_price) : "");
    setPriceEdited(!!editing);
    setEntryDate(editing?.entry_date.slice(0, 10) ?? todayIso());
    setHorizon(editing?.horizon ?? "");
    setConviction(String(Math.min(5, Math.max(1, editing?.conviction ?? 3))) as Level);
    setThesis(editing?.thesis ?? "");
    setReasons(editing?.reasons.length ? editing.reasons : [""]);
    setExitConditions(editing?.exit_conditions ?? "");
    setTags(editing?.tags.join(", ") ?? "");
    setPortfolioId(editing?.portfolio_id ?? "");
  }, [open, editing]);

  const priceValue = entryPrice.trim() === "" ? null : Number(entryPrice);
  const tagList = parseTags(tags);
  const errors = {
    symbol: !symbol ? "Pick the stock this decision is about" : null,
    price: priceValue !== null && !(priceValue >= 0) ? "Enter a price, or leave it blank" : null,
    date: !entryDate ? "Choose the date of the decision" : entryDate > todayIso() ? "The date can't be in the future" : null,
    thesis: !thesis.trim() ? "Write down why, even if it is one sentence" : null,
    tags: tagList.length > MAX_LINES ? `Use at most ${MAX_LINES} tags` : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);

  const body: JournalInput = {
    symbol,
    portfolio_id: portfolioId || null,
    action,
    entry_price: priceValue,
    entry_date: entryDate,
    horizon: horizon.trim(),
    thesis: thesis.trim(),
    reasons: reasons.map((r) => r.trim()).filter(Boolean),
    exit_conditions: exitConditions.trim(),
    conviction: Number(conviction),
    tags: tagList,
    // Review fields are edited from the entry itself; keep whatever is there.
    status: editing?.status ?? "open",
    outcome_notes: editing?.outcome_notes ?? "",
    closed_at: editing?.closed_at ? editing.closed_at.slice(0, 10) : null,
  };

  const save = useAction(() => (editing ? api.updateJournal(editing.id, body) : api.createJournal(body)), {
    invalidate: JOURNAL_KEYS,
    success: editing ? "Journal entry updated" : `Journal entry added for ${symbol}`,
    onSuccess: () => onOpenChange(false),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) save.mutate(undefined);
  };

  const setReason = (index: number, value: string) => setReasons((all) => all.map((r, i) => (i === index ? value : r)));
  const addReason = () => {
    if (reasons.length >= MAX_LINES) return;
    setFocusLine(reasons.length);
    setReasons((all) => [...all, ""]);
  };
  const suggestions = knownTags.filter((t) => !tagList.includes(t)).slice(0, 8);
  const chip = "inline-flex h-6 items-center rounded-md bg-surface-2 px-2 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line transition-colors hover:text-ink hover:ring-line-strong";

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? "Edit journal entry" : "New journal entry"}
      description="Write down what you decided and why, in your own words. You can compare it with what happened later."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="journal-entry-form" loading={save.isPending}>
            {editing ? "Save changes" : "Add entry"}
          </Button>
        </>
      }
    >
      <form id="journal-entry-form" onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4">
        <Field label="Stock" error={show("symbol")} hint={name || undefined} className="col-span-2">
          {(props) => (
            <SymbolPicker
              id={props.id}
              value={symbol}
              invalid={!!show("symbol")}
              autoFocus={!editing}
              onSelect={(item) => {
                setSymbol(item.symbol);
                setName(item.name);
                if (!priceEdited && item.price != null) setEntryPrice(String(item.price));
              }}
            />
          )}
        </Field>

        <Labeled label="Decision" className="col-span-2">
          <Segmented<JournalAction> label="Decision" value={action} onChange={setAction} options={ACTIONS} />
        </Labeled>

        <Field label="Entry price" error={show("price")} hint="The price when you decided. Blank uses that day's close.">
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              prefix="₹"
              placeholder="0.00"
              value={entryPrice}
              onChange={(e) => {
                setEntryPrice(e.target.value);
                setPriceEdited(true);
              }}
            />
          )}
        </Field>
        <Field label="Date" error={show("date")}>
          {(props) => <Input {...props} type="date" max={todayIso()} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />}
        </Field>

        <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Field label="Expected holding period">
            {(props) => <Input {...props} value={horizon} maxLength={60} placeholder="How long you expect to hold" onChange={(e) => setHorizon(e.target.value)} />}
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {HORIZONS.map((h) => (
              <button key={h} type="button" onClick={() => setHorizon(h)} className={cn(chip, horizon === h && "bg-accent-soft text-accent ring-transparent hover:text-accent")}>
                {h}
              </button>
            ))}
          </div>
        </div>
        <Labeled label="Conviction" hint="1 is a hunch, 5 is as sure as you get." className="col-span-2 sm:col-span-1">
          <Segmented<Level> label="Conviction from 1 to 5" value={conviction} onChange={setConviction} options={["1", "2", "3", "4", "5"]} className="[&>button]:w-9" />
        </Labeled>

        <Field label="Investment thesis" error={show("thesis")} className="col-span-2">
          {(props) => (
            <Textarea {...props} rows={4} maxLength={4000} value={thesis} onChange={(e) => setThesis(e.target.value)} placeholder="What do you expect to happen, and what makes you think so?" />
          )}
        </Field>

        <Labeled label="Reasons" hint="One line each: the specific points the thesis rests on." className="col-span-2">
          <div className="flex flex-col gap-2">
            {reasons.map((reason, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="num w-4 shrink-0 text-right text-xs text-muted">{i + 1}</span>
                <Input
                  aria-label={`Reason ${i + 1}`}
                  value={reason}
                  maxLength={200}
                  autoFocus={focusLine === i}
                  placeholder={i === 0 ? "A reason this decision makes sense to you" : "Another reason"}
                  onChange={(e) => setReason(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (reason.trim()) addReason();
                  }}
                />
                <IconButton label={`Remove reason ${i + 1}`} disabled={reasons.length === 1 && !reason} onClick={() => setReasons((all) => (all.length === 1 ? [""] : all.filter((_, j) => j !== i)))}>
                  <X className="size-4" />
                </IconButton>
              </div>
            ))}
            <div>
              <Button size="sm" variant="ghost" className="-ml-1" icon={<Plus className="size-3.5" />} disabled={reasons.length >= MAX_LINES} onClick={addReason}>
                Add reason
              </Button>
            </div>
          </div>
        </Labeled>

        <Field label="Exit conditions" hint="What would have to happen for you to change your mind or sell." className="col-span-2">
          {(props) => <Textarea {...props} rows={3} maxLength={2000} value={exitConditions} onChange={(e) => setExitConditions(e.target.value)} />}
        </Field>

        <div className="col-span-2 flex flex-col gap-2 sm:col-span-1">
          <Field label="Tags" error={show("tags")} hint="Separate with commas.">
            {(props) => <Input {...props} value={tags} placeholder="core, dividend" onChange={(e) => setTags(e.target.value)} />}
          </Field>
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((t) => (
                <button key={t} type="button" className={chip} onClick={() => setTags([...tagList, t].join(", "))}>
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Portfolio" hint="Optional. Links the entry to one of your portfolios." className="col-span-2 sm:col-span-1">
          {(props) => (
            <Select {...props} value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
              <option value="">None</option>
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.kind === "paper" ? " (paper)" : ""}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}
