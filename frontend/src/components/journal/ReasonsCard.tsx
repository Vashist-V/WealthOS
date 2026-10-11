/**
 * "Your reasons", on a trade check result.
 *
 * Writing down why, for how long and what would change your mind is the
 * cheapest discipline in investing, and it only works when it is asked at the
 * moment of deciding. What is written here is kept as a Journal entry, where it
 * can later be held against what actually happened.
 */
import { ArrowRight, Check, NotebookPen } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button, Card, Field, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { todayIso } from "@/lib/format";
import { ALL } from "@/lib/portfolio";
import { useAction } from "@/lib/queries";
import type { JournalInput, TradeCheck } from "@/lib/types";
import { HORIZONS, JOURNAL_KEYS } from "./shared";

export function ReasonsCard({ report }: { report: TradeCheck }) {
  const buying = report.side === "BUY";
  const [why, setWhy] = useState("");
  const [horizon, setHorizon] = useState("");
  const [exit, setExit] = useState("");
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  // A different trade is a different decision: start the form again.
  useEffect(() => {
    setWhy("");
    setHorizon("");
    setExit("");
    setTouched(false);
    setSaved(false);
  }, [report.symbol, report.side, report.portfolio.id]);

  const score = report.score;
  const body: JournalInput = {
    symbol: report.symbol,
    portfolio_id: report.portfolio.id === ALL ? null : report.portfolio.id,
    action: report.side,
    entry_price: Math.round(report.price * 100) / 100,
    entry_date: todayIso(),
    horizon,
    thesis: why.trim(),
    // The score as it stood, so that a later review can tell the reasoning from the evidence it was given.
    reasons: score.value === null ? [] : [`Trade check gave this ${buying ? "buy" : "sale"} ${score.value} out of 100 when this was written: ${score.for} checks for, ${score.against} against.`],
    exit_conditions: exit.trim(),
    conviction: 3,
    tags: ["trade-check"],
    status: "open",
    outcome_notes: "",
    closed_at: null,
  };
  const save = useAction(() => api.createJournal(body), { invalidate: JOURNAL_KEYS, success: `Reasons saved for ${report.symbol}`, onSuccess: () => setSaved(true) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (why.trim()) save.mutate(undefined);
  };

  if (saved)
    return (
      <Card tour="tc-reasons">
        <div className="flex items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gain-soft text-gain">
            <Check className="size-4" strokeWidth={2.6} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">Your reasons are in the journal</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              The journal will show how {report.symbol} does from here beside the index, so you can look back and see whether the reasoning held.
            </p>
            <Link to="/journal" className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">
              Open the journal <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </Card>
    );

  return (
    <Card tour="tc-reasons" title="Before you decide, write down why" description="Three lines now are worth more than a score later. They are kept in your journal.">
      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <Field label={buying ? `Why buy ${report.symbol}?` : `Why sell ${report.symbol}?`} error={touched && !why.trim() ? "One sentence is enough" : null}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={4000}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder={buying ? "e.g. Profits have grown for five years and the price is back at its average." : "e.g. It has grown to a third of my portfolio and I want to spread the risk."}
            />
          )}
        </Field>
        {buying && (
          <Field label="How long do you plan to hold it?">
            {(props) => (
              <Select {...props} value={horizon} onChange={(e) => setHorizon(e.target.value)}>
                <option value="">Not decided</option>
                {HORIZONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={buying ? "What would change your mind?" : "What would make you buy it back?"}>
          {(props) => (
            <Textarea
              {...props}
              rows={2}
              maxLength={2000}
              value={exit}
              onChange={(e) => setExit(e.target.value)}
              placeholder={buying ? "e.g. Two quarters of falling profit, or debt rising faster than sales." : "e.g. A fall of a fifth with the business unchanged."}
            />
          )}
        </Field>
        <Button type="submit" className="w-full" icon={<NotebookPen className="size-4" />} loading={save.isPending}>
          Save my reasons
        </Button>
      </form>
    </Card>
  );
}
