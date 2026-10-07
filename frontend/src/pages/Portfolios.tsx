import { Check, FolderPlus, MoreHorizontal, Pencil, Plus, Share2, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppActions } from "@/components/layout/AppShell";
import { ShareDialog } from "@/components/portfolio/ShareDialog";
import { plural } from "@/components/portfolio/shared";
import {
  Badge, Button, Card, CardSkeleton, ConfirmDialog, EmptyState, ErrorState, IconButton, KeyValue, Menu, MenuItem, MenuSeparator, Page, Signed,
} from "@/components/ui";
import { PnlDelta } from "@/components/widgets";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { compact, DASH, date, inr, signedPct, signedRatioPct } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { useAction, usePortfolios } from "@/lib/queries";
import type { Portfolio } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Index names for the benchmarks a portfolio can be measured against. */
const BENCHMARKS: Record<string, string> = {
  "^NSEI": "NIFTY 50",
  "^BSESN": "SENSEX",
  "^CRSLDX": "NIFTY 500",
  "^NSMIDCP": "NIFTY Next 50",
};

/** Whole rupees up to a lakh, lakh and crore beyond: short enough for a three-column fact grid. */
const brief = (value: number) => (Math.abs(value) < 1e5 ? inr(value) : compact(value));

function PortfolioCard({
  portfolio: p,
  selected,
  onOpen,
  onEdit,
  onShare,
  onDelete,
}: {
  portfolio: Portfolio;
  selected: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const s = p.summary;
  const paper = p.kind === "paper";
  return (
    <article aria-current={selected ? "true" : undefined} className={cn("card flex min-w-0 flex-col p-4 sm:p-5", selected && "border-accent/50 ring-1 ring-accent/40")}>
      <header className="flex items-start gap-3">
        <span className="mt-[7px] size-2.5 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{p.name}</h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={paper ? "warn" : "neutral"}>{paper ? "Paper trading" : "Investment"}</Badge>
            {selected && (
              <Badge tone="accent">
                <Check className="size-3" strokeWidth={2.6} aria-hidden />
                Selected
              </Badge>
            )}
          </div>
        </div>
        <Menu
          trigger={
            <IconButton label={`Actions for ${p.name}`} className="-mr-1.5 -mt-1">
              <MoreHorizontal className="size-4" />
            </IconButton>
          }
        >
          <MenuItem icon={<Pencil />} onSelect={onEdit}>Edit</MenuItem>
          <MenuItem icon={<Share2 />} onSelect={onShare}>Share…</MenuItem>
          <MenuSeparator />
          <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>Delete</MenuItem>
        </Menu>
      </header>

      <p className="mt-3 line-clamp-2 min-h-10 text-[13px] leading-5 text-muted">{p.description || "No description."}</p>

      <div className="mt-4">
        <div className="text-xs text-muted">{paper ? "Account value (simulated)" : "Current value"}</div>
        <div className="num mt-0.5 truncate text-[28px] font-semibold leading-9 tracking-[-0.02em] text-ink">{inr(paper ? s.net_worth : s.value)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <PnlDelta amount={s.day_pnl} percent={s.day_pct} />
          <span className="text-[13px] text-muted">today</span>
        </div>
      </div>

      <KeyValue
        className="mt-4 border-t border-line pt-4"
        columns={3}
        items={[
          { label: paper ? "In positions" : "Invested", value: brief(s.invested), hint: "Cost of the shares still held, including fees, at average cost." },
          { label: "Unrealised P&L", value: <Signed value={s.unrealized_pct}>{signedPct(s.unrealized_pct)}</Signed>, hint: "Current value against the cost of what is held, as a percentage." },
          {
            label: "XIRR",
            value: s.xirr == null ? DASH : <Signed value={s.xirr}>{signedRatioPct(s.xirr)}</Signed>,
            hint: "Annual return that accounts for when each rupee went in or came out.",
          },
          { label: "Holdings", value: s.holdings_count },
          { label: "Benchmark", value: BENCHMARKS[p.benchmark] ?? p.benchmark.replace(/^\^/, "") },
          { label: paper ? "Cash available" : "Cash", value: brief(s.cash) },
        ]}
      />

      <footer className="mt-auto flex items-center justify-between gap-3 pt-4">
        <span className="min-w-0 truncate text-xs text-muted">
          {plural(s.transactions_count, "transaction")}
          {s.first_investment ? ` since ${date(s.first_investment)}` : ""}
        </span>
        <Button variant={selected ? "secondary" : "primary"} size="sm" onClick={onOpen}>
          Open
        </Button>
      </footer>
    </article>
  );
}

export function PortfoliosPage() {
  const list = usePortfolios();
  const { id: selectedId, investment, paper, select } = usePortfolio();
  const { status } = useAuth();
  const actions = useAppActions();
  const navigate = useNavigate();
  const [sharing, setSharing] = useState<{ open: boolean; portfolio: Portfolio | null }>({ open: false, portfolio: null });
  const [removal, setRemoval] = useState<{ open: boolean; portfolio: Portfolio | null }>({ open: false, portfolio: null });

  const sample = useAction(api.loadSampleData, { invalidate: "portfolio", success: "Sample portfolios added" });
  const remove = useAction(api.deletePortfolio, {
    invalidate: "portfolio",
    success: "Portfolio deleted",
    onSuccess: () => setRemoval((r) => ({ ...r, open: false })),
  });

  const create = (
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.newPortfolio()}>
      New portfolio
    </Button>
  );

  if (list.isError) {
    return (
      <Page title="Portfolios">
        <Card><ErrorState error={list.error} onRetry={() => list.refetch()} /></Card>
      </Page>
    );
  }
  if (!list.data) {
    return (
      <Page title="Portfolios">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <CardSkeleton height={240} />
          <CardSkeleton height={240} />
          <CardSkeleton height={240} className="max-md:hidden" />
        </div>
      </Page>
    );
  }

  const portfolios = [...investment, ...paper];
  if (!portfolios.length) {
    return (
      <Page title="Portfolios" description="A portfolio holds one set of transactions. Keep goals or accounts apart, then view them together or one at a time.">
        <Card>
          <EmptyState
            className="py-16"
            icon={<FolderPlus />}
            title="No portfolios yet"
            description="Create one for real holdings you record yourself, or a paper trading portfolio that starts with virtual cash."
            action={
              <>
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => actions.newPortfolio()}>Create portfolio</Button>
                {status === "user" && (
                  <Button icon={<Sparkles className="size-4" />} loading={sample.isPending} onClick={() => sample.mutate(undefined)}>
                    Load sample data
                  </Button>
                )}
              </>
            }
          />
        </Card>
      </Page>
    );
  }

  const combined = investment.reduce((total, p) => total + p.summary.value, 0);
  const doomed = removal.portfolio;
  return (
    <Page
      title="Portfolios"
      description={
        <>
          {investment.length > 0 ? (
            <>
              {plural(investment.length, "investment portfolio")} worth <span className="num font-medium text-ink">{inr(combined)}</span>
              {investment.length > 1 ? " combined" : ""}
            </>
          ) : (
            "No investment portfolios"
          )}
          {paper.length > 0 && ` · ${plural(paper.length, "paper trading portfolio")}`}
        </>
      }
      actions={create}
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {portfolios.map((p) => (
          <PortfolioCard
            key={p.id}
            portfolio={p}
            selected={p.id === selectedId}
            onOpen={() => {
              select(p.id);
              navigate("/");
            }}
            onEdit={() => actions.editPortfolio(p)}
            onShare={() => setSharing({ open: true, portfolio: p })}
            onDelete={() => setRemoval({ open: true, portfolio: p })}
          />
        ))}
      </div>

      <ShareDialog open={sharing.open} portfolio={sharing.portfolio} onOpenChange={(open) => setSharing((s) => ({ ...s, open }))} />
      <ConfirmDialog
        open={removal.open}
        onOpenChange={(open) => setRemoval((r) => ({ ...r, open }))}
        title={doomed ? `Delete ${doomed.name}?` : "Delete portfolio?"}
        description={
          doomed ? (
            <>
              <span className="font-medium text-ink">{doomed.name}</span> will be deleted, and its {plural(doomed.summary.transactions_count, "transaction")} will be deleted too. Its holdings and
              history go with them. This can&apos;t be undone.
            </>
          ) : null
        }
        confirmLabel="Delete portfolio"
        onConfirm={() => doomed && remove.mutate(doomed.id)}
        loading={remove.isPending}
      />
    </Page>
  );
}
