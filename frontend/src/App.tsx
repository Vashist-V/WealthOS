import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell, Logo } from "./components/layout/AppShell";
import { Button, Card, EmptyState, Skeleton } from "./components/ui";
import { useAuth } from "./lib/auth";
import { PortfolioProvider } from "./lib/portfolio";
import { LoginPage, ResetPasswordPage } from "./pages/Login";

const page = <T extends Record<string, React.ComponentType>>(load: () => Promise<T>, name: keyof T) =>
  lazy(() => load().then((m) => ({ default: m[name] })));

const Dashboard = page(() => import("./pages/Dashboard"), "DashboardPage");
const Holdings = page(() => import("./pages/Holdings"), "HoldingsPage");
const Transactions = page(() => import("./pages/Transactions"), "TransactionsPage");
const Portfolios = page(() => import("./pages/Portfolios"), "PortfoliosPage");
const Allocation = page(() => import("./pages/Allocation"), "AllocationPage");
const Risk = page(() => import("./pages/Risk"), "RiskPage");
const XRay = page(() => import("./pages/XRay"), "XRayPage");
const Dividends = page(() => import("./pages/Dividends"), "DividendsPage");
const Compare = page(() => import("./pages/Compare"), "ComparePage");
const Market = page(() => import("./pages/Market"), "MarketPage");
const Stock = page(() => import("./pages/Stock"), "StockPage");
const Watchlists = page(() => import("./pages/Watchlists"), "WatchlistsPage");
const Calendar = page(() => import("./pages/Calendar"), "CalendarPage");
const Alerts = page(() => import("./pages/Alerts"), "AlertsPage");
const TradeCheck = page(() => import("./pages/TradeCheck"), "TradeCheckPage");
const WhatIf = page(() => import("./pages/WhatIf"), "WhatIfPage");
const MonteCarlo = page(() => import("./pages/MonteCarlo"), "MonteCarloPage");
const Backtest = page(() => import("./pages/Backtest"), "BacktestPage");
const Paper = page(() => import("./pages/Paper"), "PaperPage");
const Journal = page(() => import("./pages/Journal"), "JournalPage");
const Settings = page(() => import("./pages/Settings"), "SettingsPage");
const Shared = page(() => import("./pages/Shared"), "SharedPage");
const Docs = page(() => import("./pages/Docs"), "DocsPage");

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Logo className="size-10 animate-pulse" />
    </div>
  );
}

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pt-7 sm:px-6 lg:px-8">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <Skeleton className="mt-4 h-80" />
    </div>
  );
}

/** Keeps one broken page from taking the whole app down. */
class PageBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed", error, info.componentStack);
  }
  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-10 sm:px-6">
        <Card>
          <EmptyState
            className="py-14"
            title="This page hit a problem"
            description="Something went wrong while drawing it. Your data is safe. Reload to try again, or open another page from the menu."
            action={<Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>}
          />
        </Card>
      </div>
    );
  }
}

function Workspace() {
  const location = useLocation();
  return (
    <PortfolioProvider>
      <AppShell>
        <PageBoundary resetKey={location.pathname}>
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/holdings" element={<Holdings />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/portfolios" element={<Portfolios />} />
              <Route path="/allocation" element={<Allocation />} />
              <Route path="/risk" element={<Risk />} />
              <Route path="/xray" element={<XRay />} />
              <Route path="/dividends" element={<Dividends />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/market" element={<Market />} />
              <Route path="/stock/:symbol" element={<Stock />} />
              <Route path="/watchlists" element={<Watchlists />} />
              <Route path="/calendar" element={<Calendar />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/lab/trade-check" element={<TradeCheck />} />
              <Route path="/lab/what-if" element={<WhatIf />} />
              <Route path="/lab/monte-carlo" element={<MonteCarlo />} />
              <Route path="/lab/backtest" element={<Backtest />} />
              <Route path="/lab/paper" element={<Paper />} />
              <Route path="/journal" element={<Journal />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </PageBoundary>
      </AppShell>
    </PortfolioProvider>
  );
}

export function App() {
  const { status, recovering } = useAuth();
  return (
    <Routes>
      <Route
        path="/shared/:token"
        element={
          <Suspense fallback={<Splash />}>
            <Shared />
          </Suspense>
        }
      />
      {/* Public: the docs explain the product to anyone, signed in or not. */}
      <Route
        path="/docs"
        element={
          <Suspense fallback={<Splash />}>
            <Docs />
          </Suspense>
        }
      />
      {/* Everything else needs a workspace. A signed-out visitor signs in at the address they asked for, and lands on it. */}
      <Route
        path="*"
        element={status === "loading" ? <Splash /> : recovering ? <ResetPasswordPage /> : status === "signed_out" ? <LoginPage /> : <Workspace />}
      />
    </Routes>
  );
}
