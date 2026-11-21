import { Camera, ClipboardCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { inr, quantity as fmtQty, todayIso } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { errorMessage, useAction, useOverview } from "@/lib/queries";
import type { TradeField, Transaction, TransactionInput, TxType } from "@/lib/types";
import { Button, Dialog, Field, Input, Segmented, Select, Textarea } from "../ui";
import { SymbolPicker } from "./SymbolPicker";

export interface TransactionDraft {
  portfolioId?: string;
  symbol?: string;
  type?: TxType;
  quantity?: number;
  price?: number;
}

/** A field filled in from a sentence that is worth a second look. */
const WARN = "border-warn bg-warn-soft/60 ring-2 ring-warn/20";

const COPY: Record<TxType, { qty: string; price: string; total: string }> = {
  BUY: { qty: "Quantity", price: "Buy price", total: "Total cost" },
  SELL: { qty: "Quantity", price: "Sell price", total: "Net proceeds" },
  DIVIDEND: { qty: "Shares held", price: "Dividend per share", total: "Dividend received" },
};

/** Add a transaction, or edit one when `editing` is given. A new one can be typed in a sentence and filled in for checking. */
export function TransactionDialog({
  open,
  onOpenChange,
  draft,
  editing,
  onScreenshots,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft?: TransactionDraft;
  editing?: Transaction | null;
  /** Open the import from Groww screenshots instead. */
  onScreenshots?: () => void;
}) {
  const navigate = useNavigate();
  const { portfolios, id: activeId } = usePortfolio();
  const manual =useMemo(() => portfolios.filter((p) => p.kind === "investment"), [portfolios]);
  const [portfolioId, setPortfolioId] = useState("");
  const [type, setType] = useState<TxType>("BUY");
  const [symbol, setSymbol] = useState("");
  const [date, setDate] = useState(todayIso());
  const [qty, setQty] = useState("");
  const [px, setPx] = useState("");
  const [fees, setFees] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);
  // A sentence such as "bought 10 Infosys at 1,500 on 3 Nov", read into the fields below.
  const [words, setWords] = useState("");
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<{ text: string; tone: "muted" | "loss" } | null>(null);
  const [flags, setFlags] = useState<Partial<Record<TradeField, string>>>({});
  const clear = (field: TradeField) => setFlags((f) => (f[field] ? Object.fromEntries(Object.entries(f).filter(([k]) => k !== field)) : f));
  const flag = (field: TradeField) => (flags[field] ? <span className="text-warn">{flags[field]}</span> : undefined);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setWords("");
    setReadNote(null);
    setFlags({});
    if (editing) {
      setPortfolioId(editing.portfolio_id);
      setType(editing.transaction_type);
      setSymbol(editing.symbol);
      setDate(editing.transaction_date);
      setQty(String(editing.quantity));
      setPx(String(editing.price));
      setFees(editing.fees ? String(editing.fees) : "");
      setNotes(editing.notes ?? "");
    } else {
      const preferred = draft?.portfolioId ?? activeId;
      setPortfolioId(manual.find((p) => p.id === preferred)?.id ?? manual[0]?.id ?? "");
      setType(draft?.type ?? "BUY");
      setSymbol(draft?.symbol ?? "");
      setDate(todayIso());
      setQty(draft?.quantity ? String(draft.quantity) : "");
      setPx(draft?.price ? String(draft.price) : "");
      setFees("");
      setNotes("");
    }
  }, [open, editing, draft, activeId, manual]);

  const { data: overview } = useOverview(open && portfolioId ? portfolioId : null);
  const held = overview?.holdings.find((h) => h.symbol === symbol);
  const q = parseFloat(qty);
  const p = parseFloat(px);
  const f = parseFloat(fees) || 0;
  const gross = q > 0 && p >= 0 ? q * p : null;
  const total = gross === null ? null : type === "BUY" ? gross + f : type === "SELL" ? gross - f : gross;

  const errors = {
    portfolio: !portfolioId ? "Choose a portfolio" : null,
    symbol: !symbol ? "Pick a stock" : null,
    qty: !(q > 0) ? "Enter a quantity above zero" : type === "SELL" && !editing && held && q > held.quantity + 1e-9 ? `You hold ${fmtQty(held.quantity)}` : null,
    price: !(p >= 0) || px === "" ? "Enter a price" : null,
    date: !date ? "Choose a date" : date > todayIso() ? "Date can't be in the future" : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);

  const body: TransactionInput = { symbol, transaction_type: type, quantity: q, price: p, fees: f, transaction_date: date, notes: notes.trim() };
  const save = useAction(() => (editing ? api.updateTransaction(editing.id, body) : api.addTransaction(portfolioId, body)), {
    invalidate: "portfolio",
    success: editing ? "Transaction updated" : `${type === "BUY" ? "Buy" : type === "SELL" ? "Sale" : "Dividend"} recorded for ${symbol}`,
    onSuccess: () => onOpenChange(false),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) save.mutate(undefined);
  };

  const fill = async () => {
    const text = words.trim();
    if (text.length < 2 || reading) return;
    setReading(true);
    setReadNote(null);
    try {
      const result = await api.readTrade(text, portfolioId || null);
      const [first] = result.trades;
      if (!first) {
        setReadNote({ text: result.message, tone: "muted" });
        return;
      }
      setType(first.transaction_type);
      if (first.symbol) setSymbol(first.symbol);
      setQty(first.quantity != null ? String(first.quantity) : "");
      setPx(first.price != null ? String(first.price) : "");
      setDate(first.transaction_date);
      if (first.portfolio_id && manual.some((p) => p.id === first.portfolio_id)) setPortfolioId(first.portfolio_id);
      setFlags(first.check);
      const checks = Object.keys(first.check).length;
      setReadNote({
        tone: "muted",
        text:
          (result.trades.length > 1 ? `Found ${result.trades.length} trades; this fills in the first. Add it, then type the next. ` : "Filled in below. ") +
          (checks ? "Check what's marked in amber, then add it." : "Check it, then add it."),
      });
    } catch (error) {
      setReadNote({ text: errorMessage(error), tone: "loss" });
    } finally {
      setReading(false);
    }
  };

  /** Leave the dialog and run the trade through the checks instead of recording it. */
  const checkFirst = () => {
    const trade = { symbol, side: type, ...(q > 0 ? { qty: String(q) } : {}), ...(portfolioId ? { portfolio: portfolioId } : {}) };
    onOpenChange(false);
    navigate(`/lab/trade-check?${new URLSearchParams(trade)}`);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit transaction" : "Add transaction"}
      description="Enter the trade as it happened. Holdings, cost and returns are rebuilt from the ledger."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="transaction-form" data-tour="tx-save" loading={save.isPending}>
            {editing ? "Save changes" : "Add transaction"}
          </Button>
        </>
      }
    >
      <form id="transaction-form" data-tour="tx-form" onSubmit={submit} className="grid grid-cols-2 gap-x-3 gap-y-4" noValidate>
        {!editing && (
          <div className="col-span-2 rounded-xl bg-accent-soft/50 px-3.5 py-3 ring-1 ring-inset ring-accent/15">
            <label htmlFor="tx-words" className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
              <Sparkles className="size-3.5 text-accent" aria-hidden /> Or just type it
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                id="tx-words"
                value={words}
                maxLength={500}
                onChange={(e) => setWords(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void fill();
                  }
                }}
                placeholder="bought 10 Infosys at 1,500 on 3 Nov"
                autoComplete="off"
              />
              <Button onClick={() => void fill()} loading={reading} disabled={words.trim().length < 2}>
                Fill in
              </Button>
            </div>
            {readNote && (
              <p className={readNote.tone === "loss" ? "mt-1.5 text-xs text-loss" : "mt-1.5 text-xs text-ink-2"} role="status">
                {readNote.text}
              </p>
            )}
            {onScreenshots && (
              <button type="button" onClick={onScreenshots} className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:underline">
                <Camera className="size-3.5" aria-hidden /> Several trades? Import them from Groww screenshots
              </button>
            )}
          </div>
        )}
        <div className="col-span-2">
          <Segmented<TxType>
            tour="tx-type"
            label="Transaction type"
            value={type}
            onChange={(value) => {
              setType(value);
              clear("transaction_type");
            }}
            options={[{ value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" }, { value: "DIVIDEND", label: "Dividend" }]}
          />
        </div>
        {!editing && manual.length > 1 && (
          <Field label="Portfolio" error={show("portfolio")} hint={flag("portfolio_id")} className="col-span-2">
            {(props) => (
              <Select
                {...props}
                value={portfolioId}
                onChange={(e) => {
                  setPortfolioId(e.target.value);
                  clear("portfolio_id");
                }}
              >
                {manual.map((pf) => (
                  <option key={pf.id} value={pf.id}>
                    {pf.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label="Stock"
          error={show("symbol")}
          hint={flag("symbol") ?? (held ? `You hold ${fmtQty(held.quantity)} at an average of ${inr(held.avg_cost)}` : undefined)}
          className="col-span-2"
          tour="tx-symbol"
        >
          {(props) => (
            <SymbolPicker
              id={props.id}
              value={symbol}
              invalid={!!show("symbol")}
              autoFocus={!editing && !draft?.symbol}
              onSelect={(item) => {
                setSymbol(item.symbol);
                clear("symbol");
                if (!px && item.price && type !== "DIVIDEND") setPx(String(item.price));
              }}
            />
          )}
        </Field>
        <Field label={COPY[type].qty} error={show("qty")} hint={flag("quantity")} tour="tx-quantity">
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                clear("quantity");
              }}
              placeholder="0"
              className={flags.quantity ? WARN : undefined}
            />
          )}
        </Field>
        <Field label={COPY[type].price} error={show("price")} hint={flag("price")} tour="tx-price">
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              prefix="₹"
              value={px}
              onChange={(e) => {
                setPx(e.target.value);
                clear("price");
              }}
              placeholder="0.00"
              className={flags.price ? WARN : undefined}
            />
          )}
        </Field>
        <Field label="Date" error={show("date")} hint={flag("transaction_date")}>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={todayIso()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                clear("transaction_date");
              }}
              className={flags.transaction_date ? WARN : undefined}
            />
          )}
        </Field>
        {type !== "DIVIDEND" ? (
          <Field label="Fees and charges" hint="Brokerage, STT, stamp duty">
            {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={fees} onChange={(e) => setFees(e.target.value)} placeholder="0.00" />}
          </Field>
        ) : (
          <div />
        )}
        <Field label="Notes" className="col-span-2">
          {(props) => <Textarea {...props} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" maxLength={500} />}
        </Field>
        <div data-tour="tx-total" className="col-span-2 flex items-center justify-between rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-line">
          <span className="text-[13px] text-muted">{COPY[type].total}</span>
          <span className="num text-base font-semibold text-ink">{inr(total)}</span>
        </div>
        {!editing && type !== "DIVIDEND" && symbol && (
          <button type="button" onClick={checkFirst} className="col-span-2 -mt-1 flex w-fit items-center gap-1.5 text-left text-[13px] font-medium text-accent hover:underline">
            <ClipboardCheck className="size-4 shrink-0" aria-hidden />
            Haven't made this trade yet? Check it first
          </button>
        )}
      </form>
    </Dialog>
  );
}
