/**
 * Trade check, started from wherever the user already is.
 *
 * Checking a trade before making it is the reason a newcomer opens the app, so
 * the first step (say what you are thinking of doing) sits on the dashboard
 * itself. Filling it in goes straight to the result on the Trade check page.
 */
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SymbolPicker } from "@/components/forms/SymbolPicker";
import { TRADE_CHECK } from "@/components/layout/nav";
import { Button, Input, Segmented } from "@/components/ui";
import { ALL } from "@/lib/portfolio";
import type { TradeSide } from "@/lib/types";

/** The address of a trade check, with whatever is already known filled in. With a company and a quantity it runs straight away. */
export function tradeCheckPath(trade: { symbol?: string; side?: TradeSide; qty?: string | number; portfolio?: string | null } = {}): string {
  const params = new URLSearchParams();
  if (trade.symbol) params.set("symbol", trade.symbol);
  if (trade.side) params.set("side", trade.side);
  if (trade.qty && Number(trade.qty) > 0) params.set("qty", String(trade.qty));
  if (trade.portfolio && trade.portfolio !== ALL) params.set("portfolio", trade.portfolio);
  const query = params.toString();
  return query ? `${TRADE_CHECK.to}?${query}` : TRADE_CHECK.to;
}

/** A way into Trade check for a page's header, tinted so it stands apart from the page's other buttons. */
export function TradeCheckButton({ children = "Check a trade", ...trade }: Parameters<typeof tradeCheckPath>[0] & { children?: string }) {
  return (
    <Link
      to={tradeCheckPath(trade)}
      className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] border border-accent/40 bg-accent-soft px-3.5 text-sm font-medium text-ink transition-colors hover:border-accent/70"
    >
      <ClipboardCheck className="size-4 text-accent" aria-hidden />
      {children}
    </Link>
  );
}

/** `holdings` are offered as one-tap starting points; `portfolio` is the one the check should be run against. */
export function QuickTradeCheck({ holdings = [], portfolio, className }: { holdings?: string[]; portfolio?: string | null; className?: string }) {
  const navigate = useNavigate();
  const [side, setSide] = useState<TradeSide>("BUY");
  const [qty, setQty] = useState("");
  const [symbol, setSymbol] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(tradeCheckPath({ symbol, side, qty, portfolio }));
  };

  return (
    <section data-tour="quick-check" className={`rounded-[14px] border border-accent/30 bg-gradient-to-br from-accent-soft via-surface to-surface p-4 shadow-card sm:p-5 ${className ?? ""}`}>
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent text-on-accent">
              <ClipboardCheck className="size-[18px]" strokeWidth={2.2} />
            </span>
            <h2 className="text-base font-semibold leading-snug tracking-tight text-ink">Thinking of buying or selling? Check it first.</h2>
          </div>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-2">
            Trade check tests the trend, the price, the business, the risk and what the trade does to your portfolio, then gives a confidence score out of 100 with the reasons in plain words. Nothing is bought or sold.
          </p>
        </div>

        <form onSubmit={submit} className="flex min-w-0 flex-1 basis-80 flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Segmented<TradeSide>
              label="Buying or selling"
              value={side}
              onChange={setSide}
              options={[{ value: "BUY", label: "Buy" }, { value: "SELL", label: "Sell" }]}
            />
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              aria-label="How many shares"
              placeholder="Shares"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="num w-24"
            />
            <div className="min-w-44 flex-1">
              <SymbolPicker value={symbol} placeholder="Which company? e.g. hero" onSelect={(item) => setSymbol(item.symbol)} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" variant="primary" icon={<ClipboardCheck className="size-4" />}>
              Check this trade
            </Button>
            {holdings.length > 0 && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                or one you hold:
                {holdings.slice(0, 3).map((held) => (
                  <Link
                    key={held}
                    to={tradeCheckPath({ symbol: held, portfolio })}
                    className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 font-medium text-ink-2 ring-1 ring-line transition-colors hover:text-ink hover:ring-line-strong"
                  >
                    {held}
                    <ArrowRight className="size-3" aria-hidden />
                  </Link>
                ))}
              </span>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
