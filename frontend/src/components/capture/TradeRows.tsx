/**
 * Trades read by AI, shown for the user to check and correct before anything
 * is saved. Every field can be changed; a field the reader was unsure of, or
 * that disagrees with the market's own prices, is marked in amber with the
 * reason, and the mark goes once the user changes it or says it looks right.
 */
import { AlertTriangle, Check, Trash2 } from "lucide-react";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { Field, IconButton, Input, Segmented, Select } from "@/components/ui";
import { todayIso } from "@/lib/format";
import type { Portfolio, TradeField, TradeProposal, TransactionInput } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface TradeRow {
  key: string;
  symbol: string;
  name: string | null;
  readAs: string;
  type: "BUY" | "SELL";
  quantity: string;
  price: string;
  date: string;
  time: string | null;
  /** Which screenshot it came from, as the user numbered them (1 = the first they added). */
  screenshot: number | null;
  notes: string;
  portfolioId: string;
  /** Marks for a second look, with the reason. */
  check: Partial<Record<TradeField, string>>;
}

export const FIELD_NAMES: Record<TradeField, string> = {
  symbol: "Stock",
  transaction_type: "Buy or sell",
  quantity: "Shares",
  price: "Price",
  transaction_date: "Date",
  portfolio_id: "Portfolio",
};

let made = 0;

export function toRow(p: TradeProposal, screenshot: number | null = p.screenshot, fallbackPortfolio = ""): TradeRow {
  made += 1;
  return {
    key: `${p.id}-${made}`,
    symbol: p.symbol ?? "",
    name: p.name,
    readAs: p.read_as,
    type: p.transaction_type,
    quantity: p.quantity != null ? String(p.quantity) : "",
    price: p.price != null ? String(p.price) : "",
    date: p.transaction_date,
    time: p.time,
    screenshot,
    notes: p.notes,
    portfolioId: p.portfolio_id ?? fallbackPortfolio,
    check: { ...p.check },
  };
}

export function blankRow(portfolioId: string, notes: string): TradeRow {
  made += 1;
  return {
    key: `new-${made}`, symbol: "", name: null, readAs: "", type: "BUY", quantity: "", price: "", date: todayIso(), time: null,
    screenshot: null, notes, portfolioId, check: {},
  };
}

/** What must be fixed before the row can be saved. */
export function problems(row: TradeRow): Partial<Record<TradeField, string>> {
  const out: Partial<Record<TradeField, string>> = {};
  const q = Number(row.quantity);
  const p = Number(row.price);
  if (!row.symbol) out.symbol = "Pick the stock";
  if (!row.quantity.trim() || !(q > 0)) out.quantity = "Enter the number of shares";
  if (!row.price.trim() || !(p >= 0) || !Number.isFinite(p)) out.price = "Enter the price per share";
  if (!row.date) out.transaction_date = "Choose a date";
  else if (row.date > todayIso()) out.transaction_date = "The date can't be in the future";
  if (!row.portfolioId) out.portfolio_id = "Choose a portfolio";
  return out;
}

export function toInput(row: TradeRow): TransactionInput {
  return {
    symbol: row.symbol,
    transaction_type: row.type,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fees: 0,
    transaction_date: row.date,
    notes: row.notes.slice(0, 500),
  };
}

/** Oldest first, a day's buys before its sales, the way the ledger reads them. */
export function inOrder(rows: TradeRow[]): TradeRow[] {
  return [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "").localeCompare(b.time ?? "") || (a.type === b.type ? 0 : a.type === "BUY" ? -1 : 1));
}

const FLAGGED = "border-warn bg-warn-soft/60 ring-2 ring-warn/20 hover:border-warn";

