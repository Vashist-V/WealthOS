import { ArrowLeftRight, Download, FlaskConical, MoreHorizontal, Pencil, Plus, SearchX, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAppActions } from "@/components/layout/AppShell";
import { ImportCsvDialog } from "@/components/portfolio/ImportCsvDialog";
import { fileSlug, plural, Rupees, SearchField, TX_TYPES, TypeBadge } from "@/components/portfolio/shared";
import {
  Badge, Button, Card, CardSkeleton, ConfirmDialog, DataTable, EmptyState, ErrorState, IconButton, Menu, MenuItem, Page, Segmented, Select, Signed, StatTile,
  SymbolCell, Tooltip, type Column,
} from "@/components/ui";
import { RequirePortfolio } from "@/components/widgets";
import { api } from "@/lib/api";
import { transactionsToCsv } from "@/lib/csv";
import { DASH, date, inr, number, pct, price, quantity, todayIso } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useAction, useTransactions } from "@/lib/queries";
import type { Transaction, TxType } from "@/lib/types";
import { cn, downloadFile } from "@/lib/utils";

type TypeFilter = "ALL" | TxType;
const ALL_YEARS = "all";
/** Rows drawn at once. Older rows stay reachable through the filters and the export. */
const MAX_ROWS = 500;
const NONE: Transaction[] = [];

const isSplit = (t: Transaction) => Math.abs(t.split_factor - 1) > 1e-9;

function SplitBadge({ tx }: { tx: Transaction }) {
  const factor = tx.split_factor;
  return (
    <Tooltip
      content={
        <>
          Entered as it happened: {quantity(tx.quantity)} at {price(tx.price)}. A split or bonus came later, so holdings and returns restate this trade ×{quantity(factor)}, as{" "}
          {quantity(tx.quantity * factor)} at {price(tx.price / factor)}.
        </>
      }
    >
      <button type="button" className="inline-flex cursor-help" onClick={(e) => e.stopPropagation()}>
        <Badge>Split-adjusted</Badge>
      </button>
    </Tooltip>
  );
}

