import { ClipboardCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { inr, quantity as fmtQty, todayIso } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useAction, useOverview } from "@/lib/queries";
import type { Transaction, TransactionInput, TxType } from "@/lib/types";
import { Button, Dialog, Field, Input, Segmented, Select, Textarea } from "../ui";
import { SymbolPicker } from "./SymbolPicker";

export interface TransactionDraft {
  portfolioId?: string;
  symbol?: string;
  type?: TxType;
  quantity?: number;
  price?: number;
}

const COPY: Record<TxType, { qty: string; price: string; total: string }> = {
  BUY: { qty: "Quantity", price: "Buy price", total: "Total cost" },
  SELL: { qty: "Quantity", price: "Sell price", total: "Net proceeds" },
  DIVIDEND: { qty: "Shares held", price: "Dividend per share", total: "Dividend received" },
};

/** Add a transaction, or edit one when `editing` is given. */
export function TransactionDialog({
  open,
  onOpenChange,
  draft,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft?: TransactionDraft;
  editing?: Transaction | null;
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

  useEffect(() => {
    if (!open) return;
    setTouched(false);
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
        <div className="col-span-2">
          <Segmented<TxType>
            tour="tx-type"
            label="Transaction type"
            value={type}
            onChange={setType}
            options={[{ value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" }, { value: "DIVIDEND", label: "Dividend" }]}
          />
        </div>
        {!editing && manual.length > 1 && (
          <Field label="Portfolio" error={show("portfolio")} className="col-span-2">
            {(props) => (
              <Select {...props} value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
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
          hint={held ? `You hold ${fmtQty(held.quantity)} at an average of ${inr(held.avg_cost)}` : undefined}
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
                if (!px && item.price && type !== "DIVIDEND") setPx(String(item.price));
              }}
            />
          )}
        </Field>
        <Field label={COPY[type].qty} error={show("qty")} tour="tx-quantity">
          {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />}
        </Field>
        <Field label={COPY[type].price} error={show("price")} tour="tx-price">
          {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={px} onChange={(e) => setPx(e.target.value)} placeholder="0.00" />}
        </Field>
        <Field label="Date" error={show("date")}>
          {(props) => <Input {...props} type="date" max={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />}
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
