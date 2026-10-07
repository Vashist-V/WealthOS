import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { api } from "@/lib/api";
import { inr, number, pct, price as fmtPrice, signedPct } from "@/lib/format";
import { useAction } from "@/lib/queries";
import type { AlertType } from "@/lib/types";
import { Button, Dialog, Field, Input, Select, Textarea } from "../ui";
import { SymbolPicker } from "./SymbolPicker";

export const ALERT_TYPES: { value: AlertType; label: string }[] = [
  { value: "price_above", label: "Price rises to" },
  { value: "price_below", label: "Price falls to" },
  { value: "pct_change", label: "Moves by % in a day" },
  { value: "earnings", label: "Results within N days" },
  { value: "dividend", label: "Ex-dividend date within N days" },
];

export const isPriceAlert = (type: AlertType) => type === "price_above" || type === "price_below";
const isDaysAlert = (type: AlertType) => type === "earnings" || type === "dividend";

const whole = (v: number, scale = 1) => Math.abs(v * scale - Math.round(v * scale)) < 1e-9;
const rupees = (v: number) => (whole(v) ? inr(v) : fmtPrice(v));
const percent = (v: number) => pct(v, whole(v) ? 0 : whole(v, 10) ? 1 : 2);
const dayCount = (v: number) => `${number(v)} day${v === 1 ? "" : "s"}`;

/** The rule in plain words: "Price rises to ₹1,290", "Moves 4% or more in a day". */
export function alertRule(type: AlertType, threshold: number): string {
  switch (type) {
    case "price_above":
      return `Price rises to ${rupees(threshold)}`;
    case "price_below":
      return `Price falls to ${rupees(threshold)}`;
    case "pct_change":
      return `Moves ${percent(threshold)} or more in a day`;
    case "earnings":
      return `Results within ${dayCount(threshold)}`;
    case "dividend":
      return `Ex-dividend date within ${dayCount(threshold)}`;
  }
}

const FIELDS: Record<AlertType, { label: string; prefix?: string; suffix?: string; placeholder: string }> = {
  price_above: { label: "Target price", prefix: "₹", placeholder: "0.00" },
  price_below: { label: "Target price", prefix: "₹", placeholder: "0.00" },
  pct_change: { label: "Size of the move", suffix: "%", placeholder: "5" },
  earnings: { label: "Days before the results date", suffix: "days", placeholder: "7" },
  dividend: { label: "Days before the ex-dividend date", suffix: "days", placeholder: "7" },
};

/** Round a suggested trigger to a figure someone would actually type. */
function tidy(v: number): number {
  const step = v >= 5000 ? 10 : v >= 1000 ? 5 : v >= 100 ? 1 : v >= 10 ? 0.1 : 0.05;
  return Math.round(Math.round(v / step) * step * 100) / 100;
}

function suggestion(type: AlertType, current: number | null): string {
  if (type === "pct_change") return "5";
  if (isDaysAlert(type)) return "7";
  return current ? String(tidy(current * (type === "price_above" ? 1.05 : 0.95))) : "";
}

