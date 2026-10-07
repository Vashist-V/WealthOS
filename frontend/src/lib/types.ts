/** Shapes returned by the WealthOS API. Percent fields ending in `_pct`,
 * `weight` and chart series are already in percent; ratio fields such as
 * `xirr`, `cagr`, `volatility` and `max_drawdown` are fractions. */

export type PortfolioKind = "investment" | "paper" | "combined";
export type TxType = "BUY" | "SELL" | "DIVIDEND";

export interface Summary {
  invested: number;
  value: number;
  cash: number;
  net_worth: number;
  unrealized_pnl: number;
  unrealized_pct: number;
  realized_pnl: number;
  dividends: number;
  total_pnl: number;
  day_pnl: number;
  day_pct: number;
  xirr: number | null;
  cagr?: number | null;
  total_return?: number | null;
  holdings_count: number;
  transactions_count: number;
  first_investment: string | null;
  initial_capital: number;
  as_of: string | null;
}

export interface Portfolio {
  id: string;
  name: string;
  description: string;
  kind: "investment" | "paper";
  color: string;
  benchmark: string;
  benchmark_name: string;
  cash_balance: number;
  initial_capital: number;
  created_at: string;
  summary: Summary;
}

export interface Holding {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  asset_class: string;
  quantity: number;
  avg_cost: number;
  invested: number;
  price: number;
  prev_close: number | null;
  value: number;
  pnl: number;
  pnl_pct: number;
  day_change_pct: number;
  day_pnl: number;
  realized_pnl: number;
  dividends: number;
  holding_days: number;
  first_buy: string | null;
  high_52w: number | null;
  low_52w: number | null;
  dividend_yield: number;
  priced: boolean;
  weight: number;
  spark: number[];
}

export interface Bucket {
  name: string;
  value: number;
  invested: number;
  day_pnl: number;
  count: number;
  weight: number;
  pnl: number;
  pnl_pct: number;
}

export interface Concentration {
  largest_holding: { symbol: string; weight: number } | null;
  top_3: number;
  top_5: number;
  top_10: number;
  largest_sector: { name: string; weight: number } | null;
  effective_holdings: number;
  hhi: number;
}

export interface Allocation {
  asset_classes: Bucket[];
  sectors: Bucket[];
  industries: Bucket[];
  concentration: Concentration;
}

export interface Contribution {
  symbol: string;
  name: string;
  pnl: number;
  pnl_pct: number;
  contribution: number;
  day_pnl: number;
  weight: number;
}

export interface Overview {
  portfolio: { id: string; name: string; kind: PortfolioKind; benchmark: string; benchmark_name: string };
  summary: Summary;
  holdings: Holding[];
  allocation: Allocation;
  contributions: Contribution[];
}

export interface Drawdown {
  value: number;
  peak: string | null;
  trough: string | null;
  recovered: string | null;
}

export interface Performance {
  range: string;
  benchmark: string;
  dates: string[];
  value: number[];
  invested: number[];
  portfolio_return: number[];
  benchmark_return: number[];
  drawdown: number[];
  monthly: { month: string; portfolio: number; benchmark: number }[];
  stats: {
    period_return: number;
    benchmark_return: number;
    excess_return: number;
    cagr: number | null;
    benchmark_cagr: number | null;
    volatility: number | null;
    max_drawdown: Drawdown;
    best_day: number;
    worst_day: number;
    value_change: number;
    net_invested: number;
    start_value: number;
    end_value: number;
    days: number;
  } | null;
}

export interface VaR {
  historical: number | null;
  parametric: number | null;
  cvar: number | null;
  historical_amount: number | null;
  cvar_amount: number | null;
}

export interface RiskSummary {
  annual_return: number | null;
  volatility: number | null;
  benchmark_volatility: number | null;
  benchmark_return: number | null;
  beta: number | null;
  alpha: number | null;
  sharpe: number | null;
  sortino: number | null;
  max_drawdown: Drawdown;
  benchmark_max_drawdown: number;
  tracking_error: number | null;
  var_95: VaR;
  var_99: VaR;
  best_day: number | null;
  worst_day: number | null;
  positive_days: number | null;
  up_capture: number | null;
  down_capture: number | null;
  skew: number | null;
  kurtosis: number | null;
  observations: number;
}

