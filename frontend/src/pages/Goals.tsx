import { Check, MoreHorizontal, Pencil, Plus, Target, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { TimeSeriesChart } from "@/components/charts";
import { GOAL_IDEAS, GoalDialog } from "@/components/forms/GoalDialog";
import { ScenarioNote } from "@/components/lab/shared";
import { Badge, Button, Card, CardSkeleton, ConfirmDialog, EmptyState, ErrorState, IconButton, InfoHint, Menu, MenuItem, Page } from "@/components/ui";
import { api } from "@/lib/api";
import { compact, date, duration, inr } from "@/lib/format";
import { futureValue, monthsAhead } from "@/lib/goals";
import { useAction, useGoals } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Goal, GoalScenario } from "@/lib/types";
import { cn } from "@/lib/utils";

/** "May 2032": a month far enough off that a two-digit year would read as a day. */
const month = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });

const STATUS: Record<Goal["status"], { label: string; tone: "gain" | "warn" | "loss" | "neutral"; color: string }> = {
  reached: { label: "Reached", tone: "gain", color: "var(--gain)" },
  on_track: { label: "On track", tone: "gain", color: "var(--gain)" },
  close: { label: "Close", tone: "warn", color: "var(--warn)" },
  behind: { label: "Behind", tone: "loss", color: "var(--loss)" },
  overdue: { label: "Date has passed", tone: "neutral", color: "var(--muted)" },
};

/** Where the goal stands, in one sentence. The three assumptions are cautious, middle and hopeful, in that order. */
function standing(goal: Goal): string {
  const middle = goal.scenarios[1];
  const plan = goal.monthly_amount;
  switch (goal.status) {
    case "reached":
      return "You already have the amount. Anything more is a cushion.";
    case "overdue":
      return `The date has passed with ${inr(goal.target_amount - goal.saved)} still to go. Edit the goal to set a new date.`;
    case "on_track":
      return plan > 0 ? `${inr(plan)} a month gets there in time at the middle assumption.` : "It gets there in time at the middle assumption without adding anything.";
    case "close":
      return `It gets there only at the hopeful assumption. At the middle one it needs ${inr(Math.ceil(middle.required_monthly))} a month.`;
    default:
      return `It needs about ${inr(Math.ceil(middle.required_monthly))} a month at the middle assumption${plan > 0 ? `; you plan ${inr(plan)}.` : ", and nothing is planned yet."}`;
  }
}

