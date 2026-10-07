import { useMutation } from "@tanstack/react-query";
import { Dices, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MonteCarloResults, PERCENTILE_GRID, PERCENTILE_SPANS } from "@/components/lab/MonteCarloResults";
import { OptionGroup, parseNumber } from "@/components/lab/shared";
import { Button, Card, CardSkeleton, EmptyState, ErrorState, Field, Input, Page, Segmented, Skeleton, StatTile } from "@/components/ui";
import { RequirePortfolio } from "@/components/widgets";
import { api } from "@/lib/api";
import { inr } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { errorMessage, useAssumptions } from "@/lib/queries";
import type { Assumptions, MonteCarloResult } from "@/lib/types";
import { cn } from "@/lib/utils";

type Method = "parametric" | "bootstrap";
type PathCount = "1000" | "5000" | "10000";
type Request = Parameters<typeof api.monteCarlo>[0];

interface Form {
  initial: string;
  monthly: string;
  years: string;
  paths: PathCount;
  expectedReturn: string;
  volatility: string;
  method: Method;
  target: string;
}
type FormErrors = Partial<Record<keyof Form, string>>;

const BLANK: Form = { initial: "", monthly: "", years: "10", paths: "5000", expectedReturn: "", volatility: "", method: "parametric", target: "" };
/** Starting points when the holdings have no price history to measure. */
const NO_HISTORY = { expectedReturn: "12", volatility: "18" };
const MIN_BOOTSTRAP_MONTHS = 12;

const METHOD_LABEL: Record<Method, string> = { parametric: "Log-normal", bootstrap: "Bootstrap history" };

/** Full width of the form, which runs four columns when the card sits above the results. */
const WIDE = "col-span-2 md:max-xl:col-span-4";

function historical(a: Assumptions): { expectedReturn: string; volatility: string } | null {
  if (a.expected_return == null || a.volatility == null) return null;
  return { expectedReturn: (a.expected_return * 100).toFixed(1), volatility: (a.volatility * 100).toFixed(1) };
}

function readForm(form: Form, id: string): { request: Request | null; errors: FormErrors } {
  const initial = parseNumber(form.initial) ?? 0;
  const monthly = parseNumber(form.monthly) ?? 0;
  const years = parseNumber(form.years);
  const expectedReturn = parseNumber(form.expectedReturn);
  const volatility = parseNumber(form.volatility);
  const target = parseNumber(form.target);
  const bootstrap = form.method === "bootstrap";
  const errors: FormErrors = {};
  if (initial < 0 || initial > 1e12) errors.initial = "Enter an amount of zero or more";
  else if (initial === 0 && monthly === 0) errors.initial = "Enter a starting value or a monthly investment";
  if (monthly < 0 || monthly > 1e10) errors.monthly = "Enter an amount of zero or more";
  if (years === null || !Number.isInteger(years) || years < 1 || years > 40) errors.years = "1 to 40 years";
  if (!bootstrap && (expectedReturn === null || expectedReturn < -50 || expectedReturn > 100)) errors.expectedReturn = "−50% to 100%";
  if (!bootstrap && (volatility === null || volatility <= 0 || volatility > 150)) errors.volatility = "Above 0%, up to 150%";
  if (form.target.trim() !== "" && (target === null || target <= 0)) errors.target = "Enter an amount above zero, or leave blank";
  if (Object.keys(errors).length) return { request: null, errors };
  return {
    request: {
      portfolio_id: id,
      initial,
      monthly,
      years: years!,
      paths: Number(form.paths),
      // Bootstrap resamples real months, so the two assumptions are left to the server's historical figures.
      expected_return: bootstrap ? null : expectedReturn! / 100,
      volatility: bootstrap ? null : volatility! / 100,
      method: form.method,
      target,
    },
    errors,
  };
}