function Content({ id }: { id: string }) {
  const { name, portfolio, investment } = usePortfolio();
  const actions = useAppActions();
  const list = useTransactions(id);
  const [params, setParams] = useSearchParams();
  const [type, setType] = useState<TypeFilter>("ALL");
  const [query, setQuery] = useState("");
  const [year, setYear] = useState(ALL_YEARS);
  const [importing, setImporting] = useState(false);
  const [removal, setRemoval] = useState<{ open: boolean; tx: Transaction | null }>({ open: false, tx: null });

  const all = id === "all";
  const paper = portfolio?.kind === "paper";
  const canRecord = !paper && investment.length > 0;

  const remove = useAction(api.deleteTransaction, {
    invalidate: "portfolio",
    success: "Transaction deleted",
    onSuccess: () => setRemoval((r) => ({ ...r, open: false })),
  });

  // Other pages link here with ?import=1 to open the importer directly.
  const wantsImport = params.has("import");
  useEffect(() => {
    if (!wantsImport) return;
    if (canRecord) setImporting(true);
    setParams({}, { replace: true });
  }, [wantsImport, canRecord, setParams]);

  const transactions = list.data?.transactions ?? NONE;
  const years = useMemo(() => [...new Set(transactions.map((t) => t.transaction_date.slice(0, 4)))].sort().reverse(), [transactions]);
  const activeYear = years.includes(year) ? year : ALL_YEARS;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return transactions.filter(
      (t) =>
        (type === "ALL" || t.transaction_type === type) &&
        (activeYear === ALL_YEARS || t.transaction_date.startsWith(activeYear)) &&
        (!q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)),
    );
  }, [transactions, type, activeYear, query]);
  const narrowed = filtered.length !== transactions.length;
  const rows = filtered.length > MAX_ROWS ? filtered.slice(0, MAX_ROWS) : filtered;

  const counts = useMemo(() => {
    const out: Record<TxType, number> = { BUY: 0, SELL: 0, DIVIDEND: 0 };
    transactions.forEach((t) => (out[t.transaction_type] += 1));
    return out;
  }, [transactions]);
  const filteredSum = (kind: TxType) => filtered.reduce((total, t) => (t.transaction_type === kind ? total + t.amount : total), 0);

  if (list.isError) {
    return (
      <Page title="Transactions">
        <Card><ErrorState error={list.error} onRetry={() => list.refetch()} /></Card>
      </Page>
    );
  }

  const exportCsv = () => {
    downloadFile(`${fileSlug(name)}-transactions-${todayIso()}.csv`, transactionsToCsv(filtered, { portfolio: all }));
    toast.success(`Exported ${plural(filtered.length, "transaction")}`);
  };
  const clear = () => {
    setType("ALL");
    setQuery("");
    setYear(ALL_YEARS);
  };

  const columns: Column<Transaction>[] = [
    {
      key: "date", header: "Date", hide: "sm", sort: (t) => t.transaction_date,
      cell: (t) => (
        <div className="num whitespace-nowrap">
          {date(t.transaction_date)}
          {all && t.portfolio_name && <div className="max-w-32 truncate text-xs text-muted xl:hidden">{t.portfolio_name}</div>}
        </div>
      ),
    },
    {
      key: "stock", header: "Stock", sort: (t) => t.symbol,
      cell: (t) => (
        <div className="flex max-w-44 flex-wrap items-center gap-x-2 gap-y-1 xl:max-w-none">
          <SymbolCell
            symbol={t.symbol}
            sub={
              <>
                <span className="sm:hidden">{TX_TYPES[t.transaction_type].label} · {date(t.transaction_date)}</span>
                <span className="max-sm:hidden">{t.name}</span>
              </>
            }
          />
          {isSplit(t) && <SplitBadge tx={t} />}
        </div>
      ),
    },
    { key: "type", header: "Type", hide: "sm", sort: (t) => t.transaction_type, cell: (t) => <TypeBadge type={t.transaction_type} /> },
    { key: "quantity", header: "Quantity", align: "right", hide: "xl", sort: (t) => t.quantity, cell: (t) => quantity(t.quantity) },
    { key: "price", header: "Price", align: "right", hide: "xl", sort: (t) => t.price, cell: (t) => price(t.price) },
    { key: "fees", header: "Fees", align: "right", hide: "xl", sort: (t) => t.fees, cell: (t) => (t.fees ? price(t.fees) : <span className="text-muted">{DASH}</span>) },
    {
      key: "amount", header: "Amount", align: "right", sort: (t) => t.amount, hint: "Quantity × price. Buys add fees; sells and dividends are shown after fees.",
      cell: (t) => (
        <div>
          <span className="font-medium text-ink">{inr(t.amount)}</span>
          <div className="text-xs text-muted xl:hidden">{quantity(t.quantity)} × {price(t.price)}</div>
        </div>
      ),
    },
    {
      key: "notes", header: "Notes", hide: "xl", width: "18%", className: "max-w-0",
      cell: (t) => (t.notes ? <div className="truncate" title={t.notes}>{t.notes}</div> : <span className="text-muted">{DASH}</span>),
    },
    ...(all
      ? ([{
          key: "portfolio", header: "Portfolio", hide: "xl", sort: (t) => t.portfolio_name,
          cell: (t) => <div className="max-w-32 truncate">{t.portfolio_name ?? DASH}</div>,
        }] as Column<Transaction>[])
      : []),
    {
      key: "menu", header: <span className="sr-only">Actions</span>, align: "right", width: "52px",
      cell: (t) => (
        <Menu
          trigger={
            <IconButton label={`Actions for ${t.symbol}, ${date(t.transaction_date)}`} className="-my-1">
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
        >
          {!paper && t.source !== "paper" && (
            <MenuItem icon={<Pencil />} onSelect={() => actions.editTransaction(t)}>Edit</MenuItem>
          )}
          <MenuItem icon={<Trash2 />} danger onSelect={() => setRemoval({ open: true, tx: t })}>Delete</MenuItem>
        </Menu>
      ),
    },
  ];

  const totals = list.data?.totals;
  const first = transactions.length ? transactions[transactions.length - 1].transaction_date : null;
  const traded = totals ? totals.bought + totals.sold : 0;
  const pending = removal.tx;

  return (
    <Page
      title="Transactions"
      description={list.data ? `${name} · ${plural(transactions.length, "transaction")}${first ? ` since ${date(first)}` : ""}` : undefined}
      actions={
        <>
          {transactions.length > 0 && (
            <Button icon={<Download className="size-4" />} onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>
          )}
          {paper ? (
            <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
          ) : (
            canRecord && (
              <>
                <Button icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
              </>
            )
          )}
        </>
      }
    >
      {paper && (
        <p className="mb-4 flex items-start gap-2.5 rounded-xl bg-surface-2 px-4 py-3 text-[13px] leading-relaxed text-ink-2 ring-1 ring-line">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span>
            Paper trades are placed from{" "}
            <Link to="/lab/paper" className="font-medium text-accent hover:underline">Paper trading</Link> and fill at the latest market price. Here they can be deleted, but not added, imported
            or edited.
          </span>
        </p>
      )}

      {!list.data || !totals ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {["Total bought", "Total sold", "Realised P&L", "Fees paid"].map((label) => (
              <StatTile key={label} label={label} value={null} loading />
            ))}
          </div>
          <CardSkeleton height={460} />
        </div>
      ) : transactions.length === 0 ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<ArrowLeftRight />}
            title={`${name} has no transactions yet`}
            description={
              paper
                ? "Orders placed in paper trading are listed here as they fill."
                : "Record a buy, sell or dividend, or import a CSV from your broker. Holdings, cost and returns are all built from this ledger."
            }
            action={
              paper ? (
                <Link to="/lab/paper"><Button variant="primary">Open paper trading</Button></Link>
              ) : (
                canRecord && (
                  <>
                    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>Add transaction</Button>
                    <Button icon={<Upload className="size-4" />} onClick={() => setImporting(true)}>Import CSV</Button>
                  </>
                )
              )
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <div className={cn("grid grid-cols-2 gap-3 sm:gap-4", totals.dividends ? "lg:grid-cols-5" : "lg:grid-cols-4")}>
            <StatTile
              label="Total bought"
              value={<span className="num"><Rupees value={totals.bought} tight /></span>}
              sub={plural(counts.BUY, "buy")}
              hint="What every buy cost, fees included."
            />
            <StatTile
              label="Total sold"
              value={<span className="num"><Rupees value={totals.sold} tight /></span>}
              sub={plural(counts.SELL, "sale")}
              hint="What every sale brought in, after fees."
            />
            <StatTile
              label="Realised P&L"
              value={<Signed value={totals.realized_pnl}><Rupees value={totals.realized_pnl} signed tight /></Signed>}
              sub="From shares sold"
              hint="Profit or loss locked in by selling: sale proceeds minus the average cost of the shares sold, after fees."
            />
            <StatTile
              label="Fees paid"
              value={<span className="num"><Rupees value={totals.fees} tight /></span>}
              sub={totals.fees > 0 && traded > 0 ? `${pct((totals.fees / traded) * 100)} of the amount traded` : "None recorded"}
              hint="Brokerage, taxes and other charges entered on buys and sells."
            />
            {totals.dividends !== 0 && (
              <StatTile
                label="Dividends recorded"
                value={<span className="num"><Rupees value={totals.dividends} tight /></span>}
                sub={plural(counts.DIVIDEND, "entry", "entries")}
                hint="Dividends you entered as transactions: shares held × dividend per share."
              />
            )}
          </div>

          <Card
            tour="transactions-table"
            title="Ledger"
            description={
              narrowed
                ? `${number(filtered.length)} of ${plural(transactions.length, "transaction")} · bought ${inr(filteredSum("BUY"))} · sold ${inr(filteredSum("SELL"))}`
                : "Every trade as it was entered, newest first."
            }
            flush
          >
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-5">
              <SearchField className="w-full sm:w-64" value={query} onChange={setQuery} label="Search transactions by symbol or name" placeholder="Search symbol or name" />
              <Segmented<TypeFilter>
                label="Transaction type"
                value={type}
                onChange={setType}
                options={[
                  { value: "ALL", label: "All" },
                  { value: "BUY", label: "Buy" },
                  { value: "SELL", label: "Sell" },
                  { value: "DIVIDEND", label: "Dividend" },
                ]}
              />
              <Select aria-label="Year" className="w-auto min-w-28" value={activeYear} onChange={(e) => setYear(e.target.value)}>
                <option value={ALL_YEARS}>All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </Select>
            </div>
            <div className="border-t border-line">
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(t) => t.id}
                defaultSort={{ key: "date", dir: "desc" }}
                empty={
                  <EmptyState
                    icon={<SearchX />}
                    title="No transactions match"
                    description="Nothing in the ledger fits this search, type and year."
                    action={<Button size="sm" onClick={clear}>Clear filters</Button>}
                  />
                }
              />
            </div>
            {filtered.length > MAX_ROWS && (
              <p className="border-t border-line px-4 py-3 text-xs leading-relaxed text-muted sm:px-5">
                Showing the latest {number(MAX_ROWS)} of {number(filtered.length)}. Narrow by year, type or search to reach older rows. Export CSV includes all {number(filtered.length)}.
              </p>
            )}
          </Card>
        </div>
      )}

      <ImportCsvDialog open={importing} onOpenChange={setImporting} />
      <ConfirmDialog
        open={removal.open}
        onOpenChange={(open) => setRemoval((r) => ({ ...r, open }))}
        title="Delete this transaction?"
        description={
          pending ? (
            <>
              The {TX_TYPES[pending.transaction_type].label.toLowerCase()} of {quantity(pending.quantity)} {pending.symbol} on {date(pending.transaction_date)} ({inr(pending.amount)}) is removed
              from the ledger. Holdings, cost and returns are rebuilt without it.
            </>
          ) : null
        }
        confirmLabel="Delete transaction"
        onConfirm={() => pending && remove.mutate(pending.id)}
        loading={remove.isPending}
      />
    </Page>
  );
}

export function TransactionsPage() {
  return <RequirePortfolio>{(id) => <Content id={id} />}</RequirePortfolio>;
}
