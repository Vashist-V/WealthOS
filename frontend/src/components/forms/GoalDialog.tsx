import { useEffect, useState } from "react";
import { Labeled } from "@/components/journal/shared";
import { api } from "@/lib/api";
import { compact, inr, todayIso } from "@/lib/format";
import { monthsUntil, requiredMonthly } from "@/lib/goals";
import { usePortfolio } from "@/lib/portfolio";
import { useAction } from "@/lib/queries";
import type { Goal, GoalAssumption, GoalInput } from "@/lib/types";
import { Button, Dialog, Field, Input, Segmented, Select } from "../ui";

/** Names offered as one-tap starting points for a new goal. */
export const GOAL_IDEAS = ["Emergency fund", "A home", "Child's education", "Retirement", "A big trip"];

type Source = "portfolio" | "amount";

/** Create a goal, or edit one when `editing` is given. `starter` is a name to begin a new one with; `assumptions` are the yearly returns the preview is worked out under. */
export function GoalDialog({ open, onOpenChange, editing, starter, assumptions }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Goal | null;
  starter?: string;
  assumptions: GoalAssumption[];
}) {
  const { investment } = usePortfolio();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [due, setDue] = useState("");
  const [source, setSource] = useState<Source>("amount");
  const [portfolioId, setPortfolioId] = useState("");
  const [saved, setSaved] = useState("");
  const [monthly, setMonthly] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    const linked = editing?.portfolio_id && investment.some((p) => p.id === editing.portfolio_id) ? editing.portfolio_id : "";
    setTouched(false);
    setName(editing?.name ?? starter ?? "");
    setTarget(editing ? String(editing.target_amount) : "");
    setDue(editing?.target_date.slice(0, 10) ?? "");
    setSource(editing ? (linked ? "portfolio" : "amount") : investment.length ? "portfolio" : "amount");
    setPortfolioId(linked || investment[0]?.id || "");
    setSaved(editing?.saved_amount ? String(editing.saved_amount) : "");
    setMonthly(editing?.monthly_amount ? String(editing.monthly_amount) : "");
    // The form is filled once, as it opens; later refreshes of the lists must not overwrite what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, starter]);

  const targetValue = parseFloat(target);
  const errors = {
    name: !name.trim() ? "Say what the money is for" : null,
    target: !(targetValue > 0) ? "Enter the amount you are aiming for" : null,
    due: !due ? "Choose the date you need it by" : due <= todayIso() ? "Choose a date in the future" : null,
    portfolio: source === "portfolio" && !portfolioId ? "Choose a portfolio" : null,
  };
  const valid = Object.values(errors).every((e) => !e);
  const show = (key: keyof typeof errors) => (touched ? errors[key] : null);

  const linked = investment.find((p) => p.id === portfolioId);
  const have = source === "portfolio" ? (linked?.summary.net_worth ?? 0) : parseFloat(saved) || 0;
  const months = due ? monthsUntil(due) : 0;
  const preview = targetValue > 0 && months > 0 && assumptions.length ? assumptions.map((a) => ({ ...a, needed: requiredMonthly(targetValue, have, a.rate, months) })) : null;

  const body: GoalInput = {
    name: name.trim(),
    target_amount: targetValue,
    target_date: due,
    portfolio_id: source === "portfolio" ? portfolioId : null,
    saved_amount: source === "amount" ? parseFloat(saved) || 0 : 0,
    monthly_amount: parseFloat(monthly) || 0,
  };

  const save = useAction(() => (editing ? api.updateGoal(editing.id, body) : api.createGoal(body)), {
    invalidate: ["goals"],
    success: editing ? "Goal updated" : "Goal added",
    onSuccess: () => onOpenChange(false),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (valid) save.mutate(undefined);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit goal" : "New goal"}
      description="A target, a date, and what you can add each month."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="goal-form" loading={save.isPending}>
            {editing ? "Save changes" : "Add goal"}
          </Button>
        </>
      }
    >
      <form id="goal-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="What is it for?" error={show("name")}>
          {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder="A home" maxLength={80} autoFocus={!editing && !starter} />}
        </Field>
        {!editing && !name.trim() && (
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {GOAL_IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => setName(idea)}
                className="rounded-md bg-surface-2 px-2 py-1 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line transition-colors hover:text-ink hover:ring-line-strong"
              >
                {idea}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="How much?" error={show("target")}>
            {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="2500000" />}
          </Field>
          <Field label="By when?" error={show("due")}>
            {(props) => <Input {...props} type="date" min={todayIso()} value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
        </div>

        <Labeled label="What counts as saved so far?" error={show("portfolio")}>
          <Segmented<Source>
            label="What counts as saved so far"
            value={source}
            onChange={setSource}
            options={[{ value: "portfolio", label: "A portfolio's value" }, { value: "amount", label: "An amount I enter" }]}
          />
          <div className="mt-2.5">
            {source === "portfolio" ? (
              investment.length ? (
                <>
                  <Select aria-label="Portfolio" value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
                    {investment.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {compact(p.summary.net_worth)}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1.5 text-xs text-muted">The goal's progress follows this portfolio's value as prices move and as you add to it.</p>
                </>
              ) : (
                <p className="text-xs text-muted">You have no investment portfolio yet. Enter an amount instead, and link a portfolio later.</p>
              )
            ) : (
              <Input type="number" inputMode="decimal" min="0" step="any" prefix="₹" aria-label="Saved so far" value={saved} onChange={(e) => setSaved(e.target.value)} placeholder="0" />
            )}
          </div>
        </Labeled>

        <Field label="What you plan to add each month" hint="Leave it blank to see what the goal needs first.">
          {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="0" />}
        </Field>

        {preview && (
          <div className="rounded-xl bg-surface-2 p-3.5 ring-1 ring-inset ring-line" aria-live="polite">
            <div className="text-[13px] font-medium text-ink">What it would take each month</div>
            <div className="mt-2.5 grid grid-cols-3 gap-3">
              {preview.map((p) => (
                <div key={p.id} className="min-w-0">
                  <div className="truncate text-xs text-muted">
                    {p.label} · {(p.rate * 100).toFixed(0)}%
                  </div>
                  <div className="num mt-0.5 truncate text-[15px] font-semibold tracking-tight text-ink">{p.needed < 1 ? "Nothing more" : inr(Math.ceil(p.needed))}</div>
                </div>
              ))}
            </div>
            <p className="mt-2.5 text-xs leading-relaxed text-muted">
              Starting from {inr(have)}, over {months} month{months === 1 ? "" : "s"}, if the money grew by that much every year. These are assumptions, not forecasts: real returns arrive unevenly.
            </p>
          </div>
        )}
      </form>
    </Dialog>
  );
}
