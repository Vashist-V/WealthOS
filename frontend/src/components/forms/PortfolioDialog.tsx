import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { usePortfolio } from "@/lib/portfolio";
import { useAction } from "@/lib/queries";
import { PORTFOLIO_COLORS } from "@/lib/theme";
import type { Portfolio } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, Dialog, Field, Input, Segmented, Select, Textarea } from "../ui";

const BENCHMARKS = [
  { value: "^NSEI", label: "NIFTY 50" },
  { value: "^BSESN", label: "SENSEX" },
  { value: "^CRSLDX", label: "NIFTY 500" },
  { value: "^NSMIDCP", label: "NIFTY Next 50" },
];

/** Create a portfolio, or edit one when `editing` is given. */
export function PortfolioDialog({
  open,
  onOpenChange,
  editing,
  defaultKind = "investment",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Portfolio | null;
  defaultKind?: "investment" | "paper";
}) {
  const { select, portfolios } = usePortfolio();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"investment" | "paper">("investment");
  const [color, setColor] = useState(PORTFOLIO_COLORS[0]);
  const [benchmark, setBenchmark] = useState("^NSEI");
  const [cash, setCash] = useState("");
  const [capital, setCapital] = useState("1000000");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTouched(false);
    setName(editing?.name ?? "");
    setDescription(editing?.description ?? "");
    setKind(editing?.kind ?? defaultKind);
    setColor(editing?.color ?? PORTFOLIO_COLORS[portfolios.length % PORTFOLIO_COLORS.length]);
    setBenchmark(editing?.benchmark ?? "^NSEI");
    setCash(editing?.cash_balance ? String(editing.cash_balance) : "");
    setCapital(editing?.initial_capital ? String(editing.initial_capital) : "1000000");
  }, [open, editing, defaultKind, portfolios.length]);

  const nameError = !name.trim() ? "Give the portfolio a name" : null;
  const capitalError = kind === "paper" && !editing && !(parseFloat(capital) > 0) ? "Enter the virtual capital to start with" : null;

  const save = useAction(
    () =>
      editing
        ? api.updatePortfolio(editing.id, { name: name.trim(), description: description.trim(), color, benchmark, ...(kind === "investment" ? { cash_balance: parseFloat(cash) || 0 } : {}) })
        : api.createPortfolio({
            name: name.trim(), description: description.trim(), kind, color, benchmark,
            cash_balance: kind === "investment" ? parseFloat(cash) || 0 : 0,
            initial_capital: kind === "paper" ? parseFloat(capital) : 0,
          }),
    {
      invalidate: "portfolio",
      success: editing ? "Portfolio updated" : "Portfolio created",
      onSuccess: (created) => {
        if (!editing) select(created.id);
        onOpenChange(false);
      },
    },
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!nameError && !capitalError) save.mutate(undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit portfolio" : "New portfolio"}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="portfolio-form" loading={save.isPending}>
            {editing ? "Save changes" : "Create portfolio"}
          </Button>
        </>
      }
    >
      <form id="portfolio-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {!editing && (
          <div>
            <Segmented
              label="Portfolio type"
              value={kind}
              onChange={setKind}
              options={[{ value: "investment", label: "Investment" }, { value: "paper", label: "Paper trading" }]}
            />
            <p className="mt-2 text-xs text-muted">
              {kind === "investment"
                ? "Tracks real holdings. You record each buy and sell yourself."
                : "Starts with virtual cash. Orders fill at the latest market price; no real money moves."}
            </p>
          </div>
        )}
        <Field label="Name" error={touched ? nameError : null}>
          {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder="Long-Term Investments" maxLength={60} autoFocus />}
        </Field>
        <Field label="Description">
          {(props) => <Textarea {...props} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this portfolio is for (optional)" maxLength={240} />}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Benchmark" hint="Returns and risk are compared with this index.">
            {(props) => (
              <Select {...props} value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
                {BENCHMARKS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {kind === "investment" ? (
            <Field label="Cash balance" hint="Uninvested cash, shown in asset allocation.">
              {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0" />}
            </Field>
          ) : (
            <Field label="Starting capital" error={touched ? capitalError : null} hint={editing ? "Fixed once the portfolio exists." : "Virtual money to trade with."}>
              {(props) => (
                <Input {...props} type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={capital} onChange={(e) => setCapital(e.target.value)} disabled={!!editing} />
              )}
            </Field>
          )}
        </div>
        <div>
          <div className="mb-2 text-[13px] font-medium text-ink-2">Colour</div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Portfolio colour">
            {PORTFOLIO_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color.toLowerCase() === c.toLowerCase()}
                aria-label={`Colour ${c}`}
                onClick={() => setColor(c)}
                className={cn("flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110", color.toLowerCase() === c.toLowerCase() && "ring-2 ring-ink ring-offset-2 ring-offset-surface")}
                style={{ background: c }}
              >
                {color.toLowerCase() === c.toLowerCase() && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
