import { Command } from "cmdk";
import {
  Bell, BellRing, BookOpen, Check, ChevronsUpDown, CircleHelp, ClipboardCheck, Compass, Download, FlaskConical, LogOut, Menu as MenuIcon, Moon, Plus, RotateCcw, Search,
  Sun, UserRound, X,
} from "lucide-react";
import { Dialog as RDialog } from "radix-ui";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { compact, signedPct } from "@/lib/format";
import { ALL, usePortfolio } from "@/lib/portfolio";
import { useAction, useMe, useSearch } from "@/lib/queries";
import { useTheme } from "@/lib/theme";
import type { Portfolio, Transaction } from "@/lib/types";
import { cn, symbolPath } from "@/lib/utils";
import { PortfolioDialog } from "../forms/PortfolioDialog";
import { GuideProvider, useGuide } from "../guide/Guide";
import { useInstaller } from "../InstallApp";
import { ServerStarting } from "../ServerStarting";
import { InstrumentRow, useDebounced } from "../forms/SymbolPicker";
import { TransactionDialog, type TransactionDraft } from "../forms/TransactionDialog";
import { Button, ConfirmDialog, IconButton, Menu, MenuItem, MenuLabel, MenuSeparator, Popover, Signed, Tooltip } from "../ui";
import { MOBILE_TABS, NAV, SETTINGS, TRADE_CHECK } from "./nav";

// ---------------------------------------------------------------- actions
interface AppActions {
  /** Open the add-transaction dialog, optionally pre-filled. */
  addTransaction: (draft?: TransactionDraft) => void;
  editTransaction: (transaction: Transaction) => void;
  newPortfolio: (kind?: "investment" | "paper") => void;
  editPortfolio: (portfolio: Portfolio) => void;
  openSearch: () => void;
}

const ActionsContext = createContext<AppActions | null>(null);

/** Dialogs any page can open: add a transaction, create a portfolio, search. */
export function useAppActions(): AppActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error("useAppActions must be used inside AppShell");
  return ctx;
}

/** The WealthOS mark: the ribbon W with rising bars. It sits on its own navy tile, so it reads on any surface in either theme. */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/logo-mark.png"
      alt=""
      aria-hidden
      width={192}
      height={192}
      draggable={false}
      // The hairline keeps the tile's edge visible against the dark theme's near-black.
      className={cn("size-7 shrink-0 select-none rounded-[22%] outline outline-1 -outline-offset-1 outline-white/10", className)}
    />
  );
}

const BRAND_SIZES = {
  sm: { mark: "size-7", name: "text-[15px]", gap: "gap-2.5" },
  md: { mark: "size-8", name: "text-[17px]", gap: "gap-2.5" },
  lg: { mark: "size-11", name: "text-[26px]", gap: "gap-3" },
} as const;

/**
 * The logo as it is used in the app: the mark, and the name beside it.
 * The name is set in type, not cut from the artwork, so it stays sharp at any
 * size and takes the theme's ink; "OS" carries the logo's teal-to-green.
 */
