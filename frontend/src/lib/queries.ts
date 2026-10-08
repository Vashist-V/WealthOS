import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, ApiError } from "./api";
import type { TradeInput } from "./types";

/** Prices move once a minute while the market is open; otherwise stay calm. */
const LIVE = { refetchInterval: 60_000, staleTime: 30_000 } as const;
const SLOW = { staleTime: 5 * 60_000 } as const;
const STATIC = { staleTime: 60 * 60_000 } as const;

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: api.me, ...LIVE });
export const usePortfolios = () => useQuery({ queryKey: ["portfolios"], queryFn: api.portfolios, ...LIVE });

export const useOverview = (id: string | null) =>
  useQuery({ queryKey: ["overview", id], queryFn: () => api.overview(id!), enabled: !!id, ...LIVE });

export const usePerformance = (id: string | null, range: string) =>
  useQuery({
    queryKey: ["performance", id, range],
    queryFn: () => api.performance(id!, range),
    enabled: !!id,
    placeholderData: keepPreviousData,
    ...SLOW,
  });

export const useRisk = (id: string | null, lookback: string) =>
  useQuery({
    queryKey: ["risk", id, lookback],
    queryFn: () => api.risk(id!, lookback),
    enabled: !!id,
    placeholderData: keepPreviousData,
    ...SLOW,
  });

export const useXRay = (id: string | null) =>
  useQuery({ queryKey: ["xray", id], queryFn: () => api.xray(id!), enabled: !!id, ...SLOW });

export const useDividends = (id: string | null) =>
  useQuery({ queryKey: ["dividends", id], queryFn: () => api.dividends(id!), enabled: !!id, ...SLOW });

export const useCompare = (ids: string[]) =>
  useQuery({
    queryKey: ["compare", ids],
    queryFn: () => api.compare(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    ...SLOW,
  });

export const useTransactions = (id: string | null) =>
  useQuery({ queryKey: ["transactions", id], queryFn: () => api.transactions(id!), enabled: !!id, ...SLOW });

export const useMarket = () => useQuery({ queryKey: ["market"], queryFn: api.market, ...LIVE });
export const usePulse = () => useQuery({ queryKey: ["pulse"], queryFn: api.pulse, ...LIVE });
/** The market chat's ready-made questions. They are known without asking the server, so they are on screen at once;
 * the server's own list, which adds one about the day's best sector, takes their place when it arrives. */
const MARKET_QUESTIONS = [
  { id: "today", label: "What happened in the market today?" },
  { id: "why", label: "Why did the market move?" },
  { id: "sectors", label: "Which sectors look strongest?" },
  { id: "mood", label: "Is this a good time to invest?" },
  { id: "invest", label: "I have ₹50,000. Where could it go?" },
  { id: "top", label: "Which companies score highest?" },
];

export const useMarketOpening = () => {
  const me = useMe();
  return useQuery({
    queryKey: ["market-opening"],
    queryFn: api.marketOpening,
    ...SLOW,
    placeholderData: {
      ai: me.data?.assistant ?? true,
      web_search: false,
      greeting: "Ask me what happened and why, which sectors look strong, whether it is a good time for one of them, or where a sum of money could go. Every answer comes with a confidence score.",
      suggestions: MARKET_QUESTIONS,
    },
  });
};

/** The latest price of one instrument, for showing what a trade would cost as it is typed. */
export const useQuote = (symbol: string | undefined) =>
  useQuery({
    queryKey: ["quote", symbol],
    queryFn: async () => Object.values(await api.quotes([symbol!]))[0] ?? null,
    enabled: !!symbol,
    ...LIVE,
  });
export const useUniverse = () => useQuery({ queryKey: ["universe"], queryFn: api.universe, ...LIVE });

export const useStock = (symbol: string | undefined) =>
  useQuery({ queryKey: ["stock", symbol], queryFn: () => api.stock(symbol!), enabled: !!symbol, ...LIVE });

export const useHistory = (symbol: string | undefined, range: string) =>
  useQuery({
    queryKey: ["history", symbol, range],
    queryFn: () => api.history(symbol!, range),
    enabled: !!symbol,
    placeholderData: keepPreviousData,
    ...LIVE,
  });

export const useFinancials = (symbol: string | undefined, enabled = true) =>
  useQuery({ queryKey: ["financials", symbol], queryFn: () => api.financials(symbol!), enabled: !!symbol && enabled, ...STATIC });

export const useStockEvents = (symbol: string | undefined) =>
  useQuery({ queryKey: ["stock-events", symbol], queryFn: () => api.stockEvents(symbol!), enabled: !!symbol, ...STATIC });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    ...SLOW,
  });

