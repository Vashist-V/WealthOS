/**
 * The reference guide: for every section, the question it answers, what it is,
 * how to use it and how to read its numbers. The same entries are shown by the
 * ? button on each page and, in this order, on the public docs page.
 * The hands-on lessons live in `lessons.ts`.
 */
import {
  Activity, ArrowLeftRight, Bell, CalendarDays, ClipboardCheck, Coins, Compass, Dices, FlaskConical, FolderKanban, GitCompareArrows, Globe,
  History, LayoutDashboard, Layers, LineChart, NotebookPen, PieChart, ScanSearch, Settings, Star, Wallet,
  type LucideIcon,
} from "lucide-react";

export interface GuideSection {
  id: string;
  /** The page this section describes. Null for the introduction. */
  path: string | null;
  /** Sidebar group, shown as a label on the card. */
  group: string;
  title: string;
  icon: LucideIcon;
  /** The question this section answers, in the user's words. */
  question: string;
  what: string;
  how: string[];
  /** Terms on the page worth a plain-language line. */
  terms?: { term: string; meaning: string }[];
}

export const GUIDE: GuideSection[] = [
  {
    id: "welcome",
    path: null,
    group: "Start here",
    title: "Welcome to WealthOS",
    icon: Compass,
    question: "What is this, and where do I begin?",
    what: "WealthOS turns the trades you record into a full picture of your investments: what you own, how it has done, how risky it is and what could happen next. It only tracks and analyses. It never places a trade.",
    how: [
      "The portfolio switcher at the top left chooses whose numbers you see on every page.",
      "Search, or press Ctrl K, finds any stock or page.",
      "Add transaction records a buy, sell or dividend. Everything else is calculated from those.",
      "The ? button explains whichever page you are on, any time.",
      "Take the tour, in the menu, opens short hands-on lessons that walk you through the real controls.",
    ],
  },
  {
    id: "dashboard",
    path: "/",
    group: "Portfolio",
    title: "Dashboard",
    icon: LayoutDashboard,
    question: "How are my investments doing right now?",
    what: "Your starting point. One screen with what the portfolio is worth, how much of that is profit, what changed today and where the money sits.",
    how: [
      "Switch the chart between Value and Return, and pick a period from 1M to ALL.",
      "Read the six figures beside the chart for cost, profit and yearly return.",
      "Scroll for allocation, the holdings that helped or hurt most, and today's biggest movers.",
      "Select any holding to open its stock page.",
    ],
    terms: [
      { term: "XIRR", meaning: "Your own yearly return, counting when each rupee went in or came out. The fairest answer to “how have I done?”" },
      { term: "CAGR", meaning: "The portfolio's yearly growth with the timing of deposits removed, so it can be compared with an index." },
      { term: "Unrealised and realised", meaning: "Profit on what you still hold, against profit already locked in by selling." },
    ],
  },
  {
    id: "holdings",
    path: "/holdings",
    group: "Portfolio",
    title: "Holdings",
    icon: Layers,
    question: "What exactly do I own?",
    what: "Every position you hold today at the latest price: quantity, average cost, value, profit or loss and its share of the portfolio.",
    how: [
      "Select a column heading to sort by it.",
      "Filter by name, or by asset class with the buttons above the table.",
      "Scroll to By sector for the same holdings grouped with subtotals.",
      "Export CSV takes the table to a spreadsheet.",
    ],
    terms: [
      { term: "Average cost", meaning: "What you paid per share across all your buys, fees included." },
      { term: "Weight", meaning: "The holding's share of the portfolio's total value." },
    ],
  },
  {
    id: "transactions",
    path: "/transactions",
    group: "Portfolio",
    title: "Transactions",
    icon: ArrowLeftRight,
    question: "What did I buy and sell, and when?",
    what: "The ledger. Every buy, sell and dividend you record lives here, and every other number in WealthOS is worked out from it.",
    how: [
      "Add transaction records one trade.",
      "Import CSV brings in many at once. Zerodha and Groww exports are recognised automatically.",
      "Use the ⋯ menu on a row to edit or delete it.",
      "Export CSV gives you a backup that can be imported again.",
    ],
    terms: [
      { term: "Split-adjusted", meaning: "A trade made before a split or bonus is restated so it matches today's share count. You enter it as it happened." },
      { term: "Fees", meaning: "Added to your cost on a buy and taken from the proceeds on a sell." },
    ],
  },
  {
    id: "portfolios",
    path: "/portfolios",
    group: "Portfolio",
    title: "Portfolios",
    icon: FolderKanban,
    question: "How do I keep different goals apart?",
    what: "Create and manage portfolios: long-term holdings, retirement, experiments, or a paper portfolio that trades with virtual money.",
    how: [
      "New portfolio creates one. Choose Investment for real holdings or Paper trading to practise.",
      "Open switches the whole app to that portfolio.",
      "The ⋯ menu edits, deletes or shares it.",
      "Share makes a read-only link. Rupee amounts stay hidden unless you switch them on.",
    ],
  },
  {
    id: "allocation",
    path: "/allocation",
    group: "Analytics",
    title: "Allocation",
    icon: PieChart,
    question: "Where is my money, and how concentrated is it?",
    what: "How the portfolio is split across asset types, sectors, industries and single holdings. It describes the mix; it does not judge it.",
    how: [
      "Start with asset allocation: equity, funds, gold and cash.",
      "The concentration card shows how much sits in your largest few positions.",
      "Sort the sector table by weight or by profit.",
      "Select a bar in Holding weights to open that stock.",
    ],
    terms: [
      { term: "Top 3 holdings", meaning: "The share of the portfolio held in your three largest positions." },
      { term: "Effective holdings", meaning: "How many equal-sized positions would be as concentrated as yours. Fewer means more depends on a few names." },
    ],
  },
  {
    id: "risk",
    path: "/risk",
    group: "Analytics",
    title: "Risk",
    icon: Activity,
    question: "How bumpy could this portfolio be?",
    what: "How much today's holdings have swung in the past, alone and against the market. It replays your current mix over the period you choose.",
    how: [
      "Choose a lookback period at the top right.",
      "Read the six tiles first. The ⓘ beside each explains it in a sentence.",
      "The correlation map shows which holdings tend to move together.",
      "The risk table shows which holdings add the most swing for their size.",
    ],
    terms: [
      { term: "Volatility", meaning: "How widely returns swing over a year. Higher means a rougher ride." },
      { term: "Beta", meaning: "How far it tends to move when the market moves 1%." },
      { term: "Maximum drawdown", meaning: "The worst fall from a peak to the low that followed." },
      { term: "Value at Risk", meaning: "A one-day loss you would expect to exceed only about one day in twenty." },
    ],
  },
  {
    id: "xray",
    path: "/xray",
    group: "Analytics",
    title: "X-Ray",
    icon: ScanSearch,
    question: "What is this portfolio, on one page?",
    what: "A single-page report on the portfolio's structure and character, with observations written in plain language.",
    how: [
      "The panel at the top holds the headline facts: size, concentration, risk and income.",
      "Observations state what the numbers show. They are facts, not recommendations.",
      "Print / save as PDF keeps a copy.",
    ],
  },
  {
    id: "dividends",
    path: "/dividends",
    group: "Analytics",
    title: "Dividends",
    icon: Coins,
    question: "How much income do my holdings pay?",
    what: "Dividend income by year, month and company, estimated from the shares you held on each ex-dividend date.",
    how: [
      "The tiles show income so far, the past 12 months and a yearly rate at current payouts.",
      "The charts show when income arrives through the year.",
      "By company ranks who pays you the most.",
    ],
    terms: [
      { term: "Ex-dividend date", meaning: "You must own the share before this day to receive that dividend." },
      { term: "Yield on cost", meaning: "A year of dividends as a percentage of what you paid, not of today's price." },
    ],
  },
  {
    id: "compare",
    path: "/compare",
    group: "Analytics",
    title: "Compare",
    icon: GitCompareArrows,
    question: "Which of my portfolios did better, and at what risk?",
    what: "Your portfolios side by side over the same stretch of time: growth, return, risk and where each is invested.",
    how: [
      "Choose which portfolios to include with the chips at the top.",
      "The chart starts every portfolio at zero on the same day, so the lines compare fairly.",
      "The table lines up the same measures for each. Hover a row's ⓘ to see what it means.",
    ],
  },
  {
    id: "market",
    path: "/market",
    group: "Markets",
    title: "Market",
    icon: Globe,
    question: "What is the market doing today?",
    what: "The day at a glance, and an assistant to ask about it. Indices, how many stocks rose or fell, which sectors moved, the biggest movers, and a confidence score for the market and every sector.",
    how: [
      "Ask about the market answers in plain words: what happened and why, which sectors look strong, whether it is a good time for one, or where a sum of money could go.",
      "Confidence scores shows the market mood and a short and long-term score for each sector. Select a sector to ask about it.",
      "Index cards carry the headline levels; Movers switches between gainers, losers, most active and more.",
      "On the market map, a bigger tile is a bigger company and the colour is today's move.",
      "Filter All tracked stocks to find a company, then select it.",
    ],
    terms: [
      { term: "Market mood", meaning: "A score out of 100 for how the whole market is behaving: the index against its averages, how many stocks are taking part, and how nervous it is. It reads the present; it does not predict." },
      { term: "Short-term and long-term score", meaning: "Short term looks only at how prices are behaving now. Long term adds the businesses: growth, profit and what they cost." },
      { term: "Breadth", meaning: "How many stocks rose against how many fell. It shows whether a move is broad or carried by a few." },
      { term: "Relative volume", meaning: "Today's trading compared with the usual amount. 2× means twice as busy." },
    ],
  },
  {
    id: "stock",
    path: "/stock/RELIANCE",
    group: "Markets",
    title: "Stock pages",
    icon: LineChart,
    question: "What do I need to know about this company?",
    what: "Everything on one stock: price chart, key ratios, financial statements, dividends and your own position in it. Reach one from search or by selecting a stock anywhere.",
    how: [
      "Change the chart period. The headline change follows the period you pick.",
      "Ask AI opens an assistant that knows this stock, the news and your position in it.",
      "Add to watchlist, Set alert and Add transaction are at the top right.",
      "Scroll for statements, corporate actions and a description of the business.",
    ],
    terms: [
      { term: "P/E", meaning: "The price divided by a year of earnings per share. It shows how much investors pay for each rupee of profit." },
      { term: "ROE", meaning: "Profit earned on shareholders' money in a year." },
      { term: "Debt / equity", meaning: "Borrowings compared with shareholders' funds." },
    ],
  },
  {
    id: "watchlists",
    path: "/watchlists",
    group: "Markets",
    title: "Watchlists",
    icon: Star,
    question: "What am I keeping an eye on?",
    what: "Lists of stocks you follow but may not own, with live prices and valuation side by side. Nothing here affects your portfolios.",
    how: [
      "New watchlist starts a list. Switch between lists with the tabs.",
      "Add a stock with the search box in the list's header.",
      "The bell on a row sets an alert for that stock; the ✕ removes it.",
    ],
  },
  {
    id: "calendar",
    path: "/calendar",
    group: "Markets",
    title: "Calendar",
    icon: CalendarDays,
    question: "What is coming up for my stocks?",
    what: "Results dates, dividends, splits and bonuses for everything you hold or watch, on a month grid and as a list.",
    how: [
      "Select a day on the grid to see its events underneath.",
      "The agenda on the right lists what is coming, soonest first.",
      "Filter by event type, or by holdings against watchlist.",
    ],
  },
  {
    id: "alerts",
    path: "/alerts",
    group: "Markets",
    title: "Alerts",
    icon: Bell,
    question: "How do I get told when something happens?",
    what: "Rules that watch a stock for you: a price level, a large one-day move, or results and ex-dividend dates approaching.",
    how: [
      "New alert picks a stock, the kind of alert and its level.",
      "Alerts are checked about once a minute while WealthOS is open, and each one fires once.",
      "A fired alert shows in the bell at the top. Switch it back on to watch again.",
    ],
  },
  {
    id: "trade-check",
    path: "/lab/trade-check",
    group: "Lab",
    title: "Trade check",
    icon: ClipboardCheck,
    question: "Should I make this trade?",
    what: "Runs a buy or a sell through every check before you make it: the trend, the valuation, the business, the risk, what it does to your portfolio and what is coming up. It scores how the evidence stacks up and explains it in plain words. The decision stays yours.",
    how: [
      "Say what you are thinking of doing: buying or selling, how many shares, which company, in which portfolio.",
      "Run the check, then read the score and the explanation beside it.",
      "Go through the checks below. A tick supports the trade, a cross goes against it, and the ⓘ says what each one measures.",
      "If you go ahead with your broker, record the trade from the card under the score.",
    ],
    terms: [
      { term: "Confidence score", meaning: "From 0 to 100, how strongly the checks line up behind the trade. 50 is an even split. It sums up evidence; it does not predict the price." },
      { term: "A poor year", meaning: "Of every one-year stretch in the stock's history, only 1 in 20 ended worse than this." },
      { term: "Correlation", meaning: "How closely the stock's daily moves follow the rest of your portfolio. Near 1 is more of the same; near 0 spreads your risk." },
    ],
  },
  {
    id: "what-if",
    path: "/lab/what-if",
    group: "Lab",
    title: "What-if",
    icon: FlaskConical,
    question: "What would happen if…?",
    what: "Two calculators. Growth plans shows how a starting amount plus a monthly investment could grow. Shocks shows what a sudden market move would do to today's holdings. Neither changes your real portfolio.",
    how: [
      "In Growth plans, edit the amounts, years and yearly return. Results update as you type.",
      "Add plan compares up to four side by side.",
      "Switch to Shocks and pick a scenario, such as the market falling 20%.",
    ],
    terms: [{ term: "Scale by beta", meaning: "Stocks that usually swing more than the market are moved further than the market in the scenario." }],
  },
  {
    id: "monte-carlo",
    path: "/lab/monte-carlo",
    group: "Lab",
    title: "Monte Carlo",
    icon: Dices,
    question: "What range of outcomes should I expect?",
    what: "Thousands of simulated futures for the portfolio, summarised as a range from poor to good. It shows how wide the possibilities are. It is not a forecast.",
    how: [
      "Set the starting value, monthly investment and number of years.",
      "Expected return and volatility start from your holdings' own history. Change them to test other assumptions.",
      "Run simulation, then read the five percentile tiles and the fan chart.",
    ],
    terms: [
      { term: "5th percentile", meaning: "A poor outcome: 19 in 20 simulated futures ended higher than this." },
      { term: "Median", meaning: "The middle outcome. Half ended above it and half below." },
    ],
  },
  {
    id: "backtest",
    path: "/lab/backtest",
    group: "Lab",
    title: "Backtest",
    icon: History,
    question: "Would this trading rule have worked?",
    what: "Write a buy rule and a sell rule, then replay them over a stock's past prices to see what would have happened.",
    how: [
      "Start from a preset, or build rules with the dropdowns. The sentence underneath reads your strategy back to you.",
      "Pick a stock, a start date and starting capital, then Run backtest.",
      "Compare the result with simply buying and holding, shown on every tile.",
      "Save strategy keeps it for next time.",
    ],
    terms: [
      { term: "DMA / SMA", meaning: "The average closing price over the last N days. “20 DMA crosses above 50 DMA” means recent prices have overtaken the longer trend." },
      { term: "Win rate", meaning: "The share of trades that made money. A low win rate can still profit if the wins are large." },
    ],
  },
  {
    id: "paper",
    path: "/lab/paper",
    group: "Lab",
    title: "Paper trading",
    icon: Wallet,
    question: "Can I practise without real money?",
    what: "A virtual account. You get pretend capital, place buy and sell orders at live prices, and watch how the account does. No real order is ever sent.",
    how: [
      "Pick a stock in the order ticket to see its live price.",
      "Enter a quantity, or use the 25 / 50 / 100% buttons, then place the order.",
      "Positions and order history update straight away. Sell from a position's row.",
    ],
  },
  {
    id: "journal",
    path: "/journal",
    group: "Record",
    title: "Journal",
    icon: NotebookPen,
    question: "Why did I make this decision, and was I right?",
    what: "A record of the reasoning behind each decision: your thesis, your reasons and what would make you sell. Later you can hold it against what actually happened.",
    how: [
      "New entry writes down the stock, your thesis, reasons and exit conditions.",
      "Each card shows how the stock has done since, beside the index over the same days.",
      "Open an entry for Thesis vs. reality, then add a review or close it.",
    ],
  },
  {
    id: "settings",
    path: "/settings",
    group: "Account",
    title: "Settings",
    icon: Settings,
    question: "How do I change how WealthOS works for me?",
    what: "Your account, the theme, alert notifications, sample data and what this install is connected to.",
    how: [
      "Switch between dark and light under Preferences.",
      "Load or remove the sample data under your account.",
      "Open the hands-on lessons again from Preferences whenever you like.",
    ],
  },
];

/** The guide entry for a route, or null when the page has none. */
export function guideFor(pathname: string): GuideSection | null {
  if (pathname.startsWith("/stock/")) return GUIDE.find((s) => s.id === "stock") ?? null;
  return GUIDE.find((s) => s.path === pathname) ?? null;
}
