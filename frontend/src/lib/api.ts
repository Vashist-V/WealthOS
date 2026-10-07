import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type * as T from "./types";

// What a deployment tells the page about itself, set by /config.js before the app loads.
// When the API serves the app it fills this in from its own settings, so they are entered once.
const DEPLOYED = (window as { __WEALTHOS__?: { supabaseUrl?: string; supabaseAnonKey?: string } }).__WEALTHOS__ ?? {};

// A built app talks to the address it was served from unless told otherwise; in development the API is on its own port.
const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:8000" : "")).replace(/\/$/, "");
const SUPABASE_URL = DEPLOYED.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const SUPABASE_KEY = DEPLOYED.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

/** Null when the app is running in demo-workspace mode only. */
export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEMO_KEY = "wealthos.demo";
const DEMO_PARKED = "wealthos.demo.parked";
/** The demo workspace id. Leaving the demo parks the id rather than deleting
 * it, so coming back finds the same data. */
export const demoSession = {
  get: () => localStorage.getItem(DEMO_KEY),
  resume: (fresh: string) => {
    const id = localStorage.getItem(DEMO_PARKED) ?? fresh;
    localStorage.setItem(DEMO_KEY, id);
    localStorage.removeItem(DEMO_PARKED);
  },
  park: () => {
    const id = localStorage.getItem(DEMO_KEY);
    if (id) localStorage.setItem(DEMO_PARKED, id);
    localStorage.removeItem(DEMO_KEY);
  },
};

async function authHeaders(): Promise<Record<string, string>> {
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    if (data.session) return { Authorization: `Bearer ${data.session.access_token}` };
  }
  const demo = demoSession.get();
  return demo ? { "X-Demo-Session": demo } : {};
}

function describe(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors: surface the first one in plain words.
    const first = detail[0] as { msg?: string; loc?: (string | number)[] } | undefined;
    const parts = (first?.loc ?? []).filter((p) => p !== "body" && p !== "transactions" && p !== "scenarios");
    const row = parts.find((p): p is number => typeof p === "number");
    const field = parts.filter((p) => typeof p === "string").join(" ").replace(/_/g, " ");
    const where = [row !== undefined ? `Row ${row + 1}` : "", field].filter(Boolean).join(", ");
    const msg = first?.msg?.replace(/^Value error, /, "") ?? "Invalid input";
    return where ? `${where}: ${msg}` : msg;
  }
  return "Something went wrong.";
}

async function request<R>(method: string, path: string, body?: unknown, auth = true): Promise<R> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(auth ? await authHeaders() : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the WealthOS server. Check that the API is running.");
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(res.status, describe(payload?.detail));
  }
  return res.json() as Promise<R>;
}

const get = <R>(path: string) => request<R>("GET", path);
const post = <R>(path: string, body: unknown = {}) => request<R>("POST", path, body);
const patch = <R>(path: string, body: unknown) => request<R>("PATCH", path, body);
const del = <R = { deleted: boolean }>(path: string) => request<R>("DELETE", path);
const sym = (symbol: string) => encodeURIComponent(symbol);

export interface PortfolioInput {
  name: string;
  description?: string;
  kind?: "investment" | "paper";
  color?: string;
  benchmark?: string;
  cash_balance?: number;
  initial_capital?: number;
}