export interface CorrelationPair {
  a: string;
  b: string;
  value: number;
}

export interface RiskReport {
  lookback: string;
  benchmark: string;
  risk_free_rate: number;
  empty: boolean;
  value: number;
  summary: RiskSummary;
  variance: { annual: number; daily: number; diversification_ratio: number };
  holdings: {
    symbol: string;
    name: string;
    sector: string;
    weight: number;
    volatility: number | null;
    beta: number | null;
    risk_contribution: number;
    period_return: number | null;
    max_drawdown: number | null;
  }[];
  correlation: {
    symbols: string[];
    matrix: (number | null)[][];
    average: number | null;
    highest: CorrelationPair[];
    lowest: CorrelationPair[];
  };
  series: { dates: string[]; portfolio: number[]; benchmark: number[]; drawdown: number[]; benchmark_drawdown: number[] };
  rolling_volatility: { dates: string[]; portfolio: number[]; benchmark: number[] };
  histogram: { edges: number[]; counts: number[] };
}

export interface XRay {
  portfolio: Overview["portfolio"];
  summary: Summary;
  allocation: Allocation;
  holdings: Holding[];
  metrics: {
    value: number;
    largest_holding: { symbol: string; weight: number } | null;
    top_3: number;
    largest_sector: { name: string; weight: number } | null;
    effective_holdings: number;
    volatility: number | null;
    benchmark_volatility: number | null;
    max_drawdown: number | null;
    beta: number | null;
    sharpe: number | null;
    dividend_yield: number;
    average_correlation: number | null;
    var_95: number | null;
    xirr: number | null;
  };
  observations: { category: string; title: string; detail: string }[];
}

export interface DividendReport {
  total: number;
  trailing_12m: number;
  forward_income: number;
  portfolio_yield: number;
  yield_on_cost: number;
  recorded: number;
  by_year: { year: string; amount: number }[];
  by_month: { month: string; amount: number }[];
  companies: {
    symbol: string;
    name: string;
    received: number;
    trailing_dps: number;
    forward_income: number;
    yield: number | null;
    yield_on_cost: number | null;
    held: boolean;
  }[];
  events: { symbol: string; name: string; ex_date: string; per_share: number; quantity: number; amount: number }[];
}

export interface CompareItem {
  id: string;
  name: string;
  kind: PortfolioKind;
  value: number;
  invested: number;
  unrealized_pct: number;
  xirr: number | null;
  holdings_count: number;
  since: string | null;
  cagr: number | null;
  total_return: number | null;
  volatility: number | null;
  max_drawdown: number | null;
  sharpe: number | null;
  beta: number | null;
  days?: number;
  window_return?: number | null;
  sectors: Record<string, number>;
}

export interface Compare {
  portfolios: CompareItem[];
  chart: { dates: string[]; series: { id: string; name: string; values: number[] }[]; since?: string };
  sectors: string[];
}

export interface Transaction {
  id: string;
  portfolio_id: string;
  portfolio_name: string | null;
  symbol: string;
  name: string;
  transaction_type: TxType;
  quantity: number;
  price: number;
  fees: number;
  amount: number;
  transaction_date: string;
  notes: string;
  source: "manual" | "import" | "paper" | "sample";
  split_factor: number;
  created_at: string;
}

export interface TransactionList {
  transactions: Transaction[];
  totals: { bought: number; sold: number; fees: number; realized_pnl: number; dividends: number };
}

export interface TransactionInput {
  symbol: string;
  transaction_type: TxType;
  quantity: number;
  price: number;
  fees: number;
  transaction_date: string;
  notes: string;
}

export interface Instrument {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  asset_class: string;
  price?: number | null;
  change_pct?: number | null;
}

