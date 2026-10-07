import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, PieChart, Plus, SlidersHorizontal, TrendingDown, TrendingUp, Wallet, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { BarChart } from "@/components/charts";
import { useDebounced } from "@/components/forms/SymbolPicker";
import { GrowthChart } from "@/components/lab/GrowthChart";
import { parseNumber, ScenarioNote, tidyPct } from "@/components/lab/shared";
import { useAppActions } from "@/components/layout/AppShell";
import {
  Button, Card, CardSkeleton, DataTable, EmptyState, ErrorState, Field, IconButton, InfoHint, Input, Page, Segmented, Select, Signed, Skeleton,
  Switch, SymbolCell, Tooltip, type Column,
} from "@/components/ui";
import { PnlDelta } from "@/components/widgets";
import { api } from "@/lib/api";
import { inr, number, pct, signedInr, signedPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useOverview } from "@/lib/queries";
import { seriesColor, useTheme } from "@/lib/theme";
import type { Overview, ProjectionResult, ProjectionScenario, ShockResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "growth" | "shocks";

// ------------------------------------------------------------ growth plans
interface PlanDraft {
  key: number;
  label: string;
  initial: string;
  monthly: string;
  years: string;
  rate: string;
  stepUp: string;
}

type PlanField = "initial" | "monthly" | "years" | "rate" | "stepUp";
const MAX_PLANS = 4;

const STARTING_PLANS: PlanDraft[] = [
  { key: 1, label: "₹5,000 a month", initial: "200000", monthly: "5000", years: "5", rate: "12", stepUp: "" },
  { key: 2, label: "₹10,000 a month", initial: "200000", monthly: "10000", years: "5", rate: "12", stepUp: "" },
];

/** Check one plan's inputs and turn them into the request the engine expects. */
function readPlan(plan: PlanDraft, index: number): { scenario: ProjectionScenario | null; errors: Partial<Record<PlanField, string>> } {
  const initial = parseNumber(plan.initial) ?? 0;
  const monthly = parseNumber(plan.monthly) ?? 0;
  const years = parseNumber(plan.years);
  const rate = parseNumber(plan.rate);
  const stepUp = parseNumber(plan.stepUp) ?? 0;
  const errors: Partial<Record<PlanField, string>> = {};
  if (initial < 0 || initial > 1e12) errors.initial = "Enter an amount of zero or more";
  if (monthly < 0 || monthly > 1e10) errors.monthly = "Enter an amount of zero or more";
  else if (initial === 0 && monthly === 0) errors.monthly = "Enter a starting amount or a monthly investment";
  if (years === null || !Number.isInteger(years) || years < 1 || years > 50) errors.years = "1 to 50 years";
  if (rate === null || rate < -50 || rate > 100) errors.rate = "−50% to 100%";
  if (stepUp < 0 || stepUp > 50) errors.stepUp = "0% to 50%";
  if (Object.keys(errors).length) return { scenario: null, errors };
  return {
    scenario: { label: plan.label.trim() || `Plan ${index + 1}`, initial, monthly, years: years!, annual_return: rate! / 100, step_up: stepUp / 100 },
    errors,
  };
}

function describePlan(row: ProjectionResult): string {
  const parts = [row.initial > 0 ? inr(row.initial) : null, row.monthly > 0 ? `${inr(row.monthly)} a month` : null].filter(Boolean).join(" + ");
  const stepUp = row.step_up ? `, stepping up ${tidyPct(row.step_up * 100)} a year` : "";
  return `${parts} · ${row.years} year${row.years === 1 ? "" : "s"} at ${tidyPct(row.annual_return * 100)}${stepUp}`;
}

function PlanEditor({
  plan,
  index,
  errors,
  color,
  canRemove,
  onChange,
  onRemove,
}: {
  plan: PlanDraft;
  index: number;
  errors: Partial<Record<PlanField, string>>;
  color: string;
  canRemove: boolean;
  onChange: (patch: Partial<PlanDraft>) => void;
  onRemove: () => void;
}) {
  const initial = parseNumber(plan.initial);
  const monthly = parseNumber(plan.monthly);
  const amount = (field: PlanField, value: string) => ({
    type: "number" as const,
    inputMode: "decimal" as const,
    min: "0",
    step: "any",
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ [field]: e.target.value }),
  });
  return (
    <div className="rounded-xl bg-surface-2/60 p-3.5 ring-1 ring-inset ring-line">
      <div className="mb-3 flex items-center gap-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <Input
          aria-label={`Name of plan ${index + 1}`}
          value={plan.label}
          maxLength={60}
          placeholder={`Plan ${index + 1}`}
          onChange={(e) => onChange({ label: e.target.value })}
          className="h-8 font-medium"
        />
        <IconButton label={`Remove plan ${index + 1}`} disabled={!canRemove} onClick={onRemove}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        <Field label="Starting amount" className="col-span-2" error={errors.initial} hint={initial !== null && initial >= 1000 ? inr(initial) : undefined}>
          {(props) => <Input {...props} {...amount("initial", plan.initial)} prefix="₹" placeholder="0" />}
        </Field>
        <Field label="Monthly investment" className="col-span-2" error={errors.monthly} hint={monthly !== null && monthly >= 1000 ? `${inr(monthly)} every month` : undefined}>
          {(props) => <Input {...props} {...amount("monthly", plan.monthly)} prefix="₹" placeholder="0" />}
        </Field>
        <Field label="Years" error={errors.years}>
          {(props) => <Input {...props} {...amount("years", plan.years)} min="1" max="50" step="1" inputMode="numeric" />}
        </Field>
        <Field label="Return a year" error={errors.rate}>
          {(props) => <Input {...props} {...amount("rate", plan.rate)} min="-50" max="100" suffix="%" />}
        </Field>
        <Field label="Yearly step-up" className="col-span-2" error={errors.stepUp} hint="Optional. Raises the monthly amount by this much once a year.">
          {(props) => <Input {...props} {...amount("stepUp", plan.stepUp)} max="50" suffix="%" placeholder="0" />}
        </Field>
      </div>
    </div>
  );
}

