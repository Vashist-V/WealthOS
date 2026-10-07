import { useMemo, useState } from "react";
import { BarChart } from "@/components/charts";
import { Card, DataTable, ErrorState, Segmented, Skeleton, type Column } from "@/components/ui";
import { number } from "@/lib/format";
import { useFinancials } from "@/lib/queries";
import type { Statement } from "@/lib/types";
import { cn } from "@/lib/utils";
import { periodLabel } from "./shared";

const TABS = [
  { value: "income", label: "Income statement", noun: "income statement" },
  { value: "balance", label: "Balance sheet", noun: "balance sheet" },
  { value: "cashflow", label: "Cash flow", noun: "cash flow" },
] as const;
type Tab = (typeof TABS)[number]["value"];
type Frequency = "annual" | "quarterly";
type Row = Statement["rows"][number];

/** The lines a reader looks for first in each statement. */
const HEADLINE = new Set(["revenue", "net_income", "total_assets", "equity", "operating", "free_cash_flow"]);
const CRORE = 1e7;

/** Drop reporting periods the data source returned with no figures at all. */
function trim(statement: Statement): Statement {
  const keep = statement.periods.map((_, i) => statement.rows.some((r) => r.values[i] != null));
  return {
    periods: statement.periods.filter((_, i) => keep[i]),
    rows: statement.rows.map((r) => ({ ...r, values: r.values.filter((_, i) => keep[i]) })),
  };
}

/** Statements as reported, oldest period first, in ₹ crore. */
export function FinancialsCard({ symbol, className }: { symbol: string; className?: string }) {
  const [tab, setTab] = useState<Tab>("income");
  const [frequency, setFrequency] = useState<Frequency>("annual");
  const financials = useFinancials(symbol);
  const data = financials.data;

  const statement = useMemo(() => (data ? trim(data[tab][frequency]) : null), [data, tab, frequency]);
  const chart = useMemo(() => {
    if (tab !== "income" || !statement || statement.periods.length < 2) return null;
    const series = (["revenue", "net_income"] as const)
      .map((key) => statement.rows.find((r) => r.key === key))
      .filter((r): r is Row => !!r)
      .map((r) => ({ name: r.label, data: r.values.map((v) => (v == null ? null : v / CRORE)) }));
    return series.length ? { categories: statement.periods.map(periodLabel), series } : null;
  }, [tab, statement]);

  const columns = useMemo<Column<Row>[]>(() => {
    const periods = statement?.periods ?? [];
    return [
      {
        key: "line",
        header: frequency === "annual" ? "Year ended" : "Quarter ended",
        cell: (r) => <span className={cn(HEADLINE.has(r.key) ? "font-medium text-ink" : "text-ink-2")}>{r.label}</span>,
      },
      ...periods.map<Column<Row>>((period, i) => {
        // Phones show the latest two periods and small tablets four. A sixth needs about 670px, more than the card has below 1536px.
        const fromEnd = periods.length - i;
        return {
          key: period,
          header: periodLabel(period),
          align: "right",
          hide: fromEnd > 5 ? "2xl" : fromEnd > 4 ? "md" : fromEnd > 2 ? "sm" : undefined,
          cell: (r) => {
            const v = r.values[i];
            const text = r.key === "eps" ? number(v, 2) : number(v == null ? null : v / CRORE, 0);
            return <span className={cn(HEADLINE.has(r.key) && "font-medium text-ink")}>{text}</span>;
          },
        };
      }),
    ];
  }, [statement, frequency]);

  const noun = TABS.find((t) => t.value === tab)!.noun;
  const annualHasRows = !!data && data[tab].annual.rows.length > 0;

  return (
    <Card
      title="Financials"
      description="Figures in ₹ crore, as reported. EPS is in ₹ per share."
      className={className}
      flush
      action={
        <Segmented
          label="Reporting period"
          size="sm"
          value={frequency}
          onChange={setFrequency}
          options={[{ value: "annual", label: "Annual" }, { value: "quarterly", label: "Quarterly" }]}
        />
      }
    >
      <div className="overflow-x-auto px-4 pb-3 sm:px-5">
        <Segmented label="Statement" size="sm" value={tab} onChange={setTab} options={TABS} className="whitespace-nowrap" />
      </div>
      {!data ? (
        financials.isError ? (
          <ErrorState error={financials.error} onRetry={() => financials.refetch()} />
        ) : (
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <Skeleton className="h-64 w-full" />
          </div>
        )
      ) : !statement || statement.rows.length === 0 ? (
        <div className="px-6 pb-10 pt-6 text-center text-[13px] leading-relaxed text-muted">
          {frequency === "quarterly" && annualHasRows ? (
            <>
              The data source has no quarterly {noun} for {symbol}.{" "}
              <button type="button" className="font-medium text-accent hover:underline" onClick={() => setFrequency("annual")}>
                Show annual figures
              </button>
            </>
          ) : (
            <>
              The data source has no {noun} for {symbol}. Banks, ETFs and funds are often missing some or all statements.
            </>
          )}
        </div>
      ) : (
        <>
          {chart && (
            <div className="px-4 pb-2 sm:px-5">
              <BarChart
                label={`Revenue and net profit by ${frequency === "annual" ? "year" : "quarter"}, in ₹ crore`}
                format="number"
                height={200}
                categories={chart.categories}
                series={chart.series}
              />
            </div>
          )}
          <DataTable columns={columns} rows={statement.rows} rowKey={(r) => r.key} dense />
        </>
      )}
    </Card>
  );
}
