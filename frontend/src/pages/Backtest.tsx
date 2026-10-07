import { useMutation } from "@tanstack/react-query";
import { CopyPlus, History, MoreHorizontal, Play, Save, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { BacktestResults } from "@/components/lab/BacktestResults";
import { isoYearsAgo, parseNumber } from "@/components/lab/shared";
import { StrategyBuilder } from "@/components/lab/StrategyBuilder";
import { DEFAULT_CONFIG, DEFAULT_NAME, DEFAULT_PRESET, describeStrategy, toConfig, toDraft, type StrategyDraft } from "@/components/lab/strategy";
import {
  Badge, Button, Card, CardSkeleton, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, IconButton, Input, Menu, MenuItem, Page, Select, Signed,
  Skeleton, StatTile, SymbolCell, type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { date, inr, number, signedPct, signedRatioPct, todayIso } from "@/lib/format";
import { errorMessage, useAction, useBacktestMeta, useBacktestResults, useStrategies } from "@/lib/queries";
import type { BacktestResult, SavedBacktest, StrategyConfig } from "@/lib/types";

interface RunInput {
  symbol: string;
  start_date: string;
  end_date: string | null;
  capital: number;
  config: StrategyConfig;
  strategy_id: string | null;
  strategy_name: string;
}

interface Outcome {
  result: BacktestResult;
  input: RunInput;
}

interface Base {
  name: string;
  config: StrategyConfig;
}

const fingerprint = (config: StrategyConfig) => JSON.stringify(toConfig(toDraft(config)).config);

function SavedResults({ onDeleted }: { onDeleted: (id: string) => void }) {
  const results = useBacktestResults();
  const [deleting, setDeleting] = useState<SavedBacktest | null>(null);
  const remove = useAction((row: SavedBacktest) => api.deleteBacktestResult(row.id), {
    invalidate: ["backtest-results"],
    success: "Saved result deleted",
    onSuccess: (_, row) => {
      setDeleting(null);
      onDeleted(row.id);
    },
  });

  const columns: Column<SavedBacktest>[] = [
    {
      key: "strategy", header: "Strategy", sort: (r) => r.strategy_name,
      cell: (r) => (
        <div className="min-w-0 max-w-64">
          <div className="truncate font-medium text-ink">{r.strategy_name}</div>
          <div className="truncate text-xs text-muted">Saved {date(r.created_at)}</div>
        </div>
      ),
    },
    { key: "symbol", header: "Stock", sort: (r) => r.symbol, cell: (r) => <SymbolCell symbol={r.symbol} /> },
    {
      key: "period", header: "Period", hide: "md", sort: (r) => r.start_date,
      cell: (r) => <span className="whitespace-nowrap">{date(r.start_date)} to {date(r.end_date)}</span>,
    },
    {
      key: "final", header: "Final value", align: "right", sort: (r) => r.final_value,
      cell: (r) => {
        const change = r.initial_capital > 0 ? (r.final_value / r.initial_capital - 1) * 100 : null;
        return (
          <div>
            <div className="font-medium text-ink">{inr(r.final_value)}</div>
            <div className="text-xs text-muted">
              from {inr(r.initial_capital)} <Signed value={change}>{signedPct(change, 1)}</Signed>
            </div>
          </div>
        );
      },
    },
    { key: "cagr", header: "CAGR", align: "right", hide: "sm", sort: (r) => r.cagr, cell: (r) => <Signed value={r.cagr}>{signedRatioPct(r.cagr)}</Signed> },
    { key: "drawdown", header: "Max drawdown", align: "right", hide: "lg", sort: (r) => r.max_drawdown, cell: (r) => signedRatioPct(r.max_drawdown, 1) },
    { key: "trades", header: "Trades", align: "right", hide: "lg", sort: (r) => r.total_trades, cell: (r) => number(r.total_trades) },
    {
      key: "actions", header: <span className="sr-only">Actions</span>, align: "right", width: "48px",
      cell: (r) => (
        <IconButton label={`Delete the saved result for ${r.strategy_name} on ${r.symbol}`} className="ml-auto" onClick={() => setDeleting(r)}>
          <Trash2 className="size-4" />
        </IconButton>
      ),
    },
  ];

  return (
    <Card title="Saved results" description="Backtests you chose to keep, newest first" flush>
      {results.isError ? (
        <ErrorState error={results.error} onRetry={() => results.refetch()} />
      ) : !results.data ? (
        <div className="flex flex-col gap-2 px-4 pb-4 sm:px-5 sm:pb-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={results.data}
          rowKey={(r) => r.id}
          maxHeight={420}
          empty={
            <EmptyState
              icon={<History />}
              title="No saved results yet"
              description="Run a backtest, then choose Save this result to keep its headline figures here for later comparison."
            />
          }
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this saved result?"
        description={deleting ? `The saved result for ${deleting.strategy_name} on ${deleting.symbol} will be removed. The strategy itself is kept.` : ""}
        confirmLabel="Delete result"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Card>
  );
}

export function BacktestPage() {
  const meta = useBacktestMeta();
  const strategies = useStrategies();

  // Strategy being edited, and what it was loaded from.
  const [source, setSource] = useState(`preset:${DEFAULT_PRESET}`);
  const [base, setBase] = useState<Base>({ name: DEFAULT_NAME, config: DEFAULT_CONFIG });
  const [name, setName] = useState(DEFAULT_NAME);
  const [draft, setDraft] = useState<StrategyDraft>(() => toDraft(DEFAULT_CONFIG));
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Where and when to run it.
  const [symbol, setSymbol] = useState("RELIANCE");
  const [symbolName, setSymbolName] = useState("Reliance Industries");
  const [start, setStart] = useState(() => isoYearsAgo(5));
  const [end, setEnd] = useState("");
  const [capital, setCapital] = useState("100000");
  const [attempted, setAttempted] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const strategyId = source.startsWith("saved:") ? source.slice(6) : null;
  const current = useMemo(() => toConfig(draft), [draft]);
  const summary = useMemo(() => describeStrategy(current.config), [current]);
  const edited = useMemo(() => JSON.stringify(current.config) !== fingerprint(base.config) || name.trim() !== base.name, [current, base, name]);

  const load = (value: string) => {
    const [kind, key] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
    const found = kind === "preset" ? meta.data?.presets.find((p) => p.key === key) : strategies.data?.find((s) => s.id === key);
    if (!found) return;
    setSource(value);
    setBase({ name: found.name, config: found.config });
    setName(found.name);
    setDraft(toDraft(found.config));
  };

  const run = useMutation({
    mutationFn: (input: RunInput) => api.runBacktest(input),
    onSuccess: (result, input) => setOutcome({ result, input }),
  });

  const saveStrategy = useAction(
    (target: { id: string | null }) => {
      const body = { name: name.trim(), description: summary.slice(0, 400), config: current.config };
      return target.id ? api.updateStrategy(target.id, body) : api.createStrategy(body);
    },
    {
      invalidate: ["strategies"],
      success: (_, target) => (target.id ? "Strategy updated" : "Strategy saved"),
      onSuccess: (saved) => {
        setSource(`saved:${saved.id}`);
        setBase({ name: saved.name, config: saved.config });
      },
    },
  );

  const deleteStrategy = useAction((id: string) => api.deleteStrategy(id), {
    invalidate: ["strategies", "backtest-results"],
    success: "Strategy deleted",
    onSuccess: (_, id) => {
      setConfirmDelete(false);
      setSource("");
      setBase({ name: "", config: current.config });
      // Results saved from it went with it; the run on screen is no longer tied to a strategy.
      setOutcome((o) => (o && o.input.strategy_id === id ? { result: { ...o.result, result_id: undefined }, input: { ...o.input, strategy_id: null } } : o));
    },
  });

  const saveResult = useAction((o: Outcome) => api.runBacktest({ ...o.input, end_date: o.result.period.end, save: true }), {
    invalidate: ["backtest-results"],
    success: "Result saved",
    onSuccess: (result, o) => setOutcome({ result, input: o.input }),
  });

  const amount = parseNumber(capital);
  const today = todayIso();
  const fieldErrors = {
    symbol: !symbol ? "Pick a stock or an index" : null,
    start: !start ? "Choose a start date" : start >= today ? "The start date must be in the past" : null,
    end: end && end <= start ? "The end date must be after the start date" : end > today ? "The end date can't be in the future" : null,
    capital: amount === null || amount <= 0 || amount > 1e12 ? "Enter the capital to start with" : null,
  };
  const problems = [...current.problems, ...Object.values(fieldErrors).filter((e): e is string => !!e).map((e) => `${e}.`)];
  const nameError = !name.trim() ? "Give the strategy a name to save it" : null;

  const startRun = () => {
    setAttempted(true);
    if (problems.length) return;
    run.mutate({
      symbol,
      start_date: start,
      end_date: end || null,
      capital: amount!,
      config: current.config,
      strategy_id: strategyId,
      strategy_name: name.trim() || "Untitled strategy",
    });
  };

  const builder = meta.isError ? (
    <Card title="Strategy">
      <ErrorState error={meta.error} onRetry={() => meta.refetch()} />
    </Card>
  ) : !meta.data ? (
    <CardSkeleton height={360} />
  ) : (
    <Card title="Strategy" description="Rules are checked once a day, on the close. The strategy holds one position at a time and never sells short.">
      <div className="grid gap-x-3 gap-y-4 md:grid-cols-2">
        <Field label="Start from" hint="A preset or one of your saved strategies. Choosing one replaces the rules below.">
          {(props) => (
            <Select {...props} value={source} onChange={(e) => load(e.target.value)}>
              {source === "" && <option value="" disabled>Unsaved strategy</option>}
              <optgroup label="Presets">
                {meta.data.presets.map((p) => (
                  <option key={p.key} value={`preset:${p.key}`}>{p.name}</option>
                ))}
              </optgroup>
              {!!strategies.data?.length && (
                <optgroup label="Your saved strategies">
                  {strategies.data.map((s) => (
                    <option key={s.id} value={`saved:${s.id}`}>{s.name}</option>
                  ))}
                </optgroup>
              )}
            </Select>
          )}
        </Field>
        <Field label="Strategy name" hint={nameError ?? undefined}>
          {(props) => <Input {...props} value={name} maxLength={80} placeholder="Name this strategy" onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>

      <div className="mt-5">
        <StrategyBuilder draft={draft} onChange={setDraft} meta={meta.data} />
      </div>

      <div className="mt-5 rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-inset ring-line">
        <div className="text-xs font-medium text-muted">In plain English</div>
        <p className="mt-1 text-sm leading-relaxed text-ink">{summary}</p>
        {current.problems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-0.5 text-xs leading-relaxed text-warn">
            {current.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          {strategyId ? <Badge tone="accent">Saved strategy</Badge> : source ? <Badge>Preset</Badge> : <Badge>Not saved</Badge>}
          {edited && source && <span>Edited since it was loaded</span>}
        </div>
        <div className="flex items-center gap-2">
          {strategyId ? (
            <>
              <Button
                icon={<Save className="size-4" />}
                disabled={!edited || !!current.problems.length || !!nameError}
                loading={saveStrategy.isPending}
                onClick={() => saveStrategy.mutate({ id: strategyId })}
              >
                Save changes
              </Button>
              <Menu trigger={<IconButton label="More strategy actions"><MoreHorizontal className="size-4" /></IconButton>}>
                <MenuItem icon={<CopyPlus />} disabled={!!current.problems.length || !!nameError} onSelect={() => saveStrategy.mutate({ id: null })}>
                  Save as a new strategy
                </MenuItem>
                <MenuItem icon={<Trash2 />} danger onSelect={() => setConfirmDelete(true)}>
                  Delete strategy
                </MenuItem>
              </Menu>
            </>
          ) : (
            <Button
              icon={<Save className="size-4" />}
              disabled={!!current.problems.length || !!nameError}
              loading={saveStrategy.isPending}
              onClick={() => saveStrategy.mutate({ id: null })}
            >
              Save strategy
            </Button>
          )}
        </div>
      </div>
    </Card>
  );

  return (
    <Page title="Backtest" description="Write a trading rule in plain terms and see how it would have traded one stock over a past period.">
      <div className="flex flex-col gap-4">
        {builder}

        <Card title="Run" description="Signals are read on each day's close and filled at the next trading day's open.">
          <form
            noValidate
            className="grid gap-x-3 gap-y-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              startRun();
            }}
          >
            <Field label="Stock or index" error={attempted ? fieldErrors.symbol : null} hint={symbolName || undefined}>
              {(props) => (
                <SymbolPicker
                  id={props.id}
                  value={symbol}
                  invalid={attempted && !!fieldErrors.symbol}
                  onSelect={(item) => {
                    setSymbol(item.symbol);
                    setSymbolName(item.name);
                  }}
                />
              )}
            </Field>
            <Field label="Start date" error={attempted ? fieldErrors.start : null}>
              {(props) => <Input {...props} type="date" max={today} value={start} onChange={(e) => setStart(e.target.value)} />}
            </Field>
            <Field label="End date" error={fieldErrors.end} hint="Optional. Blank runs to the latest close.">
              {(props) => <Input {...props} type="date" min={start} max={today} value={end} onChange={(e) => setEnd(e.target.value)} />}
            </Field>
            <Field label="Starting capital" error={attempted ? fieldErrors.capital : null} hint={amount && amount >= 1000 ? inr(amount) : undefined}>
              {(props) => <Input {...props} type="number" inputMode="decimal" min="0" step="any" prefix="₹" value={capital} onChange={(e) => setCapital(e.target.value)} />}
            </Field>
            <div className="flex flex-col gap-1.5 sm:col-span-2 sm:items-start xl:col-span-1">
              <span className="text-[13px] max-xl:hidden" aria-hidden>&nbsp;</span>
              <Button variant="primary" type="submit" loading={run.isPending} disabled={!meta.data} icon={<Play className="size-4" />}>
                Run backtest
              </Button>
            </div>
          </form>
          {attempted && problems.length > 0 ? (
            <ul role="alert" className="mt-3 flex flex-col gap-0.5 text-[13px] leading-relaxed text-loss">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : run.isError ? (
            <p role="alert" className="mt-3 text-[13px] leading-relaxed text-loss">{errorMessage(run.error)}</p>
          ) : null}
        </Card>

        {outcome ? (
          <BacktestResults
            result={outcome.result}
            strategyName={outcome.input.strategy_name}
            stale={run.isPending}
            saved={!!outcome.result.result_id}
            saving={saveResult.isPending}
            onSave={() => saveResult.mutate(outcome)}
          />
        ) : run.isPending ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <StatTile key={i} label="" value="" loading />
              ))}
            </div>
            <CardSkeleton height={280} />
            <CardSkeleton height={360} />
          </div>
        ) : (
          <Card>
            <EmptyState
              className="py-14"
              icon={<Play />}
              title="No backtest run yet"
              description={`Run the strategy above on ${symbol || "a stock"} to see its trades, its value over time and how it compares with simply buying and holding.`}
              action={
                <Button variant="primary" icon={<Play className="size-4" />} disabled={!meta.data} onClick={startRun}>
                  Run backtest
                </Button>
              }
            />
          </Card>
        )}

        <SavedResults onDeleted={(id) => setOutcome((o) => (o && o.result.result_id === id ? { ...o, result: { ...o.result, result_id: undefined } } : o))} />
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this strategy?"
        description={`"${base.name}" and any results saved from it will be deleted. The rules stay on screen until you load something else.`}
        confirmLabel="Delete strategy"
        loading={deleteStrategy.isPending}
        onConfirm={() => strategyId && deleteStrategy.mutate(strategyId)}
      />
    </Page>
  );
}