export interface Quote {
  symbol: string;
  name?: string;
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  avg_volume: number;
  high_52w: number;
  low_52w: number;
  as_of: string;
}

export interface MarketStatus {
  is_open: boolean;
  label: "Open" | "Closed" | "Pre-open";
  detail: string;
  time_ist: string;
}

export interface MarketStock {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  traded_value: number;
  relative_volume: number | null;
  high_52w: number;
  low_52w: number;
}

export interface MarketIndex {
  symbol: string;
  name: string;
  short: string;
  price: number;
  change: number;
  change_pct: number;
  high_52w: number;
  low_52w: number;
  returns: Record<"1W" | "1M" | "3M" | "YTD" | "1Y", number | null>;
  spark: number[];
  headline: boolean;
  sector: boolean;
}

export interface MarketOverview {
  status: MarketStatus;
  as_of: string | null;
  indices: MarketIndex[];
  breadth: {
    advances: number;
    declines: number;
    unchanged: number;
    total: number;
    above_50dma: number;
    above_200dma: number;
    new_highs: number;
    new_lows: number;
  };
  gainers: MarketStock[];
  losers: MarketStock[];
  most_active: MarketStock[];
  volume_shockers: MarketStock[];
  new_highs: MarketStock[];
  new_lows: MarketStock[];
  sectors: { name: string; change_pct: number; count: number; advances: number; declines: number; traded_value: number }[];
  turnover: { today: number; average: number; ratio: number | null };
  heatmap: { symbol: string; name: string; sector: string; change_pct: number; size: number }[];
}

export interface UniverseStock extends Instrument {
  price: number;
  change_pct: number;
  volume: number;
  high_52w: number;
  low_52w: number;
  market_cap: number | null;
  pe: number | null;
  pb: number | null;
  dividend_yield: number | null;
}

export interface StockDetail extends Instrument {
  is_index: boolean;
  quote: Quote;
  about: { summary: string | null; website: string | null; employees: number | null; city: string | null; exchange: string | null };
  fundamentals: {
    market_cap: number | null;
    pe: number | null;
    forward_pe: number | null;
    pb: number | null;
    eps: number | null;
    book_value: number | null;
    roe: number | null;
    roa: number | null;
    debt_to_equity: number | null;
    profit_margin: number | null;
    operating_margin: number | null;
    revenue_growth: number | null;
    earnings_growth: number | null;
    dividend_yield: number | null;
    dividend_per_share: number;
  };
  technicals: {
    sma_50: number | null;
    sma_200: number | null;
    volatility: number | null;
    beta: number | null;
    from_high: number | null;
    from_low: number | null;
  };
  returns: Record<string, number | null>;
  position: {
    quantity: number;
    avg_cost: number;
    invested: number;
    value: number;
    pnl: number;
    pnl_pct: number;
    holding_days: number;
  } | null;
}

export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface PriceHistory {
  symbol: string;
  range: string;
  intraday: boolean;
  candles: Candle[];
}

export interface Statement {
  periods: string[];
  rows: { key: string; label: string; values: (number | null)[] }[];
}

export interface Financials {
  income: { annual: Statement; quarterly: Statement };
  balance: { annual: Statement; quarterly: Statement };
  cashflow: { annual: Statement; quarterly: Statement };
  ratios: { roe?: number | null; roce?: number | null; debt_to_equity?: number | null };
}

export interface StockEvents {
  dividends: { date: string; amount: number }[];
  dividends_by_year: { year: string; amount: number }[];
  splits: { date: string; ratio: number }[];
  upcoming: { earnings_dates?: string[]; ex_dividend_date?: string | null };
}

export interface WatchlistStock {
  id: string;
  watchlist_id: string;
  symbol: string;
  note: string;
  name: string;
  sector: string;
  priced: boolean;
  price?: number;
  change?: number;
  change_pct?: number;
  volume?: number;
  relative_volume?: number | null;
  high_52w?: number;
  low_52w?: number;
  range_position?: number | null;
  dividend_yield?: number | null;
  spark?: number[];
  market_cap: number | null;
  pe: number | null;
  pb: number | null;
}

