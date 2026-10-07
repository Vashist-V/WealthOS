import { ChevronRight, Download, Layers, Plus, SearchX } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAppActions } from "@/components/layout/AppShell";
import { fileSlug, plural, Rupees, SearchField, TD, TH } from "@/components/portfolio/shared";
import { Button, Card, CardSkeleton, Delta, EmptyState, ErrorState, Meter, Page, Segmented, Signed, StatTile, SymbolCell } from "@/components/ui";
import { HoldingsTable, RequirePortfolio } from "@/components/widgets";
import { holdingsToCsv } from "@/lib/csv";
import { date, inr, pct, signedInr, signedPct, todayIso } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useOverview } from "@/lib/queries";
import type { Holding } from "@/lib/types";
import { cn, downloadFile, symbolPath } from "@/lib/utils";

const ALL = "All";
const NONE: Holding[] = [];

const sum = <T,>(items: T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0);

interface SectorGroup {
  name: string;
  rows: Holding[];
  value: number;
  weight: number;
  pnl: number;
  pnlPct: number;
  dayPnl: number;
}

function totals(name: string, rows: Holding[]): SectorGroup {
  const invested = sum(rows, (h) => h.invested);
  const pnl = sum(rows, (h) => h.pnl);
  return {
    name,
    rows,
    value: sum(rows, (h) => h.value),
    weight: sum(rows, (h) => h.weight),
    pnl,
    pnlPct: invested > 0 ? (pnl / invested) * 100 : 0,
    dayPnl: sum(rows, (h) => h.day_pnl),
  };
}

function groupBySector(rows: Holding[]): SectorGroup[] {
  const bySector = new Map<string, Holding[]>();
  rows.forEach((h) => bySector.set(h.sector, [...(bySector.get(h.sector) ?? []), h]));
  return [...bySector.entries()]
    .map(([name, items]) => totals(name, [...items].sort((a, b) => b.value - a.value)))
    .sort((a, b) => b.value - a.value);
}

function PnlCell({ amount, percent }: { amount: number; percent: number }) {
  return (
    <>
      <Signed value={amount}>{signedInr(amount)}</Signed>
      <div>
        <Signed value={percent} className="text-xs">{signedPct(percent)}</Signed>
      </div>
    </>
  );
}

function WeightCell({ weight, max }: { weight: number; max: number }) {
  return (
    <div className="ml-auto flex w-24 items-center gap-2">
      <Meter value={weight} max={max} />
      <span className="w-11 shrink-0 text-right">{pct(weight, 1)}</span>
    </div>
  );
}