export const useWatchlists = () => useQuery({ queryKey: ["watchlists"], queryFn: api.watchlists, ...LIVE });
export const useAlerts = () => useQuery({ queryKey: ["alerts"], queryFn: api.alerts, ...LIVE });
export const useJournal = () => useQuery({ queryKey: ["journal"], queryFn: api.journal, ...SLOW });
export const useJournalReview = (id: string | null) =>
  useQuery({ queryKey: ["journal-review", id], queryFn: () => api.journalReview(id!), enabled: !!id, ...SLOW });
export const useCalendar = () => useQuery({ queryKey: ["calendar"], queryFn: api.calendar, ...SLOW });
export const useAssumptions = (id: string | null) =>
  useQuery({ queryKey: ["assumptions", id], queryFn: () => api.assumptions(id!), enabled: !!id, ...SLOW });
export const useBacktestMeta = () => useQuery({ queryKey: ["backtest-meta"], queryFn: api.backtestMeta, ...STATIC });
export const useStrategies = () => useQuery({ queryKey: ["strategies"], queryFn: api.strategies, ...SLOW });
export const useBacktestResults = () => useQuery({ queryKey: ["backtest-results"], queryFn: api.backtestResults, ...SLOW });
export const useAssistantOpening = (symbol: string | undefined, enabled: boolean) =>
  useQuery({ queryKey: ["assistant-opening", symbol], queryFn: () => api.assistantOpening(symbol!), enabled: !!symbol && enabled, ...SLOW });
export const useShare = (id: string | null) =>
  useQuery({ queryKey: ["share", id], queryFn: () => api.share(id!), enabled: !!id && id !== "all", ...SLOW });
/** The checks for one proposed trade. Null until the user has asked for a check. */
export const useTradeCheck = (trade: TradeInput | null) =>
  useQuery({ queryKey: ["trade-check", trade], queryFn: () => api.tradeCheck(trade!), enabled: !!trade, ...SLOW });

/** Everything derived from the ledger. Call after any transaction or portfolio change. */
const PORTFOLIO_KEYS = [
  "portfolios", "overview", "performance", "risk", "xray", "dividends", "compare", "transactions",
  "assumptions", "calendar", "stock", "journal", "me", "assistant-opening", "trade-check",
];

export function invalidatePortfolioData(client: QueryClient): Promise<unknown> {
  return Promise.all(PORTFOLIO_KEYS.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "Something went wrong.";
}

/**
 * A mutation that reports failures as a toast and refreshes the named query
 * keys on success. `invalidate: "portfolio"` refreshes everything ledger-derived.
 */
export function useAction<Input, Output>(
  fn: (input: Input) => Promise<Output>,
  options: {
    invalidate?: string[] | "portfolio";
    success?: string | ((output: Output, input: Input) => string);
    onSuccess?: (output: Output, input: Input) => void;
    /** The caller shows the error itself (e.g. inline in a dialog), so don't toast it. */
    quietErrors?: boolean;
  } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (output, input) => {
      if (options.invalidate === "portfolio") await invalidatePortfolioData(client);
      else if (options.invalidate) await Promise.all(options.invalidate.map((key) => client.invalidateQueries({ queryKey: [key] })));
      if (options.success) toast.success(typeof options.success === "string" ? options.success : options.success(output, input));
      options.onSuccess?.(output, input);
    },
    onError: (error) => {
      if (!options.quietErrors) toast.error(errorMessage(error));
    },
  });
}