export interface Watchlist {
  id: string;
  name: string;
  created_at: string;
  stocks: WatchlistStock[];
}

export type AlertType = "price_above" | "price_below" | "pct_change" | "earnings" | "dividend";

export interface Alert {
  id: string;
  symbol: string;
  name: string;
  alert_type: AlertType;
  threshold: number;
  note: string;
  is_active: boolean;
  triggered_at: string | null;
  last_value: number | null;
  price: number | null;
  change_pct: number | null;
  current_value: number | null;
  message: string;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  portfolio_id: string | null;
  symbol: string;
  name: string;
  action: "BUY" | "SELL" | "HOLD" | "WATCH";
  entry_price: number | null;
  entry_date: string;
  horizon: string;
  thesis: string;
  reasons: string[];
  exit_conditions: string;
  conviction: number;
  tags: string[];
  status: "open" | "closed";
  outcome_notes: string;
  closed_at: string | null;
  current_price: number | null;
  reference_price?: number;
  end_price?: number;
  days: number;
  return_pct: number | null;
  benchmark_return_pct: number | null;
  benchmark_name: string;
  held: boolean;
  created_at: string;
}

export type JournalInput = Pick<
  JournalEntry,
  | "symbol" | "portfolio_id" | "action" | "entry_price" | "entry_date" | "horizon" | "thesis" | "reasons"
  | "exit_conditions" | "conviction" | "tags" | "status" | "outcome_notes" | "closed_at"
>;

export interface JournalReview {
  dates: string[];
  price: (number | null)[];
  stock: (number | null)[];
  benchmark: (number | null)[];
  benchmark_name?: string;
  reference_price?: number;
  entry_date: string;
  closed_at?: string | null;
}

export interface CalendarEvent {
  symbol: string;
  name: string;
  date: string;
  type: "dividend" | "split" | "results";
  title: string;
  detail: string;
  amount: number | null;
  source: "portfolio" | "watchlist";
  upcoming: boolean;
}

export interface Calendar {
  today: string;
  symbols: number;
  events: CalendarEvent[];
}

export interface ProjectionScenario {
  label: string;
  initial: number;
  monthly: number;
  years: number;
  annual_return: number;
  step_up?: number;
}

export interface ProjectionResult extends ProjectionScenario {
  points: { year: number; invested: number; value: number }[];
  final_value: number;
  total_invested: number;
  gain: number;
  multiple: number | null;
}

/** Unlike the rest of the API, `change_pct`, `shock` and the two weights here are fractions (-0.2 = down 20%). */
export interface ShockResult {
  title: string;
  note: string;
  before: number;
  after: number;
  change: number;
  change_pct: number;
  holdings: {
    symbol: string;
    name: string;
    sector: string;
    value: number;
    shock: number;
    new_value: number;
    change: number;
    weight_before: number;
    weight_after: number;
  }[];
  betas: Record<string, number>;
  sectors: string[];
}

export type Percentiles = Record<"p5" | "p25" | "p50" | "p75" | "p95", number>;

export interface MonteCarloResult {
  months: number[];
  bands: Record<keyof Percentiles, number[]>;
  invested: number[];
  terminal: Percentiles;
  mean: number;
  total_invested: number;
  probability_of_loss: number;
  probability_of_target: number | null;
  median_multiple: number | null;
  histogram: { edges: number[]; counts: number[] };
  sample_paths: number[][];
  paths: number;
  assumptions: {
    initial: number;
    monthly: number;
    years: number;
    expected_return: number;
    volatility: number;
    method: "parametric" | "bootstrap";
    target: number | null;
  };
}

export interface Assumptions {
  value: number;
  expected_return: number | null;
  volatility: number | null;
  months_of_history: number;
}

