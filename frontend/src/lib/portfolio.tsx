import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePortfolios } from "./queries";
import type { Portfolio } from "./types";

export const ALL = "all";
const KEY = "wealthos.portfolio";

interface PortfolioState {
  /** Selected portfolio id, "all" for every investment portfolio combined, or null when none exist. */
  id: string | null;
  /** The selected portfolio row; null for "all" or when nothing is selected. */
  portfolio: Portfolio | null;
  portfolios: Portfolio[];
  investment: Portfolio[];
  paper: Portfolio[];
  isLoading: boolean;
  isAll: boolean;
  /** Display name of the selection. */
  name: string;
  select: (id: string) => void;
}

const PortfolioContext = createContext<PortfolioState | null>(null);

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = usePortfolios();
  const [stored, setStored] = useState<string | null>(() => localStorage.getItem(KEY));

  const select = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setStored(id);
  }, []);

  const value = useMemo<PortfolioState>(() => {
    const portfolios = data ?? [];
    const investment = portfolios.filter((p) => p.kind === "investment");
    const paper = portfolios.filter((p) => p.kind === "paper");
    const canCombine = investment.length > 1;
    let id: string | null = null;
    if (stored === ALL && canCombine) id = ALL;
    else if (stored && portfolios.some((p) => p.id === stored)) id = stored;
    else if (portfolios.length) id = (investment[0] ?? portfolios[0]).id;
    const portfolio = portfolios.find((p) => p.id === id) ?? null;
    return {
      id, portfolio, portfolios, investment, paper, isLoading, isAll: id === ALL,
      name: id === ALL ? "All portfolios" : (portfolio?.name ?? ""),
      select,
    };
  }, [data, stored, isLoading, select]);

  // Keep storage honest when the remembered portfolio no longer exists.
  useEffect(() => {
    if (!isLoading && value.id && value.id !== stored) localStorage.setItem(KEY, value.id);
  }, [isLoading, value.id, stored]);

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}

export function usePortfolio(): PortfolioState {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error("usePortfolio must be used inside PortfolioProvider");
  return ctx;
}
