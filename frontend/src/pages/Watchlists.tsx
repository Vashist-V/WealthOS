import { BellPlus, Ellipsis, ListPlus, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertDialog } from "@/components/forms/AlertDialog";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { bigInr, multiple, relativeVolume, StockCell } from "@/components/market/shared";
import { WATCHLIST_KEYS, WatchlistNameDialog } from "@/components/market/WatchlistMenu";
import {
  Button, Card, CardSkeleton, ConfirmDialog, DataTable, EmptyState, ErrorState, IconButton, Menu, MenuItem, Page, RangeBar, Signed, Skeleton,
  Sparkline, type Column,
} from "@/components/ui";
import { api } from "@/lib/api";
import { compactNumber, pct, price, signedPct } from "@/lib/format";
import { useAction, useWatchlists } from "@/lib/queries";
import type { Watchlist, WatchlistStock } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";

const DESCRIPTION = "Stocks you are following, with the latest prices. Nothing here affects your portfolios.";

function summary(list: Watchlist): string {
  const n = list.stocks.length;
  if (n === 0) return "No stocks yet";
  const up = list.stocks.filter((s) => (s.change_pct ?? 0) > 0).length;
  const down = list.stocks.filter((s) => (s.change_pct ?? 0) < 0).length;
  return `${n} stock${n === 1 ? "" : "s"} · ${up} up and ${down} down today`;
}