export type OperandType =
  | "PRICE" | "SMA" | "EMA" | "RSI" | "MACD" | "MACD_SIGNAL" | "BB_UPPER" | "BB_LOWER" | "HIGH" | "LOW"
  | "VOLUME" | "VOLUME_SMA" | "VALUE";
export type Comparator = "crosses_above" | "crosses_below" | "greater_than" | "less_than";

export interface Operand {
  type: OperandType;
  period?: number;
  value?: number;
  mult?: number;
}

export interface Rule {
  left: Operand;
  cmp: Comparator;
  right: Operand;
}

export interface RuleGroup {
  op: "AND" | "OR";
  rules: Rule[];
}

export interface StrategyConfig {
  entry: RuleGroup;
  exit: RuleGroup;
  stop_loss_pct?: number | null;
  take_profit_pct?: number | null;
  trailing_stop_pct?: number | null;
  position_pct?: number;
  fee_pct?: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  config: StrategyConfig;
  created_at: string;
}

export interface BacktestMeta {
  operands: Record<OperandType, string>;
  comparators: Comparator[];
  presets: { key: string; name: string; description: string; config: StrategyConfig }[];
}

export interface BacktestTrade {
  entry_date: string;
  entry_price: number;
  exit_date: string;
  exit_price: number;
  quantity: number;
  pnl: number;
  /** A fraction (0.12 = +12%), like the other backtest statistics. */
  return_pct: number;
  holding_days: number;
  exit_reason: string;
}

export interface BacktestStats {
  initial_capital: number;
  final_value: number;
  total_return: number;
  cagr: number | null;
  max_drawdown: number;
  volatility: number | null;
  sharpe: number | null;
  total_trades: number;
  win_rate: number | null;
  profit_factor: number | null;
  avg_win: number | null;
  avg_loss: number | null;
  best_trade: number | null;
  worst_trade: number | null;
  avg_holding_days: number | null;
  exposure: number;
  buy_hold_final: number;
  buy_hold_return: number;
  buy_hold_cagr: number | null;
  buy_hold_max_drawdown: number;
}

export interface BacktestResult {
  symbol: string;
  name: string;
  period: { start: string; end: string };
  stats: BacktestStats;
  equity: { dates: string[]; strategy: number[]; buy_hold: number[]; drawdown: number[] };
  trades: BacktestTrade[];
  price: {
    dates: string[];
    /** [open, close, low, high] per bar */
    ohlc: [number, number, number, number][];
    close: number[];
    overlays: { name: string; values: (number | null)[] }[];
  };
  result_id?: string;
}

export interface SavedBacktest {
  id: string;
  strategy_id: string | null;
  strategy_name: string;
  symbol: string;
  start_date: string;
  end_date: string;
  initial_capital: number;
  final_value: number;
  cagr: number | null;
  max_drawdown: number | null;
  total_trades: number;
  stats: Partial<BacktestStats>;
  created_at: string;
}

export interface Share {
  id: string;
  portfolio_id: string;
  show_values: boolean;
}

export interface SharedPortfolio {
  name: string;
  description: string;
  kind: PortfolioKind;
  color: string | null;
  benchmark: string;
  show_values: boolean;
  summary: {
    unrealized_pct: number;
    day_pct: number;
    xirr: number | null;
    cagr: number | null;
    total_return: number | null;
    volatility: number | null;
    max_drawdown: number | null;
    holdings_count: number;
    since: string | null;
    as_of: string | null;
    value?: number;
    invested?: number;
    unrealized_pnl?: number;
    day_pnl?: number;
  };
  holdings: (Pick<Holding, "symbol" | "name" | "sector" | "asset_class" | "weight" | "pnl_pct" | "day_change_pct" | "price"> &
    Partial<Pick<Holding, "quantity" | "avg_cost" | "value" | "invested" | "pnl">>)[];
  allocation: {
    asset_classes: { name: string; weight: number }[];
    sectors: { name: string; weight: number }[];
    concentration: Concentration;
  };
  performance: { dates: string[]; portfolio_return: number[]; benchmark_return: number[] };
}

