/**
 * The hands-on guide: short lessons that point at one control at a time, say
 * what it does and, where a step has a task, wait for the user to do it.
 *
 * `target` and the names inside `until` are `data-tour` attributes on the
 * controls themselves. A name that starts with "[" is used as a CSS selector
 * instead, for things the app does not render itself, such as an open menu.
 */
import { ArrowLeftRight, ClipboardCheck, Compass, LayoutDashboard, LineChart, Sparkles, Wallet, type LucideIcon } from "lucide-react";

/** What completes a step without the user pressing Next. */
export type Until =
  /** The target is selected. */
  | { click: true }
  /** The target has a value, or another named control has. */
  | { filled: true | string }
  /** A control comes on screen. */
  | { appears: string }
  /** A control that was on screen leaves it. */
  | { gone: string }
  /** The app arrives on a page. */
  | { path: RegExp };

export interface LessonStep {
  /** The page this step happens on. The lesson goes there unless the user is already on a page `stay` accepts. */
  path?: string;
  stay?: RegExp;
  /** The control to point at, or several to try in order: the first one on screen wins. Without one the card sits mid-screen. */
  target?: string | string[];
  title: string;
  body: string;
  /** What to do, as an instruction. With `until`, the step moves on by itself once it is done. */
  task?: string;
  until?: Until;
  /** Pass over the step when its control is not on the page, such as a card that only shows for stocks the user holds. */
  optional?: boolean;
}

export interface Lesson {
  id: string;
  title: string;
  /** One line for the list of lessons. */
  summary: string;
  icon: LucideIcon;
  minutes: number;
  /** Pages this lesson is about, so their ? guide can offer it. */
  pages?: RegExp;
  steps: LessonStep[];
}

/** Stands for the page of a stock the user holds, or a well-known one when they hold nothing. */
export const A_STOCK = "/stock/…";
const MENU = '[role="menu"]';