function Ring({ value, color }: { value: number; color: string }) {
  const r = 38;
  const round = 2 * Math.PI * r;
  return (
    <div className="relative size-[104px] shrink-0">
      <svg viewBox="0 0 96 96" className="size-full -rotate-90" role="img" aria-label={`${value.toFixed(0)}% of the target saved`}>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="9" />
        {value > 0 && <circle cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(Math.min(value, 100) / 100) * round} ${round}`} />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="num text-xl font-semibold leading-none tracking-tight text-ink">{value.toFixed(0)}%</span>
        <span className="mt-1 text-[11px] text-muted">saved</span>
      </div>
    </div>
  );
}

/** One assumed return: what it asks for each month, and where the plan as it stands would end up. */
function Assumed({ scenario, goal }: { scenario: GoalScenario; goal: Goal }) {
  const done = goal.status === "reached";
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 px-3 py-2.5 ring-1 ring-inset ring-line">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="truncate">
          {scenario.label} · {(scenario.rate * 100).toFixed(0)}% a year
        </span>
        <InfoHint text={`${scenario.basis} An assumption, not a forecast.`} />
      </div>
      <div className="num mt-1 truncate text-[17px] font-semibold tracking-tight text-ink">{done || scenario.required_monthly < 1 ? "Nothing more" : inr(Math.ceil(scenario.required_monthly))}</div>
      <div className="text-[11px] text-muted">{done || scenario.required_monthly < 1 ? "needed" : "needed each month"}</div>
      {!done && goal.months_left > 0 && (
        <div className={cn("mt-2 flex items-start gap-1 border-t border-line pt-2 text-xs leading-snug", scenario.reaches ? "text-gain" : "text-ink-2")}>
          {scenario.reaches && <Check className="mt-px size-3.5 shrink-0" strokeWidth={2.6} aria-hidden />}
          <span>
            {scenario.reaches
              ? `Your plan reaches ${compact(scenario.projected)}`
              : `Your plan reaches ${compact(scenario.projected)}, ${compact(scenario.shortfall)} short${scenario.reach_date ? `; there by ${month.format(new Date(`${scenario.reach_date}T00:00:00`))}` : ""}`}
          </span>
        </div>
      )}
    </div>
  );
}

/** Where the plan as it stands would take the money under each assumption, against the target. */
function Path({ goal }: { goal: Goal }) {
  const { chart } = useTheme();
  const dates = useMemo(() => monthsAhead(goal.months_left), [goal.months_left]);
  const series = useMemo(
    () => [
      ...[...goal.scenarios].reverse().map((s) => ({
        name: `${s.label} (${(s.rate * 100).toFixed(0)}%)`,
        data: dates.map((_, month) => Math.round(futureValue(goal.saved, goal.monthly_amount, s.rate, month))),
      })),
      { name: "Target", data: dates.map(() => goal.target_amount), dashed: true, color: chart.muted },
    ],
    [goal, dates, chart.muted],
  );
  return <TimeSeriesChart label={`Where ${goal.name} is heading under each assumption`} dates={dates} series={series} format="inr" height={190} />;
}

function GoalCard({ goal, inflation, onEdit, onDelete }: { goal: Goal; inflation: number; onEdit: () => void; onDelete: () => void }) {
  const status = STATUS[goal.status];
  return (
    <Card
      title={goal.name}
      description={`${compact(goal.target_amount)} by ${date(goal.target_date)}`}
      action={
        <>
          <Badge tone={status.tone}>{status.label}</Badge>
          <Menu trigger={<IconButton label={`Options for ${goal.name}`}><MoreHorizontal className="size-4" /></IconButton>}>
            <MenuItem icon={<Pencil />} onSelect={onEdit}>Edit goal</MenuItem>
            <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>Delete goal</MenuItem>
          </Menu>
        </>
      }
    >
      <div className="flex items-center gap-4 sm:gap-5">
        <Ring value={goal.progress} color={status.color} />
        <div className="min-w-0 flex-1">
          <div className="num text-[22px] font-semibold leading-tight tracking-tight text-ink">{inr(goal.saved)}</div>
          <div className="mt-0.5 text-[13px] text-muted">
            of {inr(goal.target_amount)} · {goal.linked_portfolio ? `the value of ${goal.linked_portfolio}` : "the amount you entered"}
          </div>
          <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
            <div>
              <dt className="inline text-muted">Time left </dt>
              <dd className="inline font-medium text-ink">{goal.months_left > 0 ? duration(goal.months_left * 30.44) : "None"}</dd>
            </div>
            <div>
              <dt className="inline text-muted">Adding </dt>
              <dd className="num inline font-medium text-ink">{goal.monthly_amount > 0 ? `${inr(goal.monthly_amount)} a month` : "Nothing yet"}</dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-ink-2">{standing(goal)}</p>

      <div className="mt-3.5 grid gap-2.5 sm:grid-cols-3">
        {goal.scenarios.map((s) => (
          <Assumed key={s.id} scenario={s} goal={goal} />
        ))}
      </div>

      {goal.months_left >= 2 && goal.status !== "reached" && (
        <div className="mt-4">
          <Path goal={goal} />
        </div>
      )}

      {goal.months_left >= 12 && (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Prices rise. If they go up {(inflation * 100).toFixed(0)}% a year, {compact(goal.target_amount)} in {new Date(goal.target_date).getFullYear()} buys what {compact(goal.todays_money)} buys today, so check the target still covers what you
          have in mind.
        </p>
      )}
    </Card>
  );
}

export function GoalsPage() {
  const goals = useGoals();
  const [dialog, setDialog] = useState<{ editing: Goal | null; starter?: string } | null>(null);
  const [removing, setRemoving] = useState<Goal | null>(null);
  const remove = useAction((goal: Goal) => api.deleteGoal(goal.id), { invalidate: ["goals"], success: "Goal deleted", onSuccess: () => setRemoving(null) });

  const list = goals.data?.goals ?? [];
  return (
    <Page
      title="Goals"
      description="Name what the money is for, when you need it and what you can add each month. WealthOS shows what it takes to get there."
      actions={list.length > 0 && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({ editing: null })}>New goal</Button>}
    >
      {goals.isError ? (
        <Card>
          <ErrorState error={goals.error} onRetry={() => goals.refetch()} />
        </Card>
      ) : !goals.data ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <CardSkeleton height={360} />
          <CardSkeleton height={360} />
        </div>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            className="py-14"
            icon={<Target />}
            title="What is the money for?"
            description="Investing is easier to stick with when it has a purpose. Pick one to start with, or name your own."
            action={
              <>
                {GOAL_IDEAS.map((idea) => (
                  <Button key={idea} onClick={() => setDialog({ editing: null, starter: idea })}>{idea}</Button>
                ))}
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDialog({ editing: null })}>Something else</Button>
              </>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {list.map((goal) => (
              <GoalCard key={goal.id} goal={goal} inflation={goals.data.inflation} onEdit={() => setDialog({ editing: goal })} onDelete={() => setRemoving(goal)} />
            ))}
          </div>
          <ScenarioNote className="mt-4">
            Each goal is worked out under three assumed yearly returns ({goals.data.assumptions.map((a) => `${(a.rate * 100).toFixed(0)}%`).join(", ")}), as if the money grew by that much steadily every year. Real
            returns arrive unevenly and can be negative for years at a time, so treat these as a way to size a monthly amount, not as a promise. This is not investment advice.
          </ScenarioNote>
        </>
      )}

      <GoalDialog open={!!dialog} onOpenChange={(open) => !open && setDialog(null)} editing={dialog?.editing} starter={dialog?.starter} assumptions={goals.data?.assumptions ?? []} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Delete this goal?"
        description={removing ? `${removing.name} will be removed. Your portfolios and transactions are not touched.` : ""}
        confirmLabel="Delete goal"
        onConfirm={() => removing && remove.mutate(removing)}
        loading={remove.isPending}
      />
    </Page>
  );
}