export interface Me {
  user_id: string;
  mode: "demo" | "supabase";
  email: string | null;
  portfolios: number;
  /** True while the workspace still holds untouched sample portfolios. */
  has_sample_data: boolean;
  /** True when the server has an AI key, so the stock assistant can answer free-form questions. */
  assistant: boolean;
  /** The service asked first. "compatible" is Groq or another OpenAI-compatible service. */
  assistant_provider: "gemini" | "anthropic" | "compatible" | null;
  risk_free_rate: number;
  market: MarketStatus;
}

export interface SampleRemoval {
  portfolios: number;
  transactions: number;
  watchlists: number;
  journal_entries: number;
  alerts: number;
  strategies: number;
  /** Sample portfolios left in place because the user added their own trades to them. */
  kept_portfolios: string[];
}

export interface AssistantOpening {
  symbol: string;
  name: string;
  /** False when no AI key is configured: only the suggested questions can be answered, from data. */
  ai: boolean;
  web_search: boolean;
  greeting: string;
  suggestions: { id: string; label: string }[];
}

/** What the market chat opens with. */
export type MarketOpening = Pick<AssistantOpening, "ai" | "web_search" | "greeting" | "suggestions">;

export interface AssistantSource {
  title: string;
  url: string;
  /** Shown instead of the link's host when the link is a redirect. */
  label?: string;
}

export type AssistantEvent =
  | { type: "meta"; mode: "ai" | "data" }
  | { type: "status"; text: string }
  | { type: "delta"; text: string }
  | { type: "sources"; items: AssistantSource[] }
  /** Google's search-suggestion chips, as HTML, which its terms ask to be shown with a grounded answer. */
  | { type: "search_suggestions"; html: string }
  /** Market chat: the app's own figures for what was asked, shown beside the words. */
  | { type: "cards"; items: MarketCard[] }
  /** Something the reader should know about how the answer was produced. */
  | { type: "notice"; text: string }
  | { type: "done"; truncated: boolean }
  | { type: "error"; message: string };

export type TradeSide = "BUY" | "SELL";

export interface TradeInput {
  symbol: string;
  side: TradeSide;
  quantity: number;
  /** The portfolio the trade would go into. */
  portfolio_id: string | null;
}

/** Where one check lands on the trade: for it, against it, neither, a note that isn't scored, or no data. */
export type CheckVerdict = "for" | "against" | "neutral" | "info" | "unknown";

export interface TradeCheckItem {
  id: string;
  title: string;
  /** What the check is, for someone meeting it for the first time. */
  learn: string;
  verdict: CheckVerdict;
  /** The figure the verdict rests on, in a few words. */
  reading: string;
  /** What the check found, as a sentence. */
  detail: string;
  /** How much it counts toward the score; zero for notes. */
  weight: number;
}

export interface TradeCheckGroup {
  id: string;
  title: string;
  question: string;
  checks: TradeCheckItem[];
  for: number;
  against: number;
}

export interface TradePositionSide {
  quantity: number;
  value: number;
  weight: number;
  avg_cost: number | null;
}

export interface TradeCheck {
  symbol: string;
  name: string;
  sector: string;
  asset_class: string;
  side: TradeSide;
  quantity: number;
  price: number;
  value: number;
  as_of: string;
  today: string;
  market: MarketStatus["label"];
  portfolio: { id: string; name: string; kind: PortfolioKind };
  score: {
    /** 0 to 100; 50 is an even split. Null when too few checks had data. */
    value: number | null;
    label: string;
    tone: "for" | "mixed" | "against" | "unknown";
    scored: number;
    for: number;
    against: number;
    neutral: number;
    unknown: number;
  };
  groups: TradeCheckGroup[];
  position: {
    before: TradePositionSide;
    after: TradePositionSide;
    sector: { name: string; before: number; after: number };
    portfolio_value: { before: number; after: number };
    /** Sells only: the gain or loss the sale makes real. */
    realised: { amount: number; pct: number } | null;
  };
  /** How one-year holding periods have turned out historically. Fractions; amounts are for this order. */
  outcomes: {
    years: number;
    periods: number;
    positive: number;
    median: number;
    poor: number;
    good: number;
    poor_amount: number;
    median_amount: number;
    good_amount: number;
  } | null;
  news: { title: string; source: string; published: string; url: string }[];
  blind_spots: string[];
  /** The result in words, written from the checks without a language model. */
  summary: string;
  /** True when the server has an AI key to explain the result with. */
  ai: boolean;
}