export const api = {
  health: () => request<{ status: string; accounts: boolean; demo: boolean; market: T.MarketStatus }>("GET", "/api/health", undefined, false),
  me: () => get<T.Me>("/api/me"),
  loadSampleData: () => post<{ portfolios: number; transactions: number }>("/api/sample-data"),
  removeSampleData: () => del<T.SampleRemoval>("/api/sample-data"),
  assistantOpening: (symbol: string) => get<T.AssistantOpening>(`/api/assistant/stock/${sym(symbol)}`),
  marketOpening: () => get<T.MarketOpening>("/api/assistant/market"),
  resetDemo: () => post<{ portfolios: number }>("/api/demo/reset"),

  portfolios: () => get<T.Portfolio[]>("/api/portfolios"),
  createPortfolio: (body: PortfolioInput) => post<T.Portfolio>("/api/portfolios", body),
  updatePortfolio: (id: string, body: Partial<PortfolioInput>) => patch<T.Portfolio>(`/api/portfolios/${id}`, body),
  deletePortfolio: (id: string) => del(`/api/portfolios/${id}`),
  overview: (id: string) => get<T.Overview>(`/api/portfolios/${id}/overview`),
  performance: (id: string, range: string) => get<T.Performance>(`/api/portfolios/${id}/performance?range=${range}`),
  risk: (id: string, lookback: string) => get<T.RiskReport>(`/api/portfolios/${id}/risk?lookback=${lookback}`),
  xray: (id: string) => get<T.XRay>(`/api/portfolios/${id}/xray`),
  dividends: (id: string) => get<T.DividendReport>(`/api/portfolios/${id}/dividends`),
  compare: (ids: string[]) => get<T.Compare>(`/api/portfolios/compare?ids=${ids.join(",")}`),

  transactions: (id: string) => get<T.TransactionList>(`/api/portfolios/${id}/transactions`),
  addTransaction: (id: string, body: T.TransactionInput) => post<T.Transaction>(`/api/portfolios/${id}/transactions`, body),
  importTransactions: (id: string, transactions: T.TransactionInput[]) =>
    post<{ imported: number }>(`/api/portfolios/${id}/transactions/bulk`, { transactions, source: "import" }),
  updateTransaction: (id: string, body: T.TransactionInput) => patch<T.Transaction>(`/api/transactions/${id}`, body),
  deleteTransaction: (id: string) => del(`/api/transactions/${id}`),
  placeOrder: (id: string, body: { symbol: string; side: "BUY" | "SELL"; quantity: number }) =>
    post<T.Transaction & { value: number }>(`/api/portfolios/${id}/orders`, body),

  share: (id: string) => get<T.Share | null>(`/api/portfolios/${id}/share`),
  setShare: (id: string, show_values: boolean) => request<T.Share>("PUT", `/api/portfolios/${id}/share`, { show_values }),
  revokeShare: (id: string) => del(`/api/portfolios/${id}/share`),
  shared: (token: string) => request<T.SharedPortfolio>("GET", `/api/shared/${token}`, undefined, false),

  market: () => get<T.MarketOverview>("/api/market/overview"),
  pulse: () => get<T.MarketPulse>("/api/market/pulse"),
  universe: () => get<{ stocks: T.UniverseStock[]; benchmarks: Record<string, string> }>("/api/market/universe"),
  search: (q: string) => get<T.Instrument[]>(`/api/market/search?q=${encodeURIComponent(q)}`),
  quotes: (symbols: string[]) => get<Record<string, T.Quote>>(`/api/market/quotes?symbols=${symbols.map(sym).join(",")}`),
  stock: (symbol: string) => get<T.StockDetail>(`/api/market/stocks/${sym(symbol)}`),
  history: (symbol: string, range: string) => get<T.PriceHistory>(`/api/market/stocks/${sym(symbol)}/history?range=${range}`),
  financials: (symbol: string) => get<T.Financials>(`/api/market/stocks/${sym(symbol)}/financials`),
  stockEvents: (symbol: string) => get<T.StockEvents>(`/api/market/stocks/${sym(symbol)}/events`),

  watchlists: () => get<T.Watchlist[]>("/api/watchlists"),
  createWatchlist: (name: string) => post<T.Watchlist>("/api/watchlists", { name }),
  renameWatchlist: (id: string, name: string) => patch<Omit<T.Watchlist, "stocks">>(`/api/watchlists/${id}`, { name }),
  deleteWatchlist: (id: string) => del(`/api/watchlists/${id}`),
  addToWatchlist: (id: string, symbol: string) => post<T.WatchlistStock>(`/api/watchlists/${id}/stocks`, { symbol }),
  removeFromWatchlist: (id: string, symbol: string) => del(`/api/watchlists/${id}/stocks/${sym(symbol)}`),

  alerts: () => get<T.Alert[]>("/api/alerts"),
  evaluateAlerts: () => post<{ alerts: T.Alert[]; fired: { id: string; symbol: string; message: string }[] }>("/api/alerts/evaluate"),
  createAlert: (body: { symbol: string; alert_type: T.AlertType; threshold: number; note?: string }) => post<T.Alert>("/api/alerts", body),
  updateAlert: (id: string, body: { is_active?: boolean; threshold?: number; note?: string }) => patch<T.Alert>(`/api/alerts/${id}`, body),
  deleteAlert: (id: string) => del(`/api/alerts/${id}`),

  journal: () => get<T.JournalEntry[]>("/api/journal"),
  journalReview: (id: string) => get<T.JournalReview>(`/api/journal/${id}/review`),
  createJournal: (body: T.JournalInput) => post<T.JournalEntry>("/api/journal", body),
  updateJournal: (id: string, body: T.JournalInput) => patch<T.JournalEntry>(`/api/journal/${id}`, body),
  deleteJournal: (id: string) => del(`/api/journal/${id}`),

  calendar: () => get<T.Calendar>("/api/calendar"),

  tradeCheck: (trade: T.TradeInput) => post<T.TradeCheck>("/api/trade-check", trade),

  projection: (scenarios: T.ProjectionScenario[]) => post<{ scenarios: T.ProjectionResult[] }>("/api/simulate/projection", { scenarios }),
  shock: (body: {
    portfolio_id: string;
    kind: "market" | "largest" | "sector" | "custom";
    magnitude?: number;
    sector?: string;
    use_beta?: boolean;
    shocks?: Record<string, number>;
  }) => post<T.ShockResult>("/api/simulate/shock", body),
  assumptions: (id: string) => get<T.Assumptions>(`/api/simulate/assumptions/${id}`),
  monteCarlo: (body: {
    portfolio_id?: string | null;
    initial?: number | null;
    monthly: number;
    years: number;
    paths: number;
    expected_return?: number | null;
    volatility?: number | null;
    method: "parametric" | "bootstrap";
    target?: number | null;
  }) => post<T.MonteCarloResult>("/api/simulate/monte-carlo", body),

  backtestMeta: () => get<T.BacktestMeta>("/api/backtest/meta"),
  runBacktest: (body: {
    symbol: string;
    start_date: string;
    end_date?: string | null;
    capital: number;
    config: T.StrategyConfig;
    strategy_id?: string | null;
    strategy_name?: string;
    save?: boolean;
  }) => post<T.BacktestResult>("/api/backtest/run", body),
  strategies: () => get<T.Strategy[]>("/api/backtest/strategies"),
  createStrategy: (body: { name: string; description: string; config: T.StrategyConfig }) => post<T.Strategy>("/api/backtest/strategies", body),
  updateStrategy: (id: string, body: { name: string; description: string; config: T.StrategyConfig }) =>
    patch<T.Strategy>(`/api/backtest/strategies/${id}`, body),
  deleteStrategy: (id: string) => del(`/api/backtest/strategies/${id}`),
  backtestResults: () => get<T.SavedBacktest[]>("/api/backtest/results"),
  deleteBacktestResult: (id: string) => del(`/api/backtest/results/${id}`),
};