/** The trades as editable rows. */
export function TradeRows({
  rows,
  onChange,
  portfolios,
  compact,
}: {
  rows: TradeRow[];
  onChange: (rows: TradeRow[]) => void;
  /** Show a portfolio choice on each row (the chat does; the screenshot import picks one for all). */
  portfolios?: Portfolio[];
  /** One column, for the narrow chat panel. */
  compact?: boolean;
}) {
  const update = (key: string, change: Partial<TradeRow>, cleared?: TradeField) =>
    onChange(
      rows.map((r) => {
        if (r.key !== key) return r;
        const check = { ...r.check };
        if (cleared) delete check[cleared];
        return { ...r, ...change, check };
      }),
    );
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));
  const grid = compact ? "grid grid-cols-2 gap-x-2.5 gap-y-2.5" : "grid grid-cols-2 gap-x-2.5 gap-y-2.5 sm:grid-cols-[minmax(0,1.7fr)_8.5rem_5.5rem_7rem_9.25rem_2rem] sm:items-start sm:gap-y-0";
  // Each field is labelled; on a wide screen one header row does it instead.
  const label = compact ? "" : "sm:[&>label]:sr-only";

  return (
    <div className="flex flex-col gap-2.5">
      {!compact && rows.length > 0 && (
        <div className={cn(grid, "px-3 text-xs font-medium text-muted max-sm:hidden")} aria-hidden>
          <span>Stock</span>
          <span>Buy or sell</span>
          <span>Shares</span>
          <span>Price per share</span>
          <span>Date</span>
          <span />
        </div>
      )}
      {rows.map((row, index) => {
        const wrong = problems(row);
        const flags = Object.entries(row.check).filter(([, why]) => why) as [TradeField, string][];
        const flagged = (field: TradeField) => !!row.check[field];
        const meta = [
          row.readAs && row.readAs.toUpperCase() !== row.symbol ? `Read as “${row.readAs}”` : null,
          row.screenshot ? `Screenshot ${row.screenshot}` : null,
          row.time ? `at ${row.time}` : null,
        ].filter(Boolean);
        return (
          <div
            key={row.key}
            className={cn("rounded-xl px-3 py-3 ring-1 ring-inset", flags.length ? "bg-warn-soft/25 ring-warn/35" : "bg-surface ring-line")}
            aria-label={`Trade ${index + 1}`}
            role="group"
          >
            <div className={grid}>
              <Field label="Stock" className={cn("col-span-2 sm:col-span-1 [&>label]:text-xs", label)}>
                {(props) => (
                  <div className={cn("rounded-[10px]", flagged("symbol") && "ring-2 ring-warn/60")}>
                    <SymbolPicker
                      id={props.id}
                      value={row.symbol}
                      invalid={!!wrong.symbol && !flagged("symbol")}
                      placeholder="Search the stock"
                      onSelect={(item) => update(row.key, { symbol: item.symbol, name: item.name }, "symbol")}
                    />
                    {row.name && row.symbol && <p className="mt-1 truncate px-1 text-[11px] text-muted">{row.name}</p>}
                  </div>
                )}
              </Field>
              <Field label="Buy or sell" className={cn("[&>label]:text-xs", label)}>
                {() => (
                  <Segmented<"BUY" | "SELL">
                    label="Buy or sell"
                    value={row.type}
                    onChange={(type) => update(row.key, { type }, "transaction_type")}
                    options={[{ value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" }]}
                    className={cn("h-9 w-full items-center [&>button]:flex-1", flagged("transaction_type") && "ring-2 ring-warn/60")}
                  />
                )}
              </Field>
              <Field label="Shares" className={cn("[&>label]:text-xs", label)}>
                {(props) => (
                  <Input
                    {...props}
                    aria-invalid={!!wrong.quantity && !flagged("quantity") ? true : undefined}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={row.quantity}
                    onChange={(e) => update(row.key, { quantity: e.target.value }, "quantity")}
                    placeholder="0"
                    className={cn("num", flagged("quantity") && FLAGGED)}
                  />
                )}
              </Field>
              <Field label="Price per share" className={cn("[&>label]:text-xs", label)}>
                {(props) => (
                  <Input
                    {...props}
                    aria-invalid={!!wrong.price && !flagged("price") ? true : undefined}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    prefix="₹"
                    value={row.price}
                    onChange={(e) => update(row.key, { price: e.target.value }, "price")}
                    placeholder="0.00"
                    className={cn(flagged("price") && FLAGGED)}
                  />
                )}
              </Field>
              <Field label="Date" className={cn("[&>label]:text-xs", label, compact && "col-span-2")}>
                {(props) => (
                  <Input
                    {...props}
                    aria-invalid={!!wrong.transaction_date && !flagged("transaction_date") ? true : undefined}
                    type="date"
                    max={todayIso()}
                    value={row.date}
                    onChange={(e) => update(row.key, { date: e.target.value }, "transaction_date")}
                    className={cn(flagged("transaction_date") && FLAGGED)}
                  />
                )}
              </Field>
              {portfolios && portfolios.length > 1 && (
                <Field label="Portfolio" className="col-span-2 [&>label]:text-xs">
                  {(props) => (
                    <Select
                      {...props}
                      value={row.portfolioId}
                      onChange={(e) => update(row.key, { portfolioId: e.target.value }, "portfolio_id")}
                      className={cn(flagged("portfolio_id") && FLAGGED)}
                    >
                      {portfolios.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              <div className={cn("flex items-end justify-end", compact ? "col-span-2 -mt-1" : "col-span-2 -mt-1 sm:col-span-1 sm:mt-0 sm:items-start sm:pt-0.5")}>
                <IconButton label={`Remove trade ${index + 1}`} onClick={() => remove(row.key)} className="text-muted hover:text-loss">
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            </div>

            {flags.length > 0 && (
              <div className="mt-2.5 flex flex-col gap-1.5">
                {flags.map(([field, why]) => (
                  <p key={field} className="flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
                    <span>
                      <span className="font-medium text-warn">{FIELD_NAMES[field]}:</span> {why}
                    </span>
                  </p>
                ))}
                <button
                  type="button"
                  onClick={() => onChange(rows.map((r) => (r.key === row.key ? { ...r, check: {} } : r)))}
                  className="inline-flex w-fit items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <Check className="size-3.5" aria-hidden /> It's right as it is
                </button>
              </div>
            )}
            {meta.length > 0 && <p className="mt-2 truncate text-[11px] text-muted">{meta.join(" · ")}</p>}
          </div>
        );
      })}
    </div>
  );
}