export const LESSONS: Lesson[] = [
  {
    id: "basics",
    title: "Find your way around",
    summary: "The menu, your portfolios, search and where to get help.",
    icon: Compass,
    minutes: 2,
    steps: [
      {
        path: "/",
        title: "A guide you do, not read",
        body: "I'll point at one control at a time, say what it is for, and ask you to try it. Stop whenever you like. Nothing here places a real trade: WealthOS only records and analyses what you tell it.",
      },
      {
        target: ["nav", "menu-button"],
        title: "Everything lives in the menu",
        body: "Sections are grouped by what you want to do. Portfolio is what you own. Analytics measures it. Markets is the world outside. Lab is where you test an idea before acting. Record is your journal.",
      },
      {
        target: "portfolio-switcher",
        title: "Whose numbers you are looking at",
        body: "Every page shows the portfolio named here. You can keep several: long-term savings, say, and a practice account.",
        task: "Select it to see your portfolios.",
        until: { appears: MENU },
      },
      {
        target: MENU,
        title: "Switching portfolios",
        body: "“All portfolios” adds your investment portfolios together. Paper trading accounts use virtual money and are kept apart.",
        task: "Pick one, or press Esc to keep the one you have.",
        until: { gone: MENU },
      },
      {
        target: "search",
        title: "Search finds anything",
        body: "Companies, pages and actions, all from one box. Ctrl K opens it from anywhere.",
        task: "Open search.",
        until: { appears: "search-input" },
      },
      {
        target: "search-input",
        title: "Look up a company",
        body: "Type part of its name. You don't need to know the ticker.",
        task: "Type hero and choose Hero MotoCorp, or any company you like.",
        until: { path: /^\/stock\// },
      },
      {
        target: "stock-price",
        title: "This is a stock page",
        body: "One company in one place: its price, its numbers, its news and, if you own it, your own position. The next lesson walks through it.",
      },
      {
        target: "page-guide",
        title: "Help on every page",
        body: "This ? explains whichever page you are on: what it is for, how to use it and what its numbers mean.",
      },
      {
        target: ["guide-button", "menu-button"],
        title: "More lessons, whenever you want",
        body: "The rest are here: reading a stock page, checking a trade before you make it, recording one, reading your portfolio and practising with virtual money.",
      },
    ],
  },
  {
    id: "stock",
    title: "Read a stock page",
    summary: "Price, key numbers, the assistant and alerts for one company.",
    icon: LineChart,
    minutes: 2,
    pages: /^\/stock\//,
    steps: [
      {
        path: A_STOCK,
        stay: /^\/stock\//,
        target: "stock-price",
        title: "Price and chart",
        body: "The large figure is the latest price. The line under it says how far the price has moved over the period the chart shows.",
      },
      {
        target: "stock-range",
        title: "Change the period",
        body: "One day's move says little. A year, or five, shows the trend.",
        task: "Select 1Y.",
        until: { click: true },
      },
      {
        target: "stock-position",
        optional: true,
        title: "Your position",
        body: "You hold this stock, so your own numbers come first: how many shares, what they cost you and what they are worth now.",
      },
      {
        target: "stock-stats",
        title: "Key statistics",
        body: "Each figure has an ⓘ beside it; rest the pointer on one for a one-line meaning. P/E, for instance, is how many rupees investors pay for each rupee of yearly profit.",
      },
      {
        target: "ask-ai",
        title: "Ask about this stock",
        body: "Opens an assistant with this stock's numbers, the news and your own position in front of it. It explains. It does not decide for you.",
      },
      {
        target: "set-alert",
        title: "Be told when it moves",
        body: "Set a price level or a results date and WealthOS tells you when it arrives, so you don't have to keep checking.",
      },
      {
        target: "check-trade",
        optional: true,
        title: "Thinking of buying or selling it?",
        body: "Trade check runs the idea through every test before you act on it.",
        task: "Select Check a trade.",
        until: { path: /^\/lab\/trade-check/ },
      },
    ],
  },
  {
    id: "trade-check",
    title: "Check a trade before you make it",
    summary: "Run a buy or a sell through every test and read the confidence score.",
    icon: ClipboardCheck,
    minutes: 3,
    pages: /^\/lab\/trade-check/,
    steps: [
      {
        path: "/lab/trade-check",
        target: "tc-form",
        title: "Say what you are thinking of doing",
        body: "Fill this in like a sentence: buying or selling, how many shares, which company, in which portfolio. Nothing is bought or sold here.",
      },
      {
        target: "tc-side",
        title: "Buying or selling",
        body: "The same checks are read the other way round for a sale. A strong company is a reason to buy, and a reason not to sell.",
      },
      {
        target: "tc-quantity",
        title: "How many shares",
        body: "Size matters: it decides how much of your portfolio ends up riding on this one stock.",
        task: "Enter a number, for example 30.",
        until: { filled: true },
      },
      {
        target: "tc-symbol",
        title: "Which company",
        body: "Type part of the name and pick it from the list.",
        task: "Choose a company. Try typing hero.",
        until: { appears: "tc-price" },
      },
      {
        target: "tc-portfolio",
        title: "Which portfolio",
        body: "The trade is measured against what this portfolio already holds, so the answer can differ from one portfolio to the next.",
      },
      {
        target: "tc-run",
        title: "Run it",
        body: "WealthOS now tests the trend, the valuation, the business, the risk, the fit with your portfolio and the timing.",
        task: "Select Run the check.",
        until: { appears: "tc-score" },
      },
      {
        target: "tc-score",
        title: "The confidence score",
        body: "From 0 to 100: how strongly the checks line up behind this trade. 50 is an even split. It sums up the evidence as it stands today. It does not predict the price, and it is not advice.",
      },
      {
        target: "tc-explain",
        title: "The result in plain words",
        body: "What supports the trade, what goes against it, what the numbers cannot see, and a few questions only you can answer.",
      },
      {
        target: "tc-checks",
        title: "Every check, with its evidence",
        body: "A green tick supports the trade, a red cross goes against it and a dash is neutral. The ⓘ beside each one says what it measures and why it matters.",
      },
      {
        target: "tc-outcomes",
        optional: true,
        title: "What a year of holding has looked like",
        body: "A poor year, a middle year and a good year from this stock's own history, in rupees for your order. It shows what you would have had to sit through.",
      },
      {
        target: "tc-actions",
        title: "Then the decision is yours",
        body: "WealthOS never places a trade. If you go ahead with your broker, record it here so your portfolio stays right. Or try it with virtual money first.",
      },
    ],
  },
  {
    id: "market",
    title: "Ask the market",
    summary: "Ask what happened, which sectors look strong and where a sum of money could go.",
    icon: Sparkles,
    minutes: 2,
    pages: /^\/market/,
    steps: [
      {
        path: "/market",
        target: "market-ask",
        title: "Ask in your own words",
        body: "Type a question as you would say it, or pick one of the ready-made ones: what happened today and why, which sectors look strong, where ₹50,000 could go.",
        task: "Select “What happened in the market today?”",
        until: { appears: "market-chat" },
      },
      {
        target: "market-chat",
        title: "Words first, then the evidence",
        body: "The answer comes in plain words with a card under it. The card's figures are worked out by the app from checks you can open; the AI only writes the explanation and reads the news for the why.",
      },
      {
        target: "market-chat",
        title: "A confidence score with every answer",
        body: "The market, each sector and each company is scored out of 100. 50 is an even split; higher means more of the checks are positive. Ask “is it a good time for IT stocks?” or “I have ₹50,000, where could it go?” to see them at work.",
        task: "Close the chat with the ✕ at its top when you have read the answer.",
        until: { gone: "market-chat" },
      },
      {
        target: "market-scores",
        title: "The scores at a glance",
        body: "The market mood on the left, and every sector with a short-term and a long-term score. Short term reads how prices are behaving now; long term adds the businesses. Select a sector to ask about it.",
      },
    ],
  },
  {
    id: "record",
    title: "Record a trade",
    summary: "Tell WealthOS what you bought or sold; everything else follows from it.",
    icon: ArrowLeftRight,
    minutes: 2,
    pages: /^\/transactions/,
    steps: [
      {
        path: "/",
        target: "add-transaction",
        title: "You trade with your broker, and record it here",
        body: "WealthOS never buys or sells. You tell it what you did, and your holdings, returns and risk are all worked out from those records.",
        task: "Select Add transaction.",
        until: { appears: "tx-form" },
      },
      {
        target: "tx-type",
        title: "What kind of record",
        body: "Buy and Sell are trades. Dividend records cash that a company paid you.",
      },
      {
        target: "tx-symbol",
        title: "Which stock",
        body: "Type part of the name and choose it. The latest price is filled in for you.",
        task: "Pick the stock.",
        until: { filled: "tx-price" },
      },
      {
        target: "tx-quantity",
        title: "How many shares",
        body: "Enter it as it happened. If the company later splits its shares, WealthOS restates the trade for you.",
        task: "Enter the quantity.",
        until: { filled: true },
      },
      {
        target: "tx-price",
        title: "The price you paid",
        body: "It starts at the latest price. Change it to what you actually paid for each share. The date and your broker's fees go in the fields below.",
      },
      {
        target: "tx-total",
        title: "What it cost in all",
        body: "Quantity times price, plus fees on a buy. Your profit or loss is measured against this.",
      },
      {
        target: "tx-save",
        title: "Save it, or don't",
        body: "Add transaction saves it to your ledger. If this was only practice, press Cancel and nothing is saved. A saved record can be edited or deleted later.",
        task: "Save it, or cancel.",
        until: { gone: "tx-form" },
      },
      {
        path: "/transactions",
        target: "transactions-table",
        title: "Your ledger",
        body: "Every record lands here. The ⋯ menu on a row edits or deletes it, and Import CSV brings in many at once from a Zerodha or Groww export.",
      },
    ],
  },
  {
    id: "portfolio",
    title: "Read your portfolio",
    summary: "What it is worth, how it has done, how bumpy it is and where the money sits.",
    icon: LayoutDashboard,
    minutes: 2,
    pages: /^\/(holdings|risk|allocation)?$/,
    steps: [
      {
        path: "/",
        target: "dash-value",
        title: "What it is worth right now",
        body: "The large figure is today's value of everything in this portfolio. Under it is how much that changed today.",
      },
      {
        target: "dash-view",
        title: "Value, or return",
        body: "Value is in rupees, and rises whenever you add money. Return takes your deposits out, so it shows how the investments themselves did.",
        task: "Switch the chart to Return.",
        until: { click: true },
      },
      {
        target: "dash-metrics",
        title: "Six figures worth knowing",
        body: "What you put in, your profit so far and your yearly return. XIRR is your own yearly return, counting when each rupee went in.",
      },
      {
        path: "/holdings",
        target: "holdings-table",
        title: "What you own",
        body: "One row for each stock: quantity, average cost, value and profit or loss. Select a column heading to sort by it, and a row to open that stock.",
      },
      {
        path: "/risk",
        target: "risk-tiles",
        title: "How bumpy it could be",
        body: "Volatility is how widely the portfolio swings. Maximum drawdown is the worst fall from a peak. The ⓘ on each tile explains it in a sentence.",
      },
      {
        path: "/allocation",
        target: "alloc-concentration",
        title: "Where the money sits",
        body: "How much depends on your largest few holdings. The more that rides on one or two names, the more one piece of bad news can hurt.",
      },
    ],
  },
  {
    id: "paper",
    title: "Practise with paper money",
    summary: "Place buy and sell orders at real prices with virtual cash.",
    icon: Wallet,
    minutes: 2,
    pages: /^\/lab\/paper/,
    steps: [
      {
        path: "/lab/paper",
        target: ["paper-ticket", "paper-create"],
        title: "A practice account",
        body: "Paper trading gives you virtual money and real prices. Orders fill at once, nothing reaches a broker and no real money moves. If there is no account yet, create one first.",
      },
      {
        target: "paper-symbol",
        title: "Pick a stock",
        body: "Type part of its name and choose it to see the latest price.",
        task: "Choose any company.",
        until: { appears: "paper-quote" },
      },
      {
        target: "paper-quantity",
        title: "How many",
        body: "The buttons underneath fill in 25%, 50% or all of the cash you have left.",
        task: "Enter a quantity.",
        until: { filled: true },
      },
      {
        target: "paper-submit",
        title: "Place the order",
        body: "It fills at the latest price. Go ahead: it is pretend money.",
        task: "Select Place buy order.",
        until: { click: true },
      },
      {
        target: "paper-positions",
        title: "Your position",
        body: "It appears here straight away, valued at live prices. Sell from its row when you want out.",
      },
    ],
  },
];

export const lessonById = (id: string | null | undefined): Lesson | null => LESSONS.find((l) => l.id === id) ?? null;

/** The lesson about a page, if there is one. */
export const lessonFor = (pathname: string): Lesson | null => LESSONS.find((l) => l.pages?.test(pathname)) ?? null;