export function Brand({ size = "sm", tagline, className }: { size?: keyof typeof BRAND_SIZES; /** Add the logo's "Track | Analyze | Plan | Grow" line. */ tagline?: boolean; className?: string }) {
  const s = BRAND_SIZES[size];
  return (
    <span className={cn("inline-flex min-w-0 items-center", s.gap, className)}>
      <Logo className={s.mark} />
      <span className="flex min-w-0 flex-col">
        <span className={cn("font-semibold leading-none tracking-tight text-ink", s.name)}>
          Wealth<span className="brand-ink">OS</span>
        </span>
        {tagline && (
          <span className="mt-1.5 flex items-center gap-2 whitespace-nowrap text-[9.5px] font-medium uppercase leading-none tracking-[0.2em] text-muted">
            {["Track", "Analyze", "Plan", "Grow"].map((word, i) => (
              <span key={word} className="flex items-center gap-2">
                {i > 0 && <span className="h-2.5 w-px bg-line-strong" aria-hidden />}
                {word}
              </span>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- sidebar
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const link = ({ isActive }: { isActive: boolean }) =>
    cn(
      "group flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
      isActive ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
    );
  return (
    <nav data-tour="nav" className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3" aria-label="Main">
      {/* The one thing a newcomer should not have to hunt for. It is left out of the Lab list below. */}
      <NavLink
        to={TRADE_CHECK.to}
        onClick={onNavigate}
        data-tour="nav-trade-check"
        className={({ isActive }) =>
          cn(
            "group flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset transition-colors",
            isActive ? "bg-accent text-on-accent ring-accent" : "bg-accent-soft text-ink ring-accent/25 hover:ring-accent/60",
          )
        }
      >
        {({ isActive }) => (
          <>
            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", isActive ? "bg-white/15" : "bg-accent text-on-accent")}>
              <ClipboardCheck className="size-4" strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold leading-tight">Check a trade</span>
              <span className={cn("mt-0.5 block text-[11px] leading-tight", isActive ? "text-on-accent/80" : "text-muted")}>Before you buy or sell</span>
            </span>
          </>
        )}
      </NavLink>
      {NAV.map((group) => (
        <div key={group.title}>
          <div className="mb-1 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted">{group.title}</div>
          <div className="flex flex-col gap-0.5">
            {group.items.filter((item) => item !== TRADE_CHECK).map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === "/"} className={link} onClick={onNavigate}>
                {({ isActive }) => (
                  <>
                    <item.icon className={cn("size-4 shrink-0", isActive ? "text-accent" : "text-muted group-hover:text-ink-2")} strokeWidth={2} />
                    {item.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const { status } = useAuth();
  const guide = useGuide();
  const installer = useInstaller();
  return (
    <div className="border-t border-line p-3">
      {status === "demo" && (
        <Tooltip content="Sample portfolios at live prices. Anything you change stays on this device." side="right">
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs font-medium text-ink ring-1 ring-line">
            <FlaskConical className="size-3.5 shrink-0 text-accent" />
            Demo workspace
            <span className="ml-auto font-normal text-muted">live prices</span>
          </div>
        </Tooltip>
      )}
      <button
        data-tour="guide-button"
        onClick={() => {
          onNavigate?.();
          guide.openLessons();
        }}
        className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Compass className="size-4 text-muted" />
        Take the tour
      </button>
      {!installer.installed && !installer.onDevice && (
        <button
          disabled={installer.installing}
          onClick={() => {
            onNavigate?.();
            installer.start();
          }}
          className="flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
        >
          <Download className="size-4 text-muted" />
          {installer.installing ? "Installing…" : "Get the app"}
        </button>
      )}
      <Link
        to="/docs"
        onClick={onNavigate}
        className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <BookOpen className="size-4 text-muted" />
        Docs
      </Link>
      <NavLink
        to={SETTINGS.to}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors", isActive ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink")
        }
      >
        <SETTINGS.icon className="size-4 text-muted" />
        Settings
      </NavLink>
    </div>
  );
}

// ------------------------------------------------------- portfolio switch
function PortfolioSwitcher() {
  const { id, portfolio, portfolios, investment, paper, isAll, name, select } = usePortfolio();
  const actions = useAppActions();
  const navigate = useNavigate();
  if (!portfolios.length) return null;
  const total = investment.reduce((sum, p) => sum + p.summary.value, 0);
  const row = (p: Portfolio) => (
    <MenuItem
      key={p.id}
      onSelect={() => select(p.id)}
      icon={<span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />}
      trailing={
        <span className="flex items-center gap-2">
          <span className="num text-xs text-muted">{compact(p.kind === "paper" ? p.summary.net_worth : p.summary.value)}</span>
          {id === p.id && <Check className="size-3.5 text-accent" />}
        </span>
      }
    >
      {p.name}
    </MenuItem>
  );
  return (
    <Menu
      align="start"
      className="w-72"
      trigger={
        <button data-tour="portfolio-switcher" className="flex h-9 min-w-0 max-w-[15rem] items-center gap-2 rounded-[10px] border border-line-strong bg-surface pl-2.5 pr-2 text-left transition-colors hover:bg-surface-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: isAll ? "var(--ink-2)" : portfolio?.color }} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted" />
        </button>
      }
    >
      {investment.length > 1 && (
        <>
          <MenuItem
            onSelect={() => select(ALL)}
            icon={<span className="size-2.5 shrink-0 rounded-full bg-ink-2" />}
            trailing={
              <span className="flex items-center gap-2">
                <span className="num text-xs text-muted">{compact(total)}</span>
                {isAll && <Check className="size-3.5 text-accent" />}
              </span>
            }
          >
            All portfolios
          </MenuItem>
          <MenuSeparator />
        </>
      )}
      {investment.length > 0 && <MenuLabel>Investment</MenuLabel>}
      {investment.map(row)}
      {paper.length > 0 && <MenuLabel>Paper trading</MenuLabel>}
      {paper.map(row)}
      <MenuSeparator />
      <MenuItem icon={<Plus />} onSelect={() => actions.newPortfolio()}>
        New portfolio
      </MenuItem>
      <MenuItem onSelect={() => navigate("/portfolios")}>Manage portfolios</MenuItem>
    </Menu>
  );
}

// ------------------------------------------------------------ alerts bell
function AlertsBell() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["alerts-evaluate"],
    queryFn: async () => {
      const result = await api.evaluateAlerts();
      if (result.fired.length) {
        client.setQueryData(["alerts"], result.alerts);
        result.fired.forEach((f) => {
          toast(f.message, { icon: <BellRing className="size-4 text-accent" />, duration: 10_000 });
          if ("Notification" in window && Notification.permission === "granted") new Notification("WealthOS alert", { body: f.message, icon: "/pwa-192.png" });
        });
      }
      return result.alerts;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const triggered = (data ?? []).filter((a) => a.triggered_at).sort((a, b) => (b.triggered_at ?? "").localeCompare(a.triggered_at ?? ""));
  const recent = triggered.filter((a) => Date.now() - new Date(a.triggered_at!).getTime() < 3 * 86_400_000);
  return (
    <Popover
      align="end"
      className="w-80"
      trigger={
        <IconButton label="Alerts" className="relative">
          <Bell className="size-[18px]" />
          {recent.length > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-bg" />}
        </IconButton>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className="text-[13px] font-semibold text-ink">Triggered alerts</span>
        <button className="text-xs font-medium text-accent hover:underline" onClick={() => navigate("/alerts")}>
          Manage
        </button>
      </div>
      {triggered.length === 0 ? (
        <p className="px-3.5 py-6 text-center text-[13px] text-muted">Nothing has triggered. {data?.filter((a) => a.is_active).length ?? 0} alerts are watching.</p>
      ) : (
        <ul className="max-h-80 overflow-y-auto p-1">
          {triggered.slice(0, 8).map((a) => (
            <li key={a.id}>
              <Link to={symbolPath(a.symbol)} className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-2">
                <div className="text-[13px] text-ink">{a.message || `${a.symbol} alert triggered`}</div>
                <div className="mt-0.5 text-xs text-muted">{new Date(a.triggered_at!).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  );
}

// -------------------------------------------------------- command palette
function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const actions = useAppActions();
  const { toggle, theme } = useTheme();
  const { portfolios, select } = usePortfolio();
  const [text, setText] = useState("");
  const query = useDebounced(text.trim(), 150);
  const { data: stocks } = useSearch(open ? query : "");
  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };
  const q = text.trim().toLowerCase();
  const match = (...words: string[]) => !q || words.some((w) => w.toLowerCase().includes(q));
  const pages = [...NAV.flatMap((g) => g.items), SETTINGS].filter((p) => match(p.label, p.keywords ?? ""));
  const item = "flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] text-ink data-[selected=true]:bg-surface-2 [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted";
  const heading = "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted";

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RDialog.Content className="fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-pop outline-none data-[state=open]:animate-pop">
          <RDialog.Title className="sr-only">Search</RDialog.Title>
          <RDialog.Description className="sr-only">Search stocks, pages and actions</RDialog.Description>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search className="size-4 shrink-0 text-muted" />
              <Command.Input data-tour="search-input" value={text} onValueChange={setText} placeholder="Search stocks, pages and actions" className="h-12 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted" />
              <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 text-[10px] font-medium text-muted">ESC</kbd>
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">Nothing matches “{text}”.</Command.Empty>
              {!!stocks?.length && query && (
                <Command.Group heading="Stocks and indices" className={heading}>
                  {stocks.slice(0, 7).map((s) => (
                    <Command.Item key={s.symbol} value={`stock-${s.symbol}`} onSelect={run(() => navigate(symbolPath(s.symbol)))} className={item}>
                      <InstrumentRow item={s} />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {match("check trade should i buy sell confidence score", "add transaction buy sell record", "new portfolio create", "theme dark light") && (
                <Command.Group heading="Actions" className={heading}>
                  {match("check trade should i buy sell confidence score") && (
                    <Command.Item value="action-check" onSelect={run(() => navigate(TRADE_CHECK.to))} className={item}>
                      <ClipboardCheck /> Check a trade before you make it
                    </Command.Item>
                  )}
                  {match("add transaction buy sell record") && (
                    <Command.Item value="action-add" onSelect={run(() => actions.addTransaction())} className={item}>
                      <Plus /> Add transaction
                    </Command.Item>
                  )}
                  {match("new portfolio create") && (
                    <Command.Item value="action-portfolio" onSelect={run(() => actions.newPortfolio())} className={item}>
                      <Plus /> New portfolio
                    </Command.Item>
                  )}
                  {match("theme dark light mode") && (
                    <Command.Item value="action-theme" onSelect={run(toggle)} className={item}>
                      {theme === "dark" ? <Sun /> : <Moon />} Switch to {theme === "dark" ? "light" : "dark"} theme
                    </Command.Item>
                  )}
                </Command.Group>
              )}
              {pages.length > 0 && (
                <Command.Group heading="Go to" className={heading}>
                  {pages.map((p) => (
                    <Command.Item key={p.to} value={`page-${p.to}`} onSelect={run(() => navigate(p.to))} className={item}>
                      <p.icon /> {p.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {q && portfolios.filter((p) => match(p.name)).length > 0 && (
                <Command.Group heading="Switch portfolio" className={heading}>
                  {portfolios.filter((p) => match(p.name)).map((p) => (
                    <Command.Item key={p.id} value={`portfolio-${p.id}`} onSelect={run(() => select(p.id))} className={item}>
                      <span className="size-2.5 rounded-full" style={{ background: p.color }} /> {p.name}
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ----------------------------------------------------------------- topbar
function MarketPill() {
  const { data } = useMe();
  if (!data) return null;
  const open = data.market.is_open;
  return (
    <Tooltip content={`NSE · ${data.market.detail}. Prices are delayed by a few minutes.`} side="bottom">
      <span className="hidden h-7 cursor-default items-center gap-1.5 rounded-full border border-line px-2.5 text-xs font-medium text-ink-2 md:inline-flex">
        <span className={cn("relative flex size-2")}>
          {open && <span className="absolute inline-flex size-full animate-ping rounded-full bg-gain opacity-60" />}
          <span className={cn("relative inline-flex size-2 rounded-full", open ? "bg-gain" : "bg-muted")} />
        </span>
        Market {data.market.label.toLowerCase()}
      </span>
    </Tooltip>
  );
}

function AccountMenu() {
  const { status, email, displayName, signOut } = useAuth();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);
  const reset = useAction(api.resetDemo, { invalidate: "portfolio", success: "Demo workspace reset to the sample data", onSuccess: () => setConfirmReset(false) });
  const initial = (displayName || email || "D").trim().charAt(0).toUpperCase();
  return (
    <>
      <Menu
        className="w-60"
        trigger={
          <button aria-label="Account" className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent ring-1 ring-inset ring-accent/20 transition-colors hover:bg-accent hover:text-on-accent">
            {status === "demo" ? <FlaskConical className="size-4" /> : initial}
          </button>
        }
      >
        <div className="px-2.5 pb-2 pt-1.5">
          <div className="truncate text-[13px] font-medium text-ink">{status === "demo" ? "Demo workspace" : displayName || "Your account"}</div>
          <div className="truncate text-xs text-muted">{status === "demo" ? "Sample data, live prices" : email}</div>
        </div>
        <MenuSeparator />
        <MenuItem icon={<UserRound />} onSelect={() => navigate("/settings")}>
          Settings
        </MenuItem>
        {status === "demo" && (
          <MenuItem icon={<RotateCcw />} onSelect={() => setConfirmReset(true)}>
            Reset demo data
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => void signOut()}>
          {status === "demo" ? "Leave demo" : "Sign out"}
        </MenuItem>
      </Menu>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset the demo workspace?"
        description="Everything you added or changed in the demo is replaced with fresh sample portfolios, watchlists and journal entries."
        confirmLabel="Reset demo"
        onConfirm={() => reset.mutate(undefined)}
        loading={reset.isPending}
      />
    </>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const actions = useAppActions();
  const { theme, toggle } = useTheme();
  const { investment } = usePortfolio();
  const guide = useGuide();
  const { pathname } = useLocation();
  // These pages carry their own Add transaction button in the header.
  const pageHasAdd = pathname === "/holdings" || pathname === "/transactions" || pathname.startsWith("/stock/");
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-md sm:px-5 print:hidden">
      <IconButton label="Open menu" data-tour="menu-button" className="lg:hidden" onClick={onMenu}>
        <MenuIcon className="size-5" />
      </IconButton>
      <PortfolioSwitcher />
      <button
        data-tour="search"
        onClick={actions.openSearch}
        className="ml-1 hidden h-9 w-full max-w-xs items-center gap-2 rounded-[10px] border border-line bg-surface/60 px-3 text-[13px] text-muted transition-colors hover:border-line-strong hover:text-ink-2 sm:flex"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Search stocks or jump to…</span>
        <kbd className="rounded-md border border-line-strong px-1.5 py-0.5 text-[10px] font-medium">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <div className="ml-auto flex items-center gap-1.5">
        <MarketPill />
        <IconButton label="Search" data-tour="search" className="sm:hidden" onClick={actions.openSearch}>
          <Search className="size-[18px]" />
        </IconButton>
        {!pathname.startsWith(TRADE_CHECK.to) && (
          <Link
            to={TRADE_CHECK.to}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-accent/35 bg-accent-soft px-2.5 text-[13px] font-medium text-ink transition-colors hover:border-accent/70 max-md:hidden"
          >
            <ClipboardCheck className="size-4 text-accent" />
            Check a trade
          </Link>
        )}
        {investment.length > 0 && !pageHasAdd && (
          <Button variant="primary" size="sm" data-tour="add-transaction" className="max-sm:hidden" icon={<Plus className="size-4" />} onClick={() => actions.addTransaction()}>
            Add transaction
          </Button>
        )}
        <IconButton label="What is this page? Open the guide" data-tour="page-guide" active={guide.active} onClick={guide.openPageGuide}>
          <CircleHelp className="size-[18px]" />
        </IconButton>
        <AlertsBell />
        <IconButton label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={toggle}>
          {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </IconButton>
        <AccountMenu />
      </div>
    </header>
  );
}

function MobileTabs() {
  const actions = useAppActions();
  const { investment } = usePortfolio();
  const tab = ({ isActive }: { isActive: boolean }) =>
    cn("flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors", isActive ? "text-accent" : "text-muted");
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[60px] items-stretch border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden print:hidden" aria-label="Quick navigation">
      {MOBILE_TABS.slice(0, 2).map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === "/"} className={tab}>
          <item.icon className="size-5" />
          {item.label}
        </NavLink>
      ))}
      <div className="flex flex-1 items-center justify-center">
        <button
          aria-label="Add transaction"
          data-tour="add-transaction"
          disabled={!investment.length}
          onClick={() => actions.addTransaction()}
          className="flex size-11 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg shadow-accent/30 transition-transform active:scale-95 disabled:opacity-40"
        >
          <Plus className="size-5" strokeWidth={2.4} />
        </button>
      </div>
      {MOBILE_TABS.slice(2).map((item) => (
        <NavLink key={item.to} to={item.to} className={tab}>
          <item.icon className="size-5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------------ shell
export function AppShell({ children }: { children?: ReactNode }) {
  const location = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState(false);
  const [tx, setTx] = useState<{ open: boolean; draft?: TransactionDraft; editing?: Transaction | null }>({ open: false });
  const [pf, setPf] = useState<{ open: boolean; editing?: Portfolio | null; kind?: "investment" | "paper" }>({ open: false });

  const actions = useMemo<AppActions>(
    () => ({
      addTransaction: (draft) => setTx({ open: true, draft, editing: null }),
      editTransaction: (editing) => setTx({ open: true, editing }),
      newPortfolio: (kind) => setPf({ open: true, editing: null, kind }),
      editPortfolio: (editing) => setPf({ open: true, editing }),
      openSearch: () => setSearch(true),
    }),
    [],
  );

  const onKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      setSearch((v) => !v);
    }
  }, []);
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);
  useEffect(() => {
    setDrawer(false);
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <ActionsContext.Provider value={actions}>
      <GuideProvider>
      <div className="flex min-h-dvh">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line bg-surface/40 lg:flex print:!hidden">
          <Link to="/" className="flex h-14 shrink-0 items-center px-5">
            <Brand />
          </Link>
          <SidebarNav />
          <SidebarFooter />
        </aside>

        <RDialog.Root open={drawer} onOpenChange={setDrawer}>
          <RDialog.Portal>
            <RDialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-in lg:hidden" />
            <RDialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface shadow-pop outline-none data-[state=open]:animate-fade-in lg:hidden">
              <RDialog.Title className="sr-only">Menu</RDialog.Title>
              <RDialog.Description className="sr-only">Main navigation</RDialog.Description>
              <div className="flex h-14 shrink-0 items-center justify-between px-5">
                <Brand />
                <RDialog.Close asChild>
                  <IconButton label="Close menu">
                    <X className="size-5" />
                  </IconButton>
                </RDialog.Close>
              </div>
              <SidebarNav onNavigate={() => setDrawer(false)} />
              <SidebarFooter onNavigate={() => setDrawer(false)} />
            </RDialog.Content>
          </RDialog.Portal>
        </RDialog.Root>

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenu={() => setDrawer(true)} />
          <ServerStarting className="mx-4 mt-4 sm:mx-6 lg:mx-8" />
          <main className="min-w-0 flex-1">{children ?? <Outlet />}</main>
        </div>
        <MobileTabs />
      </div>

      <CommandPalette open={search} onOpenChange={setSearch} />
      <TransactionDialog open={tx.open} onOpenChange={(open) => setTx((s) => ({ ...s, open }))} draft={tx.draft} editing={tx.editing} />
      <PortfolioDialog open={pf.open} onOpenChange={(open) => setPf((s) => ({ ...s, open }))} editing={pf.editing} defaultKind={pf.kind} />
      </GuideProvider>
    </ActionsContext.Provider>
  );
}

/** Small "+x.x% today" readout used beside portfolio names. */
export function DayChange({ value }: { value: number }) {
  return <Signed value={value} className="text-xs">{signedPct(value)}</Signed>;
}
