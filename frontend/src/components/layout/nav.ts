import {
  Activity, ArrowLeftRight, Bell, CalendarDays, ClipboardCheck, Coins, Dices, FlaskConical, FolderKanban, GitCompareArrows, Globe,
  History, LayoutDashboard, Layers, NotebookPen, PieChart, ScanSearch, Settings, Star, Wallet, type LucideIcon,
} from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra words the command palette should match. */
  keywords?: string;
}

export const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Portfolio",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "home overview summary" },
      { to: "/holdings", label: "Holdings", icon: Layers, keywords: "positions stocks" },
      { to: "/transactions", label: "Transactions", icon: ArrowLeftRight, keywords: "ledger buy sell import csv" },
      { to: "/portfolios", label: "Portfolios", icon: FolderKanban, keywords: "manage create share" },
    ],
  },
  {
    title: "Analytics",
    items: [
      { to: "/allocation", label: "Allocation", icon: PieChart, keywords: "sector asset concentration" },
      { to: "/risk", label: "Risk", icon: Activity, keywords: "volatility beta sharpe var drawdown correlation" },
      { to: "/xray", label: "X-Ray", icon: ScanSearch, keywords: "structure summary observations" },
      { to: "/dividends", label: "Dividends", icon: Coins, keywords: "income yield" },
      { to: "/compare", label: "Compare", icon: GitCompareArrows, keywords: "portfolios side by side" },
    ],
  },
  {
    title: "Markets",
    items: [
      { to: "/market", label: "Market", icon: Globe, keywords: "indices gainers losers breadth sectors" },
      { to: "/watchlists", label: "Watchlists", icon: Star, keywords: "watch track" },
      { to: "/calendar", label: "Calendar", icon: CalendarDays, keywords: "corporate actions results dividends events" },
      { to: "/alerts", label: "Alerts", icon: Bell, keywords: "price notifications" },
    ],
  },
  {
    title: "Lab",
    items: [
      { to: "/lab/trade-check", label: "Trade check", icon: ClipboardCheck, keywords: "should i buy sell analyse analyze confidence score risk test" },
      { to: "/lab/what-if", label: "What-if", icon: FlaskConical, keywords: "simulator scenario sip shock" },
      { to: "/lab/monte-carlo", label: "Monte Carlo", icon: Dices, keywords: "simulation percentile paths" },
      { to: "/lab/backtest", label: "Backtest", icon: History, keywords: "strategy rules dma crossover" },
      { to: "/lab/paper", label: "Paper trading", icon: Wallet, keywords: "virtual simulated orders" },
    ],
  },
  {
    title: "Record",
    items: [{ to: "/journal", label: "Journal", icon: NotebookPen, keywords: "thesis notes decisions" }],
  },
];

export const SETTINGS: NavItem = { to: "/settings", label: "Settings", icon: Settings, keywords: "account theme preferences" };

/** Checking a trade before making it is what the app is for, so it is promoted out of the Lab list: to the top of the menu, the top bar and the phone tab bar. */
export const TRADE_CHECK: NavItem = NAV[3].items[0];

/** The destinations on the phone tab bar, two each side of the add button. */
export const MOBILE_TABS: NavItem[] = [NAV[0].items[0], NAV[0].items[1], NAV[2].items[0], TRADE_CHECK];