export function WatchlistsPage() {
  const navigate = useNavigate();
  const lists = useWatchlists();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ open: boolean; editing: Watchlist | null }>({ open: false, editing: null });
  const [deleting, setDeleting] = useState<Watchlist | null>(null);
  const [alertFor, setAlertFor] = useState<{ open: boolean; symbol?: string; price?: number }>({ open: false });
  const [pickerKey, setPickerKey] = useState(0);

  const data = lists.data;
  const active = data?.find((l) => l.id === activeId) ?? data?.[0] ?? null;

  const add = useAction((input: { list: Watchlist; symbol: string }) => api.addToWatchlist(input.list.id, input.symbol), {
    invalidate: WATCHLIST_KEYS,
    success: (_, input) => `${input.symbol} added to ${input.list.name}`,
  });
  const remove = useAction((input: { list: Watchlist; symbol: string }) => api.removeFromWatchlist(input.list.id, input.symbol), {
    invalidate: WATCHLIST_KEYS,
    success: (_, input) => `${input.symbol} removed from ${input.list.name}`,
  });
  const destroy = useAction((list: Watchlist) => api.deleteWatchlist(list.id), {
    invalidate: WATCHLIST_KEYS,
    success: (_, list) => `${list.name} deleted`,
    onSuccess: () => {
      setDeleting(null);
      setActiveId(null);
    },
  });

  // Price and today's change share a cell, as in the holdings table, so the row still fits a phone.
  // The sparkline and P/B wait for the widest screens, where there is room for them beside the row actions.
  const columns: Column<WatchlistStock>[] = !active
    ? []
    : [
        { key: "stock", header: "Stock", sort: (r) => r.symbol, cell: (r) => <StockCell symbol={r.symbol} name={r.name} /> },
        {
          key: "price", header: "Price", align: "right", sort: (r) => r.change_pct,
          cell: (r) => (
            <div>
              <div className="text-ink">{price(r.price)}</div>
              <Signed value={r.change_pct} className="text-xs">{signedPct(r.change_pct)}</Signed>
            </div>
          ),
        },
        { key: "trend", header: "30 days", hide: "2xl", cell: (r) => <Sparkline data={r.spark} width={72} height={26} /> },
        {
          key: "volume", header: "Volume", align: "right", hide: "md", sort: (r) => r.relative_volume,
          hint: "Shares traded today. Beneath: today's volume against the average of the previous 20 sessions, which is what this column sorts by.",
          // Indices report no volume.
          cell: (r) =>
            r.volume ? (
              <div>
                <div>{compactNumber(r.volume)}</div>
                <div className="text-xs text-muted">{relativeVolume(r.relative_volume)}</div>
              </div>
            ) : (
              <span className="text-muted">—</span>
            ),
        },
        {
          key: "cap", header: "Market cap", align: "right", hide: "lg", sort: (r) => r.market_cap, cell: (r) => bigInr(r.market_cap),
          hint: "Share price multiplied by the number of shares: the market value of the whole company.",
        },
        {
          key: "pe", header: "P/E", align: "right", hide: "xl", sort: (r) => r.pe, cell: (r) => multiple(r.pe),
          hint: "Price divided by earnings per share over the past 12 months.",
        },
        {
          key: "pb", header: "P/B", align: "right", hide: "2xl", sort: (r) => r.pb, cell: (r) => multiple(r.pb),
          hint: "Price divided by book value (net assets) per share.",
        },
        {
          key: "yield", header: "Div. yield", align: "right", hide: "xl", sort: (r) => r.dividend_yield, cell: (r) => pct(r.dividend_yield),
          hint: "Dividends paid over the past 12 months as a share of the latest price.",
        },
        {
          key: "range", header: "52-week range", hide: "xl", width: "110px", hint: "Where the latest price sits between the 52-week low (left) and high (right).",
          cell: (r) => (r.price == null ? <span className="text-muted">—</span> : <RangeBar low={r.low_52w} high={r.high_52w} value={r.price} />),
        },
        {
          key: "actions", header: <span className="sr-only">Actions</span>, align: "right",
          cell: (r) => (
            <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              <IconButton label={`Set an alert on ${r.symbol}`} onClick={() => setAlertFor({ open: true, symbol: r.symbol, price: r.price })}>
                <BellPlus className="size-4" />
              </IconButton>
              <IconButton
                label={`Remove ${r.symbol} from ${active.name}`}
                disabled={remove.isPending && remove.variables?.symbol === r.symbol}
                onClick={() => remove.mutate({ list: active, symbol: r.symbol })}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          ),
        },
      ];

  const newList = (
    <Button icon={<Plus className="size-4" />} onClick={() => setNaming({ open: true, editing: null })}>
      New watchlist
    </Button>
  );

  let body: ReactNode;
  if (!data) {
    body = lists.isError ? (
      <Card>
        <ErrorState error={lists.error} onRetry={() => lists.refetch()} />
      </Card>
    ) : (
      <>
        <div className="mb-4 flex gap-2">
          <Skeleton className="h-8 w-36 rounded-full" />
          <Skeleton className="h-8 w-44 rounded-full" />
        </div>
        <CardSkeleton height={360} />
      </>
    );
  } else if (!active) {
    body = (
      <Card>
        <EmptyState
          className="py-16"
          icon={<Star />}
          title="No watchlists yet"
          description="A watchlist keeps a group of stocks in one place with their price, valuation and 52-week range. Stocks on a watchlist also show up in the calendar."
          action={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNaming({ open: true, editing: null })}>
              New watchlist
            </Button>
          }
        />
      </Card>
    );
  } else {
    body = (
      <>
        <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 py-1" role="tablist" aria-label="Watchlists">
          {data.map((list) => {
            const selected = list.id === active.id;
            return (
              <button
                key={list.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveId(list.id)}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium ring-1 ring-inset transition-colors",
                  selected ? "bg-accent-soft text-ink ring-accent/40" : "bg-surface text-ink-2 ring-line hover:bg-surface-2 hover:text-ink",
                )}
              >
                {list.name}
                <span className={cn("num text-xs", selected ? "text-ink-2" : "text-muted")}>{list.stocks.length}</span>
              </button>
            );
          })}
        </div>

        <Card
          title={active.name}
          description={summary(active)}
          flush
          action={
            <>
              <SymbolPicker
                key={`${active.id}-${pickerKey}`}
                value=""
                placeholder="Add a stock"
                className="w-[min(17rem,calc(100vw-7.5rem))]"
                onSelect={(item) => add.mutate({ list: active, symbol: item.symbol }, { onSettled: () => setPickerKey((k) => k + 1) })}
              />
              <Menu
                trigger={
                  <IconButton label={`Options for ${active.name}`}>
                    <Ellipsis className="size-4" />
                  </IconButton>
                }
              >
                <MenuItem icon={<Pencil />} onSelect={() => setNaming({ open: true, editing: active })}>
                  Rename
                </MenuItem>
                <MenuItem icon={<Trash2 />} danger onSelect={() => setDeleting(active)}>
                  Delete watchlist
                </MenuItem>
              </Menu>
            </>
          }
        >
          <DataTable
            key={active.id}
            columns={columns}
            rows={active.stocks}
            rowKey={(r) => r.id}
            onRowClick={(r) => navigate(symbolPath(r.symbol))}
            empty={
              <EmptyState
                icon={<ListPlus />}
                title={`${active.name} is empty`}
                description="Use the search box above to add a stock, ETF or index. You can also add one from its own page with Add to watchlist."
              />
            }
          />
        </Card>
      </>
    );
  }

  return (
    <Page title="Watchlists" description={DESCRIPTION} actions={data && active ? newList : undefined}>
      {body}

      <WatchlistNameDialog
        open={naming.open}
        onOpenChange={(open) => setNaming((s) => ({ ...s, open }))}
        editing={naming.editing}
        onCreated={(list) => setActiveId(list.id)}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "watchlist"}?`}
        description={
          deleting?.stocks.length
            ? `The list and its ${deleting.stocks.length} stock${deleting.stocks.length === 1 ? "" : "s"} are removed. Alerts you set on those stocks stay, and so do any holdings.`
            : "The empty list is removed."
        }
        confirmLabel="Delete watchlist"
        onConfirm={() => deleting && destroy.mutate(deleting)}
        loading={destroy.isPending}
      />
      <AlertDialog open={alertFor.open} onOpenChange={(open) => setAlertFor((s) => ({ ...s, open }))} symbol={alertFor.symbol} price={alertFor.price} />
    </Page>
  );
}