function Labeled({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">{label}</span>
      <div>{children}</div>
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

function Content({ id }: { id: string }) {
  const { name } = usePortfolio();
  const assumptions = useAssumptions(id);
  const [form, setForm] = useState<Form>(BLANK);
  const [touched, setTouched] = useState(false);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [ranWith, setRanWith] = useState<string | null>(null);
  const seeded = useRef(false);

  const run = useMutation({
    mutationFn: (request: Request) => api.monteCarlo(request),
    onSuccess: (data, request) => {
      setResult(data);
      setRanWith(JSON.stringify(request));
    },
  });

  const defaults = assumptions.data ? historical(assumptions.data) : null;
  const months = assumptions.data?.months_of_history ?? 0;
  const canBootstrap = months >= MIN_BOOTSTRAP_MONTHS;

  // Fill the form from the portfolio once, then run a first simulation with those defaults.
  useEffect(() => {
    const a = assumptions.data;
    if (!a || seeded.current) return;
    seeded.current = true;
    const next: Form = { ...BLANK, initial: a.value > 0 ? String(Math.round(a.value)) : "", ...(historical(a) ?? NO_HISTORY) };
    setForm(next);
    const first = readForm(next, id).request;
    if (first) run.mutate(first);
  }, [assumptions.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const { request, errors } = useMemo(() => readForm(form, id), [form, id]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const show = (key: keyof Form) => (touched ? errors[key] : undefined);
  const bootstrap = form.method === "bootstrap";
  const edited = !!defaults && (form.expectedReturn !== defaults.expectedReturn || form.volatility !== defaults.volatility);
  const changed = !!result && !!request && JSON.stringify(request) !== ranWith;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (request) run.mutate(request);
  };

  const waitingForDefaults = assumptions.isPending;
  const amount = (key: "initial" | "monthly" | "years" | "expectedReturn" | "volatility" | "target") => ({
    type: "number" as const,
    inputMode: "decimal" as const,
    step: "any",
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(key, e.target.value),
  });

  return (
    <Page title="Monte Carlo" description={`Thousands of possible futures for ${name}, each one drawn at random from a return and a volatility assumption.`}>
      <div className="grid gap-4 xl:grid-cols-12">
        <Card title="Assumptions" description="What each simulated path is built from" className="xl:col-span-4 xl:self-start">
          {waitingForDefaults ? (
            <div className="flex flex-col gap-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i}>
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="mt-2 h-9 w-full" />
                </div>
              ))}
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-x-3 gap-y-4 md:max-xl:grid-cols-4">
              {assumptions.isError && (
                <p className={cn(WIDE, "rounded-[10px] bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn")}>
                  The defaults from your holdings didn't load ({errorMessage(assumptions.error)}). Enter your own figures, or{" "}
                  <button type="button" className="font-medium underline" onClick={() => assumptions.refetch()}>try again</button>.
                </p>
              )}
              <Field label="Starting value" className="col-span-2" error={show("initial")} hint={assumptions.data ? `The holdings in ${name} are worth ${inr(assumptions.data.value)} today` : undefined}>
                {(props) => <Input {...props} {...amount("initial")} min="0" prefix="₹" placeholder="0" />}
              </Field>
              <Field label="Monthly investment" className="col-span-2" error={show("monthly")} hint="Added at the start of every month. Leave blank for none.">
                {(props) => <Input {...props} {...amount("monthly")} min="0" prefix="₹" placeholder="0" />}
              </Field>
              <Field label="Years" error={show("years")} hint="1 to 40">
                {(props) => <Input {...props} {...amount("years")} inputMode="numeric" min="1" max="40" step="1" />}
              </Field>
              <Field label="Target value" error={show("target")} hint="Optional">
                {(props) => <Input {...props} {...amount("target")} min="0" prefix="₹" placeholder="None" />}
              </Field>

              <div className="col-span-2">
                <Labeled label="Number of paths" hint="More paths give steadier percentiles and take a little longer.">
                  <Segmented<PathCount>
                    label="Number of paths"
                    value={form.paths}
                    onChange={(v) => set("paths", v)}
                    options={[{ value: "1000", label: "1,000" }, { value: "5000", label: "5,000" }, { value: "10000", label: "10,000" }]}
                  />
                </Labeled>
              </div>

              <div className="col-span-2">
                <Labeled
                  label="Method"
                  hint={
                    bootstrap
                      ? `Builds each path by drawing, at random, from the ${months} actual monthly returns of your current holdings. Keeps the bad months as they happened; the return and volatility fields are not used.`
                      : canBootstrap || !assumptions.data
                        ? "Draws each month's return from a bell-shaped curve with the expected return and volatility below."
                        : `Draws each month's return from a bell-shaped curve with the expected return and volatility below. Bootstrap needs at least ${MIN_BOOTSTRAP_MONTHS} months of price history; these holdings have ${months}.`
                  }
                >
                  <OptionGroup<Method>
                    label="Simulation method"
                    value={form.method}
                    onChange={(v) => set("method", v)}
                    options={[
                      { value: "parametric", label: METHOD_LABEL.parametric },
                      {
                        value: "bootstrap",
                        label: METHOD_LABEL.bootstrap,
                        unavailable: canBootstrap ? null : `Needs at least ${MIN_BOOTSTRAP_MONTHS} months of price history for the current holdings. There ${months === 1 ? "is" : "are"} ${months}.`,
                      },
                    ]}
                  />
                </Labeled>
              </div>

              <Field label="Expected return" error={show("expectedReturn")}>
                {(props) => <Input {...props} {...amount("expectedReturn")} min="-50" max="100" suffix="%" disabled={bootstrap} />}
              </Field>
              <Field label="Volatility" error={show("volatility")}>
                {(props) => <Input {...props} {...amount("volatility")} min="0" max="150" suffix="%" disabled={bootstrap} />}
              </Field>
              <p className={cn(WIDE, "-mt-1.5 text-xs leading-relaxed text-muted")}>
                {defaults
                  ? "Both are yearly figures, from the last three years of your current holdings. Volatility is how widely returns have swung around the average."
                  : "Both are yearly figures. These holdings have no price history yet, so 12% and 18% are filled in as starting points; replace them with your own assumptions."}
                {edited && !bootstrap && (
                  <>
                    {" "}
                    <button type="button" className="font-medium text-accent hover:underline" onClick={() => setForm((f) => ({ ...f, ...defaults! }))}>
                      Reset to historical
                    </button>
                  </>
                )}
              </p>

              <div className={cn(WIDE, "flex flex-col gap-2 border-t border-line pt-4")}>
                <Button variant="primary" type="submit" loading={run.isPending} icon={<Play className="size-4" />} className="w-full md:max-xl:w-auto md:max-xl:self-start">
                  Run simulation
                </Button>
                {run.isError && <p role="alert" className="text-xs leading-relaxed text-loss">{errorMessage(run.error)}</p>}
                {changed && !run.isPending && <p className="text-xs text-muted">The inputs have changed since the results on screen. Run the simulation to update them.</p>}
              </div>
            </form>
          )}
        </Card>

        <div className="min-w-0 xl:col-span-8">
          {result ? (
            <MonteCarloResults result={result} stale={run.isPending} />
          ) : run.isError ? (
            <Card>
              <ErrorState error={run.error} onRetry={request ? () => run.mutate(request) : undefined} />
            </Card>
          ) : waitingForDefaults || run.isPending ? (
            <div className="flex flex-col gap-4">
              <div className={PERCENTILE_GRID}>
                {PERCENTILE_SPANS.map((span, i) => (
                  <StatTile key={i} className={span} label="" value="" loading />
                ))}
              </div>
              <CardSkeleton height={360} />
              <CardSkeleton height={240} />
            </div>
          ) : (
            <Card>
              <EmptyState
                className="py-16"
                icon={<Dices />}
                title="Nothing simulated yet"
                description={
                  assumptions.data && assumptions.data.value <= 0
                    ? `${name} has no holdings to start from. Enter a starting value or a monthly investment, then run the simulation.`
                    : "Check the assumptions, then run the simulation to see the range of outcomes."
                }
                action={
                  <Button variant="primary" icon={<Play className="size-4" />} disabled={!request} onClick={() => request && run.mutate(request)}>
                    Run simulation
                  </Button>
                }
              />
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}

export function MonteCarloPage() {
  return <RequirePortfolio>{(id) => <Content key={id} id={id} />}</RequirePortfolio>;
}