/** Short term reads how prices are behaving; long term adds the business and what it costs. */
export type Horizon = "short" | "long";
export type ScoreTone = "for" | "mixed" | "against" | "unknown";

/** A confidence score in brief: 0 to 100 with 50 an even split, or null when too little data. */
export interface ScoreBrief {
  value: number | null;
  tone: ScoreTone;
  label: string;
}

export interface Score extends ScoreBrief {
  scored: number;
  for: number;
  against: number;
  neutral: number;
  unknown: number;
}

/** One company as the market chat and the scoreboard show it. */
export interface ScoredCompany {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change_pct: number;
  /** One-month change in percent. */
  month: number | null;
  score: number | null;
  tone: ScoreTone;
  label: string;
  /** The heaviest checks that fell each way. */
  for: { title: string; reading: string }[];
  against: { title: string; reading: string }[];
  /** With a sum of money: the shares all of it buys, and the shares an equal split buys. */
  shares?: number;
  split_shares?: number;
}

export interface PulseSector {
  name: string;
  count: number;
  change_pct: number | null;
  advances: number;
  declines: number;
  returns: Record<"1 week" | "1 month" | "3 months" | "1 year", number | null>;
  score: Record<Horizon, Score>;
  checks: Record<Horizon, TradeCheckItem[]>;
  leaders: Record<Horizon, ScoredCompany[]>;
}

/** Confidence scores for the market and every sector. */
export interface MarketPulse {
  as_of: string | null;
  benchmark: string;
  status: MarketStatus;
  mood: { score: Score; checks: TradeCheckItem[] };
  sectors: PulseSector[];
}

/** What the market chat shows beside an answer. The figures are always the app's own. */
export type MarketCard =
  | {
      kind: "mood";
      as_of: string | null;
      score: Score;
      checks: TradeCheckItem[];
      index: { name: string; price: number; change_pct: number } | null;
      breadth: { advances: number; declines: number; total: number };
    }
  | { kind: "sectors"; horizon: Horizon; rows: { name: string; count: number; change_pct: number | null; month: number | null; short: ScoreBrief; long: ScoreBrief }[] }
  | {
      kind: "sector";
      name: string;
      count: number;
      horizon: Horizon;
      change_pct: number | null;
      returns: PulseSector["returns"];
      score: Record<Horizon, ScoreBrief>;
      checks: TradeCheckItem[];
      companies: ScoredCompany[];
    }
  | {
      kind: "ideas";
      amount: number;
      horizon: Horizon;
      sector: string | null;
      /** True when the user named the sector; false when it is the highest-scoring one. */
      asked: boolean;
      sectors: { name: string; score: number | null; tone: ScoreTone }[];
      sector_score: { score: number | null; tone: ScoreTone; label: string } | null;
      /** The sum split equally across the companies listed. */
      each: number;
      companies: ScoredCompany[];
      /** Companies left out because one share costs more than the whole sum. */
      too_dear: number;
      mood: ScoreBrief;
    }
  | { kind: "companies"; horizon: Horizon; sector: string | null; rows: ScoredCompany[] }
  | {
      kind: "company";
      symbol: string;
      name: string;
      sector: string;
      price: number;
      change_pct: number;
      horizon: Horizon;
      score: Record<Horizon, ScoreBrief>;
      groups: { title: string; checks: TradeCheckItem[] }[];
    }
  | { kind: "movers"; gainers: ScoredCompany[]; losers: ScoredCompany[] };