function GrowthPlans() {
  const { chart } = useTheme();
  const { id, name } = usePortfolio();
  const overview = useOverview(id);
  const [plans, setPlans] = useState<PlanDraft[]>(STARTING_PLANS);
  const [nextKey, setNextKey] = useState(STARTING_PLANS.length + 1);

  const parsed = useMemo(() => plans.map(readPlan), [plans]);
  const candidate = useMemo(() => (parsed.every((p) => p.scenario) ? parsed.map((p) => p.scenario!) : null), [parsed]);
  // The last complete set of inputs, held back briefly so typing doesn't fire a request per keystroke.
  const [request, setRequest] = useState<ProjectionScenario[] | null>(candidate);
  useEffect(() => {
    if (!candidate) return;
    const timer = setTimeout(() => setRequest(candidate), 300);
    return () => clearTimeout(timer);
  }, [candidate]);

  const projection = useQuery({
    queryKey: ["projection", request],
    queryFn: () => api.projection(request!),
    enabled: !!request,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
  const rows = projection.data?.scenarios;
  const pending = projection.isPlaceholderData || candidate !== request;
  // Stable references, so the chart and table only redraw when the result itself changes.
  const tableRows = useMemo(() => (rows ?? []).map((r, index) => ({ ...r, index })), [rows]);
  const chartPlans = useMemo(() => (rows ?? []).map((r) => ({ name: r.label, values: r.points.map((p) => p.value) })), [rows]);

  const update = (key: number, patch: Partial<PlanDraft>) => setPlans((all) => all.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const addPlan = () => {
    const last = plans[plans.length - 1];
    setPlans([...plans, { ...last, key: nextKey, label: `Plan ${plans.length + 1}` }]);
    setNextKey(nextKey + 1);
  };

  const summary = overview.data?.summary;
  const portfolioValue = summary ? Math.round(overview.data!.portfolio.kind === "paper" ? summary.net_worth : summary.value) : null;

  const columns: Column<ProjectionResult & { index: number }>[] = [
    {
      key: "plan", header: "Plan",
      cell: (r) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: seriesColor(chart, r.index) }} aria-hidden />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{r.label}</div>
            <div className="text-xs text-muted">{describePlan(r)}</div>
          </div>
        </div>
      ),
    },
    { key: "invested", header: "Amount invested", align: "right", hide: "sm", cell: (r) => inr(r.total_invested) },
    { key: "value", header: "Projected value", align: "right", cell: (r) => <span className="font-medium text-ink">{inr(r.final_value)}</span> },
    {
      key: "gain", header: "Gain", align: "right",
      cell: (r) => (
        <div>
          <Signed value={r.gain}>{signedInr(r.gain)}</Signed>
          <div><Signed value={r.gain} className="text-xs">{r.total_invested > 0 ? signedPct((r.gain / r.total_invested) * 100, 1) : "—"}</Signed></div>
        </div>
      ),
    },
    {
      key: "multiple", header: "Multiple", align: "right", hide: "md", hint: "Projected value divided by the amount invested. 2.00× means the money doubled.",
      cell: (r) => (r.multiple == null ? "—" : `${number(r.multiple, 2)}×`),
    },
  ];

  const spread = useMemo(() => {
    if (!rows || rows.length < 2) return null;
    const sorted = [...rows].sort((a, b) => b.final_value - a.final_value);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    if (top.final_value === bottom.final_value) return null;
    const extra = top.total_invested - bottom.total_invested;
    const invested = extra > 0 ? `after putting in ${inr(extra)} more` : extra < 0 ? `after putting in ${inr(-extra)} less` : "on the same amount invested";
    return `${top.label} ends ${inr(top.final_value - bottom.final_value)} above ${bottom.label}, ${invested}.`;
  }, [rows]);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card
        title="Plans"
        description="Compare up to four ways of investing. Results update as you type."
        className="lg:col-span-12"
        action={
          <>
            {id && (
              <Tooltip content={portfolioValue ? `Sets every plan's starting amount to ${inr(portfolioValue)}, the current value of ${name}.` : `${name} has no value to start from yet.`}>
                <Button
                  size="sm"
                  icon={<Wallet className="size-3.5" />}
                  aria-disabled={!portfolioValue || undefined}
                  className={portfolioValue ? undefined : "cursor-not-allowed opacity-50"}
                  onClick={() => portfolioValue && setPlans((all) => all.map((p) => ({ ...p, initial: String(portfolioValue) })))}
                >
                  Use my portfolio value
                </Button>
              </Tooltip>
            )}
            <Button size="sm" icon={<Plus className="size-3.5" />} disabled={plans.length >= MAX_PLANS} onClick={addPlan}>
              Add plan
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan, i) => (
            <PlanEditor
              key={plan.key}
              plan={plan}
              index={i}
              errors={parsed[i].errors}
              color={seriesColor(chart, i)}
              canRemove={plans.length > 1}
              onChange={(patch) => update(plan.key, patch)}
              onRemove={() => setPlans((all) => all.filter((p) => p.key !== plan.key))}
            />
          ))}
        </div>
        {!candidate && <p className="mt-3 text-xs text-muted">Fix the highlighted fields to update the projection. The results below are from the last complete set of inputs.</p>}
      </Card>

      {projection.isError ? (
        <Card className="lg:col-span-12">
          <ErrorState error={projection.error} onRetry={() => projection.refetch()} />
        </Card>
      ) : !rows ? (
        <>
          <CardSkeleton height={160} className="lg:col-span-12" />
          <CardSkeleton height={300} className="lg:col-span-12" />
        </>
      ) : (
        <>
          <Card title="How the plans compare" description="At the end of each plan's period" className={cn("transition-opacity lg:col-span-12", pending && "opacity-60")} flush>
            <DataTable columns={columns} rows={tableRows} rowKey={(r) => String(r.index)} />
            {spread && <p className="border-t border-line px-4 py-3 text-[13px] leading-relaxed text-ink-2 sm:px-5">{spread}</p>}
          </Card>
          <Card title="Projected value by year" description="Each plan compounds monthly at its own fixed return" className={cn("transition-opacity lg:col-span-12", pending && "opacity-60")}>
            <GrowthChart label="Projected value of each plan by year" plans={chartPlans} />
            <ScenarioNote className="mt-4">
              Scenario analysis, not a forecast. Each plan assumes the same return every year with no bad years, which markets do not deliver. Nothing here changes your real portfolio.
            </ScenarioNote>
          </Card>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ shocks
type ScenarioKey = "down10" | "down20" | "up10" | "largest" | "sector" | "custom";
type ShockRequest = Parameters<typeof api.shock>[0];
type ShockRow = ShockResult["holdings"][number];

const SCENARIOS: { key: ScenarioKey; title: string; detail: string; icon: LucideIcon }[] = [
  { key: "down10", title: "Market falls 10%", detail: "Every holding moves with the market", icon: TrendingDown },
  { key: "down20", title: "Market falls 20%", detail: "Every holding moves with the market", icon: TrendingDown },
  { key: "up10", title: "Market rises 10%", detail: "Every holding moves with the market", icon: TrendingUp },
  { key: "largest", title: "Largest holding falls 50%", detail: "Only the biggest position moves", icon: TrendingDown },
  { key: "sector", title: "A sector moves", detail: "One sector moves, the rest stay put", icon: PieChart },
  { key: "custom", title: "Custom", detail: "Set a move for each holding", icon: SlidersHorizontal },
];
const MARKET_MOVE: Partial<Record<ScenarioKey, number>> = { down10: -0.1, down20: -0.2, up10: 0.1 };
const MAX_IMPACT_BARS = 12;

function ShockResultView({ result, pending, cash }: { result: ShockResult; pending: boolean; cash: number }) {
  const moved = useMemo(() => result.holdings.filter((h) => h.change !== 0), [result]);
  // The biggest impacts, losses first; held in memos so the chart only redraws for a new result.
  const impact = useMemo(() => {
    const bars = [...moved].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, MAX_IMPACT_BARS).sort((a, b) => a.change - b.change);
    return { categories: bars.map((h) => h.symbol), series: [{ name: "Change in value", data: bars.map((h) => h.change) }] };
  }, [moved]);
  const largest = moved.length ? moved.reduce((a, b) => (Math.abs(b.change) > Math.abs(a.change) ? b : a)) : null;

  const columns: Column<ShockRow>[] = [
    { key: "symbol", header: "Holding", sort: (r) => r.symbol, cell: (r) => <SymbolCell symbol={r.symbol} name={r.name} sub={r.sector} /> },
    { key: "value", header: "Value now", align: "right", hide: "md", sort: (r) => r.value, cell: (r) => inr(r.value) },
    { key: "shock", header: "Move", align: "right", sort: (r) => r.shock, cell: (r) => <Signed value={r.shock}>{signedPct(r.shock * 100, 1)}</Signed> },
    { key: "after", header: "Value after", align: "right", hide: "sm", sort: (r) => r.new_value, cell: (r) => <span className="text-ink">{inr(r.new_value)}</span> },
    { key: "change", header: "Change", align: "right", sort: (r) => r.change, cell: (r) => <Signed value={r.change}>{signedInr(r.change)}</Signed> },
    {
      key: "weight", header: "Weight before → after", align: "right", hide: "lg", sort: (r) => r.weight_after,
      hint: "Each holding's share of the portfolio's holdings, before and after the move. Holdings that fall less than the rest end up with a larger share.",
      cell: (r) => (
        <span>
          <span className="text-muted">{pct(r.weight_before * 100, 1)} → </span>
          <span className="text-ink">{pct(r.weight_after * 100, 1)}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <Card title={result.title.replace(/-(?=\d)/, "−")} description={result.note} className={cn("transition-opacity lg:col-span-12 xl:col-span-5", pending && "opacity-60")} bodyClassName="flex flex-col">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div>
            <div className="text-[13px] text-muted">Holdings value now</div>
            <div className="num mt-1 text-xl font-semibold leading-7 tracking-tight text-ink-2">{inr(result.before)}</div>
          </div>
          <ArrowRight className="mb-1.5 size-4 shrink-0 text-muted" aria-hidden />
          <div>
            <div className="text-[13px] text-muted">After the move</div>
            <div className="num mt-1 text-[30px] font-semibold leading-7 tracking-[-0.02em] text-ink">{inr(result.after)}</div>
          </div>
        </div>
        <div className="mt-3">
          <PnlDelta amount={result.change} percent={result.change_pct * 100} size="md" />
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4">
          <div>
            <dt className="text-xs text-muted">Holdings that move</dt>
            <dd className="num mt-0.5 text-sm font-semibold text-ink">{moved.length} of {result.holdings.length}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted">Largest single impact</dt>
            <dd className="num mt-0.5 truncate text-sm font-semibold text-ink">
              {largest ? <>{largest.symbol} <Signed value={largest.change}>{signedInr(largest.change)}</Signed></> : "—"}
            </dd>
          </div>
        </dl>
        <ScenarioNote className="mt-5">
          Scenario analysis, not a forecast: a hypothetical one-off move applied to today's holdings{cash > 0 ? `, leaving ${inr(cash)} of cash untouched` : ""}. Betas are measured over the past year and can change. Nothing here changes your real portfolio.
        </ScenarioNote>
      </Card>

      <Card
        title="Rupee impact by holding"
        description={moved.length > MAX_IMPACT_BARS ? `The ${MAX_IMPACT_BARS} largest impacts; the table lists every holding` : "Change in value under this scenario"}
        className={cn("transition-opacity lg:col-span-12 xl:col-span-7", pending && "opacity-60")}
      >
        {impact.categories.length ? (
          <BarChart
            label="Change in value of each holding under this scenario"
            horizontal
            signed
            valueLabels
            format="inr"
            height={Math.max(200, impact.categories.length * 32)}
            categories={impact.categories}
            series={impact.series}
          />
        ) : (
          <div className="flex h-[200px] items-center justify-center px-6 text-center text-[13px] text-muted">No holding moves in this scenario yet. Set a percentage for at least one holding.</div>
        )}
      </Card>

      <Card title="Holding by holding" description={`${result.holdings.length} holding${result.holdings.length === 1 ? "" : "s"}, sorted by change in value`} className={cn("transition-opacity lg:col-span-12", pending && "opacity-60")} flush>
        <DataTable columns={columns} rows={result.holdings} rowKey={(r) => r.symbol} defaultSort={{ key: "change", dir: "asc" }} />
      </Card>
    </>
  );
}

function Shocks({ id, data }: { id: string; data: Overview }) {
  const holdings = useMemo(() => [...data.holdings].sort((a, b) => b.value - a.value), [data.holdings]);
  const sectors = useMemo(() => [...new Set(data.holdings.map((h) => h.sector))].sort(), [data.holdings]);
  const [scenario, setScenario] = useState<ScenarioKey>("down10");
  const [useBeta, setUseBeta] = useState(true);
  const [sector, setSector] = useState(data.allocation.concentration.largest_sector?.name ?? sectors[0] ?? "");
  const [sectorMove, setSectorMove] = useState("-20");
  const [custom, setCustom] = useState<Record<string, string>>({});

  const sectorPct = parseNumber(sectorMove);
  const sectorError = sectorPct === null || sectorPct < -100 || sectorPct > 200 ? "Enter a move between −100% and 200%" : null;
  const customErrors = Object.entries(custom).filter(([, text]) => {
    const v = parseNumber(text);
    return text.trim() !== "" && (v === null || v < -100 || v > 200);
  });

  const request = useMemo<ShockRequest | null>(() => {
    const market = MARKET_MOVE[scenario];
    if (market !== undefined) return { portfolio_id: id, kind: "market", magnitude: market, use_beta: useBeta };
    if (scenario === "largest") return { portfolio_id: id, kind: "largest", magnitude: -0.5 };
    if (scenario === "sector") return sector && !sectorError ? { portfolio_id: id, kind: "sector", sector, magnitude: sectorPct! / 100 } : null;
    if (customErrors.length) return null;
    const shocks: Record<string, number> = {};
    for (const [symbol, text] of Object.entries(custom)) {
      const v = parseNumber(text);
      if (v) shocks[symbol] = v / 100;
    }
    return { portfolio_id: id, kind: "custom", shocks };
  }, [id, scenario, useBeta, sector, sectorPct, sectorError, custom, customErrors.length]);

  // Sliders and typed percentages settle before a request goes out.
  const settled = useDebounced(request, 250);
  const shock = useQuery({
    // The transaction count is in the key so a change to the ledger refreshes the result.
    queryKey: ["shock", settled, data.summary.transactions_count],
    queryFn: () => api.shock(settled!),
    enabled: !!settled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const pending = shock.isPlaceholderData || settled !== request;
  const top = holdings[0];

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <Card title="Scenario" description={`Applied to the ${holdings.length} holding${holdings.length === 1 ? "" : "s"} in ${data.portfolio.name} at today's prices`} className="lg:col-span-12">
        <div role="radiogroup" aria-label="Scenario" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {SCENARIOS.map((s) => {
            const selected = s.key === scenario;
            return (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setScenario(s.key)}
                className={cn(
                  "flex min-w-0 flex-col gap-1 rounded-xl p-3 text-left ring-1 ring-inset transition-colors",
                  selected ? "bg-accent-soft ring-accent" : "bg-surface-2/60 ring-line hover:ring-line-strong",
                )}
              >
                <s.icon className={cn("size-4", selected ? "text-accent" : "text-muted")} aria-hidden />
                <span className="text-[13px] font-medium leading-snug text-ink">{s.title}</span>
                <span className="text-xs leading-snug text-muted">{s.detail}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 border-t border-line pt-4">
          {MARKET_MOVE[scenario] !== undefined && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <Switch id="shock-beta" checked={useBeta} onChange={setUseBeta} label="Scale each holding by its beta" />
              <label htmlFor="shock-beta" className="text-[13px] font-medium text-ink">Scale each holding by its beta</label>
              <InfoHint text="Beta is how far a stock has moved for each 1% move in the market over the past year. A beta of 1.2 means a 12% fall when the market falls 10%." />
              <span className="w-full text-xs text-muted sm:w-auto">
                {useBeta ? "On: stocks that swing more than the market move further." : "Off: every holding moves by the same percentage as the market."}
              </span>
            </div>
          )}

          {scenario === "largest" && top && (
            <p className="text-[13px] text-ink-2">
              The largest holding is <span className="font-medium text-ink">{top.symbol}</span> at {pct(top.weight, 1)} of the portfolio ({inr(top.value)}). It falls 50%; nothing else moves.
            </p>
          )}

          {scenario === "sector" && (
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)_120px] sm:items-end">
              <Field label="Sector">
                {(props) => (
                  <Select {...props} value={sector} onChange={(e) => setSector(e.target.value)}>
                    {sectors.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="sector-move-range" className="text-[13px] font-medium text-ink-2">Move</label>
                <div className="flex h-9 items-center gap-3">
                  <span className="num text-xs text-muted">−50%</span>
                  <input
                    id="sector-move-range"
                    type="range"
                    min={-50}
                    max={50}
                    step={1}
                    value={Math.max(-50, Math.min(50, sectorPct ?? 0))}
                    onChange={(e) => setSectorMove(e.target.value)}
                    className="h-1.5 w-full min-w-0 cursor-pointer accent-accent"
                  />
                  <span className="num text-xs text-muted">+50%</span>
                </div>
              </div>
              <Field label="Exact move" error={sectorError}>
                {(props) => <Input {...props} type="number" inputMode="decimal" min="-100" max="200" step="any" suffix="%" value={sectorMove} onChange={(e) => setSectorMove(e.target.value)} />}
              </Field>
            </div>
          )}

          {scenario === "custom" && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] text-ink-2">Enter a move for any holding, for example −30 or 15. Blank means no change.</p>
                <Button size="sm" variant="ghost" disabled={!Object.values(custom).some((v) => v.trim())} onClick={() => setCustom({})}>
                  Clear all
                </Button>
              </div>
              <div className="grid max-h-80 gap-x-5 gap-y-2 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                {holdings.map((h) => {
                  const text = custom[h.symbol] ?? "";
                  const bad = customErrors.some(([symbol]) => symbol === h.symbol);
                  return (
                    <div key={h.symbol} className="flex items-center gap-3">
                      <label htmlFor={`shock-${h.symbol}`} className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-ink">{h.symbol}</div>
                        <div className="num truncate text-xs text-muted">{inr(h.value)} · {pct(h.weight, 1)}</div>
                      </label>
                      <div className="w-24 shrink-0">
                        <Input
                          id={`shock-${h.symbol}`}
                          type="number"
                          inputMode="decimal"
                          min="-100"
                          max="200"
                          step="any"
                          suffix="%"
                          placeholder="0"
                          aria-invalid={bad || undefined}
                          value={text}
                          onChange={(e) => setCustom((all) => ({ ...all, [h.symbol]: e.target.value }))}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {customErrors.length > 0 && <p className="mt-2 text-xs text-loss">Moves must be between −100% and 200%.</p>}
            </div>
          )}
        </div>
      </Card>

      {shock.isError ? (
        <Card className="lg:col-span-12">
          <ErrorState error={shock.error} onRetry={() => shock.refetch()} />
        </Card>
      ) : !shock.data ? (
        <>
          <CardSkeleton height={220} className="lg:col-span-12 xl:col-span-5" />
          <CardSkeleton height={220} className="lg:col-span-12 xl:col-span-7" />
          <CardSkeleton height={280} className="lg:col-span-12" />
        </>
      ) : (
        <ShockResultView result={shock.data} pending={pending} cash={data.summary.cash} />
      )}
    </div>
  );
}

function ShocksTab() {
  const { id, isLoading } = usePortfolio();
  const actions = useAppActions();
  const overview = useOverview(id);

  if (isLoading || (id && overview.isPending)) {
    return (
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="card p-5 lg:col-span-12">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {SCENARIOS.map((s) => (
              <Skeleton key={s.key} className="h-[86px]" />
            ))}
          </div>
        </div>
        <CardSkeleton height={220} className="lg:col-span-12 xl:col-span-5" />
        <CardSkeleton height={220} className="lg:col-span-12 xl:col-span-7" />
      </div>
    );
  }
  if (!id) {
    return (
      <Card>
        <EmptyState
          icon={<TrendingDown />}
          title="Shocks need a portfolio"
          description="A shock is applied to the holdings you already have. Create a portfolio and record a few buys to use this tab."
          action={<Button variant="primary" onClick={() => actions.newPortfolio()}>Create portfolio</Button>}
        />
      </Card>
    );
  }
  if (overview.isError) {
    return (
      <Card>
        <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
      </Card>
    );
  }
  const data = overview.data!;
  if (!data.holdings.length) {
    const paper = data.portfolio.kind === "paper";
    return (
      <Card>
        <EmptyState
          icon={<TrendingDown />}
          title={`${data.portfolio.name} has no holdings to shock`}
          description={paper ? "Place a simulated order first; shocks are applied to open positions." : "Record a buy first; shocks are applied to the holdings in the selected portfolio."}
          action={
            paper ? (
              <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
            ) : (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
            )
          }
        />
      </Card>
    );
  }
  return <Shocks key={id} id={id} data={data} />;
}

export function WhatIfPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "shocks" ? "shocks" : "growth";
  // A tab mounts the first time it is opened and then stays mounted, so switching back keeps what was entered.
  const [opened, setOpened] = useState<Record<Tab, boolean>>({ growth: tab === "growth", shocks: tab === "shocks" });
  useEffect(() => setOpened((seen) => (seen[tab] ? seen : { ...seen, [tab]: true })), [tab]);
  return (
    <Page
      title="What-if"
      description={
        tab === "growth"
          ? "See how a starting amount and a monthly investment could grow under returns you choose."
          : "See what a sudden market move would do to the holdings you have today."
      }
      actions={
        <Segmented<Tab>
          label="Simulator"
          value={tab}
          onChange={(next) => setParams(next === "growth" ? {} : { tab: next }, { replace: true })}
          options={[{ value: "growth", label: "Growth plans" }, { value: "shocks", label: "Shocks" }]}
        />
      }
    >
      <div hidden={tab !== "growth"}>{(opened.growth || tab === "growth") && <GrowthPlans />}</div>
      <div hidden={tab !== "shocks"}>{(opened.shocks || tab === "shocks") && <ShocksTab />}</div>
    </Page>
  );
}