/** The same holdings grouped by sector: a subtotal row per sector, its holdings beneath, each group collapsible. */
function BySector({ rows }: { rows: Holding[] }) {
  const navigate = useNavigate();
  const groups = useMemo(() => groupBySector(rows), [rows]);
  const total = useMemo(() => totals("Total", rows), [rows]);
  // Sectors start open; the set records the ones the user has folded away.
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const allOpen = groups.every((g) => !closed.has(g.name));
  const maxWeight = Math.max(...groups.map((g) => g.weight), 1);

  const toggle = (name: string) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const right = cn(TD, "num whitespace-nowrap text-right");
  const foot = "px-3 py-2.5 first:pl-4 last:pr-4 sm:first:pl-5 sm:last:pr-5";
  return (
    <Card
      title="By sector"
      description={`${plural(groups.length, "sector")}, largest first. Each sector row is the subtotal of the holdings under it.`}
      flush
      action={
        <Button size="sm" variant="ghost" onClick={() => setClosed(allOpen ? new Set(groups.map((g) => g.name)) : new Set())}>
          {allOpen ? "Collapse all" : "Expand all"}
        </Button>
      }
    >
      <div className="w-full overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={cn(TH, "text-left")}>Sector</th>
              <th scope="col" className={cn(TH, "text-right")}>Value</th>
              <th scope="col" className={cn(TH, "text-right max-sm:hidden")}>Weight</th>
              <th scope="col" className={cn(TH, "text-right")}>{"P&L"}</th>
              <th scope="col" className={cn(TH, "text-right max-md:hidden")}>Today</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const expanded = !closed.has(group.name);
              return (
                <Fragment key={group.name}>
                  <tr className="cursor-pointer bg-surface-2/60 transition-colors hover:bg-surface-2" onClick={() => toggle(group.name)}>
                    <td className={TD}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(group.name);
                        }}
                        className="flex min-w-0 max-w-full items-center gap-2 text-left"
                      >
                        <ChevronRight className={cn("size-4 shrink-0 text-muted transition-transform", expanded && "rotate-90")} aria-hidden />
                        <span className="truncate font-medium text-ink">{group.name}</span>
                        <span className="shrink-0 text-xs text-muted max-sm:hidden">{plural(group.rows.length, "holding")}</span>
                      </button>
                    </td>
                    <td className={cn(right, "font-medium text-ink")}>{inr(group.value)}</td>
                    <td className={cn(right, "max-sm:hidden")}><WeightCell weight={group.weight} max={maxWeight} /></td>
                    <td className={right}><PnlCell amount={group.pnl} percent={group.pnlPct} /></td>
                    <td className={cn(right, "max-md:hidden")}><Signed value={group.dayPnl}>{signedInr(group.dayPnl)}</Signed></td>
                  </tr>
                  {expanded &&
                    group.rows.map((h) => (
                      <tr key={h.symbol} className="cursor-pointer transition-colors hover:bg-surface-2/70" onClick={() => navigate(symbolPath(h.symbol))}>
                        <td className={cn(TD, "!pl-10 sm:!pl-11")}><SymbolCell symbol={h.symbol} name={h.name} /></td>
                        <td className={right}>{inr(h.value)}</td>
                        <td className={cn(right, "max-sm:hidden")}><WeightCell weight={h.weight} max={maxWeight} /></td>
                        <td className={right}><PnlCell amount={h.pnl} percent={h.pnl_pct} /></td>
                        <td className={cn(right, "max-md:hidden")}><Signed value={h.day_pnl}>{signedInr(h.day_pnl)}</Signed></td>
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot className="font-medium text-ink">
            <tr>
              <td className={foot}>
                Total <span className="ml-1 text-xs font-normal text-muted">{plural(rows.length, "holding")}</span>
              </td>
              <td className={cn(foot, "num whitespace-nowrap text-right")}>{inr(total.value)}</td>
              <td className={cn(foot, "num whitespace-nowrap text-right max-sm:hidden")}>{pct(total.weight, 1)}</td>
              <td className={cn(foot, "num whitespace-nowrap text-right")}><PnlCell amount={total.pnl} percent={total.pnlPct} /></td>
              <td className={cn(foot, "num whitespace-nowrap text-right max-md:hidden")}><Signed value={total.dayPnl}>{signedInr(total.dayPnl)}</Signed></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function Content({ id }: { id: string }) {
  const { name, portfolio } = usePortfolio();
  const actions = useAppActions();
  const overview = useOverview(id);
  const [query, setQuery] = useState("");
  const [assetClass, setAssetClass] = useState(ALL);

  const data = overview.data;
  const holdings = data?.holdings ?? NONE;
  const paper = portfolio?.kind === "paper";

  /** Asset classes that hold something, in allocation order (largest first). */
  const classes = useMemo(() => {
    const present = new Set(holdings.map((h) => h.asset_class));
    const ordered = (data?.allocation.asset_classes ?? []).map((a) => a.name).filter((n) => present.has(n));
    return [...ordered, ...[...present].filter((n) => !ordered.includes(n))];
  }, [holdings, data]);
  const active = classes.includes(assetClass) ? assetClass : ALL;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return holdings.filter(
      (h) => (active === ALL || h.asset_class === active) && (!q || h.symbol.toLowerCase().includes(q) || h.name.toLowerCase().includes(q)),
    );
  }, [holdings, query, active]);
  const narrowed = filtered.length !== holdings.length;

  if (overview.isError) {
    return (
      <Page title="Holdings">
        <Card><ErrorState error={overview.error} onRetry={() => overview.refetch()} /></Card>
      </Page>
    );
  }

  const exportCsv = () => {
    downloadFile(`${fileSlug(name)}-holdings-${todayIso()}.csv`, holdingsToCsv(filtered));
    toast.success(`Exported ${plural(filtered.length, "holding")}`);
  };
  const clear = () => {
    setQuery("");
    setAssetClass(ALL);
  };

  const s = data?.summary;
  return (
    <Page
      title="Holdings"
      description={data ? `${name} · ${plural(holdings.length, "holding")}${s?.as_of ? ` · prices as of ${date(s.as_of)}` : ""}` : undefined}
      actions={
        paper ? (
          <Link to="/lab/paper"><Button>Open paper trading</Button></Link>
        ) : (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
        )
      }
    >
      {!data || !s ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {["Current value", "Invested", "Unrealised P&L", "Today's P&L"].map((label) => (
              <StatTile key={label} label={label} value={null} loading />
            ))}
          </div>
          <CardSkeleton height={420} />
          <CardSkeleton height={220} />
        </div>
      ) : holdings.length === 0 ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<Layers />}
            title={`${name} has no holdings yet`}
            description={
              paper
                ? "Place a simulated order to start. Fills use the latest market price; no real money moves."
                : "Record a buy and the position appears here with live prices. You can also import past transactions from a CSV."
            }
            action={
              paper ? (
                <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
              ) : (
                <>
                  <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
                  <Link to="/transactions?import=1"><Button>Import CSV</Button></Link>
                </>
              )
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatTile label="Current value" value={<span className="num"><Rupees value={s.value} tight /></span>} sub={plural(s.holdings_count, "holding")} />
            <StatTile
              label="Invested"
              value={<span className="num"><Rupees value={s.invested} tight /></span>}
              sub="At average cost"
              hint="Cost of the shares you still hold, including fees, at average cost."
            />
            <StatTile
              label="Unrealised P&L"
              value={<Signed value={s.unrealized_pnl}><Rupees value={s.unrealized_pnl} signed tight /></Signed>}
              sub={<Delta value={s.unrealized_pct}>{signedPct(s.unrealized_pct)}</Delta>}
              hint="Current value minus the cost of what you hold. Not yet locked in."
            />
            <StatTile
              label="Today's P&L"
              value={<Signed value={s.day_pnl}><Rupees value={s.day_pnl} signed tight /></Signed>}
              sub={
                <>
                  <Delta value={s.day_pct}>{signedPct(s.day_pct)}</Delta>
                  <span className="max-sm:hidden">since the previous close</span>
                </>
              }
              hint="Change in the value of your holdings since the previous trading day's close."
            />
          </div>

          <Card
            tour="holdings-table"
            title="All holdings"
            description={
              narrowed
                ? `${filtered.length} of ${plural(holdings.length, "position")} · ${inr(sum(filtered, (h) => h.value))} · ${pct(sum(filtered, (h) => h.weight), 1)} of holdings value`
                : `${plural(holdings.length, "position")}, largest first. Select a row to open the stock.`
            }
            flush
            action={
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={exportCsv} disabled={!filtered.length}>
                Export CSV
              </Button>
            }
          >
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
              <SearchField className="w-full sm:w-64" value={query} onChange={setQuery} label="Filter holdings by symbol or name" placeholder="Filter by symbol or name" />
              {classes.length > 1 && (
                <div className="max-w-full overflow-x-auto">
                  <Segmented
                    label="Asset class"
                    value={active}
                    onChange={setAssetClass}
                    options={[ALL, ...classes].map((c) => ({ value: c, label: <span className="whitespace-nowrap">{c}</span> }))}
                  />
                </div>
              )}
            </div>
            {filtered.length ? (
              <div className="border-t border-line">
                <HoldingsTable rows={filtered} />
              </div>
            ) : (
              <EmptyState
                className="border-t border-line"
                icon={<SearchX />}
                title="No holdings match"
                description={`Nothing in ${name} matches ${query.trim() ? `“${query.trim()}”` : "this filter"}${active !== ALL ? ` in ${active}` : ""}.`}
                action={<Button size="sm" onClick={clear}>Clear filters</Button>}
              />
            )}
          </Card>

          {filtered.length > 0 && <BySector rows={filtered} />}
        </div>
      )}
    </Page>
  );
}

export function HoldingsPage() {
  return <RequirePortfolio>{(id) => <Content id={id} />}</RequirePortfolio>;
}
