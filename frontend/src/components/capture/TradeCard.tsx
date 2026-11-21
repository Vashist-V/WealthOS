/**
 * A trade typed into the chat ("I sold 2 TCS at 4,120 yesterday"), as the
 * assistant understood it. The user saves it as it is, changes it first, or
 * ignores it; nothing is recorded until they press Save, and a saved trade can
 * be undone from the same card.
 */
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Pencil, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button } from "@/components/ui";
import { api } from "@/lib/api";
import { date, inr, price, quantity } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { errorMessage, invalidatePortfolioData } from "@/lib/queries";
import type { TradeField, TradeReading } from "@/lib/types";
import { FIELD_NAMES, inOrder, problems, toInput, toRow, TradeRows, type TradeRow } from "./TradeRows";

/** What a card saved, so it can say so (and undo it) after the chat is reopened. */
export interface SavedTrades {
  ids: string[];
  portfolios: string[];
}

export function TradeCard({ reading, saved, onSaved }: { reading: TradeReading; saved?: SavedTrades | null; onSaved: (saved: SavedTrades | null) => void }) {
  const client = useQueryClient();
  const { investment } = usePortfolio();
  const fallback = investment[0]?.id ?? "";
  const [rows, setRows] = useState<TradeRow[]>(() => reading.trades.map((t) => toRow(t, null, fallback)));
  const incomplete = rows.some((r) => Object.keys(problems(r)).length > 0);
  const [editing, setEditing] = useState(incomplete);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = useMemo(() => Object.fromEntries(investment.map((p) => [p.id, p.name])), [investment]);

  const save = async () => {
    if (!rows.length) return;
    if (rows.some((r) => Object.keys(problems(r)).length > 0)) {
      setEditing(true);
      setError("Fill in what's missing first.");
      return;
    }
    setBusy(true);
    setError(null);
    const ids: string[] = [];
    try {
      const byPortfolio = new Map<string, TradeRow[]>();
      inOrder(rows).forEach((r) => byPortfolio.set(r.portfolioId, [...(byPortfolio.get(r.portfolioId) ?? []), r]));
      for (const [portfolio, list] of byPortfolio) {
        const out = await api.importTransactions(portfolio, list.map(toInput));
        ids.push(...out.ids);
      }
      onSaved({ ids, portfolios: [...byPortfolio.keys()] });
      setEditing(false);
    } catch (e) {
      // All or nothing: take back any part that went through.
      await Promise.allSettled(ids.map((id) => api.deleteTransaction(id)));
      setError(errorMessage(e));
    } finally {
      await invalidatePortfolioData(client);
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!saved) return;
    setBusy(true);
    setError(null);
    try {
      for (const id of saved.ids) await api.deleteTransaction(id);
      onSaved(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await invalidatePortfolioData(client);
      setBusy(false);
    }
  };

  if (!rows.length && !saved) return <p className="text-xs text-muted">All the trades were removed.</p>;

  if (saved) {
    const where = saved.portfolios.map((id) => names[id] ?? "your portfolio").join(" and ");
    return (
      <div className="rounded-xl bg-gain-soft/60 px-3.5 py-3 ring-1 ring-inset ring-gain/25">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
          <Check className="size-4 text-gain" aria-hidden />
          Saved {saved.ids.length === 1 ? "the trade" : `${saved.ids.length} trades`} to {where}.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Link to="/holdings"><Button size="sm">See holdings</Button></Link>
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => void undo()} loading={busy}>Undo</Button>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-loss">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface px-3.5 py-3 ring-1 ring-inset ring-line-strong">
      {editing ? (
        <TradeRows rows={rows} onChange={setRows} portfolios={investment} compact />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const q = Number(r.quantity);
            const p = Number(r.price);
            const flags = Object.entries(r.check) as [TradeField, string][];
            return (
              <li key={r.key} className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge tone={r.type === "BUY" ? "accent" : "warn"}>{r.type === "BUY" ? "Buy" : "Sell"}</Badge>
                  <span className="text-sm font-semibold text-ink">{quantity(q)} {r.symbol}</span>
                  {r.name && <span className="min-w-0 truncate text-xs text-muted">{r.name}</span>}
                </div>
                <p className="num mt-1 text-[13px] leading-relaxed text-ink-2">
                  at {price(p)} each · {inr(q * p)} in all · {date(r.date)}
                  {investment.length > 1 && ` · ${names[r.portfolioId] ?? "choose a portfolio"}`}
                </p>
                {flags.map(([field, why]) => (
                  <p key={field} className="mt-1 flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden />
                    <span>
                      <span className="font-medium text-warn">{FIELD_NAMES[field]}:</span> {why}
                    </span>
                  </p>
                ))}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p role="alert" className="mt-2.5 text-xs text-loss">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onClick={() => void save()} loading={busy} disabled={!rows.length}>
          {rows.length > 1 ? `Save ${rows.length} trades` : "Save trade"}
        </Button>
        {editing ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={incomplete}>Done</Button>
        ) : (
          <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>Change</Button>
        )}
      </div>
    </div>
  );
}