/** Create an alert. `symbol` and `price` pre-fill the form when it is opened from a stock. */
export function AlertDialog({
  open,
  onOpenChange,
  symbol: presetSymbol,
  price: presetPrice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol?: string;
  price?: number | null;
}) {
  const [symbol, setSymbol] = useState("");
  const [known, setKnown] = useState<number | null>(null);
  const [type, setType] = useState<AlertType>("price_above");
  const [threshold, setThreshold] = useState("");
  const [edited, setEdited] = useState(false);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  // Reset only when the dialog opens: the caller's live price must not wipe a half-filled form.
  useEffect(() => {
    if (!open) return;
    setSymbol(presetSymbol ?? "");
    setKnown(presetPrice ?? null);
    setType("price_above");
    setThreshold("");
    setEdited(false);
    setNote("");
    setTouched(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const quote = useQuery({
    queryKey: ["quotes", symbol],
    queryFn: () => api.quotes([symbol]),
    enabled: open && !!symbol,
    staleTime: 30_000,
  });
  const live = quote.data?.[symbol];
  const current = live?.price ?? known;

  // Until the user types a threshold, keep suggesting one that fits the type and the stock.
  useEffect(() => {
    if (open && !edited) setThreshold(suggestion(type, current));
  }, [open, edited, type, current]);

  const field = FIELDS[type];
  const value = parseFloat(threshold);
  const errors = {
    symbol: !symbol ? "Pick a stock" : null,
    threshold: !(value > 0)
      ? isPriceAlert(type) ? "Enter a price above zero" : isDaysAlert(type) ? "Enter a number of days" : "Enter a percentage above zero"
      : isDaysAlert(type) && !Number.isInteger(value) ? "Enter a whole number of days"
      : isDaysAlert(type) && value > 365 ? "Enter 365 days or fewer"
      : null,
  };
  const valid = !errors.symbol && !errors.threshold;

  let hint: ReactNode;
  if (isPriceAlert(type)) {
    if (!symbol) hint = "Pick a stock to see its current price.";
    else if (!current) hint = quote.isFetching ? "Fetching the current price…" : undefined;
    else if (!(value > 0)) hint = `Now ${fmtPrice(current)}`;
    else {
      const reached = type === "price_above" ? current >= value : current <= value;
      hint = reached
        ? `Now ${fmtPrice(current)}, already ${type === "price_above" ? "at or above" : "at or below"} this price, so the alert fires at the next check.`
        : `Now ${fmtPrice(current)}. The target is ${pct(Math.abs(value / current - 1) * 100, 1)} ${value > current ? "above" : "below"} it.`;
    }
  } else if (type === "pct_change") {
    hint = `Counts a rise or a fall from the previous close.${live ? ` Today so far: ${signedPct(live.change_pct)}.` : ""}`;
  } else {
    hint = `Fires once the next ${type === "earnings" ? "results" : "ex-dividend"} date is this close. Dates come from the data source and can change.`;
  }

  const save = useAction(() => api.createAlert({ symbol, alert_type: type, threshold: value, note: note.trim() }), {
    invalidate: ["alerts", "alerts-evaluate"],
    success: `Alert set for ${symbol}`,
    onSuccess: () => onOpenChange(false),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) save.mutate(undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New alert"
      description="Alerts are checked about once a minute while WealthOS is open, and each one fires once."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="alert-form" loading={save.isPending}>
            Create alert
          </Button>
        </>
      }
    >
      <form id="alert-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Stock" error={touched ? errors.symbol : null}>
          {(props) => (
            <SymbolPicker
              id={props.id}
              value={symbol}
              invalid={touched && !!errors.symbol}
              autoFocus={!presetSymbol}
              onSelect={(item) => {
                setSymbol(item.symbol);
                setKnown(item.price ?? null);
                if (isPriceAlert(type)) setEdited(false);
              }}
            />
          )}
        </Field>
        <Field label="Alert me when">
          {(props) => (
            <Select
              {...props}
              value={type}
              onChange={(e) => {
                setType(e.target.value as AlertType);
                setEdited(false);
              }}
            >
              {ALERT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={field.label} error={touched ? errors.threshold : null} hint={hint}>
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="decimal"
              min="0"
              step={isDaysAlert(type) ? "1" : "any"}
              prefix={field.prefix}
              suffix={field.suffix}
              className={field.suffix === "days" ? "pr-14" : undefined}
              value={threshold}
              placeholder={field.placeholder}
              onChange={(e) => {
                setThreshold(e.target.value);
                setEdited(true);
              }}
            />
          )}
        </Field>
        <Field label="Note">
          {(props) => <Textarea {...props} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this level matters (optional)" maxLength={240} />}
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-line">
          <span className="shrink-0 text-[13px] text-muted">This alert</span>
          <span className="min-w-0 truncate text-right text-sm font-medium text-ink">
            {symbol && value > 0 ? `${symbol} · ${alertRule(type, value)}` : "—"}
          </span>
        </div>
      </form>
    </Dialog>
  );
}