/** POST a body and read the answer as a stream of server-sent events. Resolves when the stream ends. */
async function stream(path: string, body: unknown, onEvent: (event: T.AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "Can't reach the WealthOS server. Check that the API is running.");
  }
  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null);
    throw new ApiError(res.status, describe(payload?.detail));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Events are separated by a blank line; keep any partial event for the next chunk.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (line) onEvent(JSON.parse(line.slice(6)) as T.AssistantEvent);
    }
  }
}

/** One question to an assistant, with the conversation so far. */
export interface AssistantQuestion {
  question: string;
  /** Set when the user picked a suggested question, so it can be answered from data without a model. */
  intent?: string | null;
  history: { role: "user" | "assistant"; content: string }[];
}

/**
 * Ask the stock assistant a question. The answer arrives as a stream of
 * events; `onEvent` is called for each. Resolves when the stream ends.
 */
export function askAssistant(symbol: string, body: AssistantQuestion, onEvent: (event: T.AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  return stream(`/api/assistant/stock/${sym(symbol)}`, body, onEvent, signal);
}

/** Ask the market assistant: the same stream, with `cards` events carrying the scores for what was asked. */
export function askMarket(body: AssistantQuestion, onEvent: (event: T.AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  return stream("/api/assistant/market", body, onEvent, signal);
}

/** A trade check explained in plain words, as the same stream of events the stock assistant uses. */
export function explainTrade(trade: T.TradeInput, onEvent: (event: T.AssistantEvent) => void, signal?: AbortSignal): Promise<void> {
  return stream("/api/trade-check/explain", trade, onEvent, signal);
}
