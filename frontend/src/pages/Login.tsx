import { Activity, ArrowRight, BookOpen, FlaskConical, LineChart, LockKeyhole, MailCheck, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { InstallButton } from "@/components/InstallApp";
import { ServerStarting } from "@/components/ServerStarting";
import { Brand } from "@/components/layout/AppShell";
import { NAV, SETTINGS } from "@/components/layout/nav";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { lessonById } from "@/lib/lessons";

const FEATURES = [
  { icon: LineChart, title: "Returns from the ledger", text: "Average cost, realised and unrealised P&L, XIRR and CAGR, rebuilt from every trade you record." },
  { icon: Activity, title: "Risk you can read", text: "Volatility, beta, drawdown, VaR and a correlation map of what you actually hold." },
  { icon: FlaskConical, title: "Test before you act", text: "Trade check with a confidence score, what-if shocks, backtests and paper trading at live prices." },
];

/** Where a visitor was heading when they were asked to sign in, in words; null for the front door. */
function destination(pathname: string, search: string): string | null {
  const lesson = lessonById(new URLSearchParams(search).get("guide"));
  if (lesson) return `the lesson “${lesson.title}”`;
  if (pathname.startsWith("/stock/")) return `${decodeURIComponent(pathname.slice(7))}'s page`;
  if (pathname === "/") return null;
  return [...NAV.flatMap((group) => group.items), SETTINGS].find((item) => item.to === pathname)?.label ?? null;
}

function Backdrop() {
  return (
    <>
      <svg className="absolute inset-0 size-full" aria-hidden>
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="var(--line)" strokeWidth="1" />
          </pattern>
          <radialGradient id="glow" cx="0.85" cy="1" r="0.9">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <rect width="100%" height="100%" fill="url(#glow)" />
      </svg>
      {/* A rising line kept to the lower third, clear of the copy above it. */}
      <svg className="absolute inset-x-0 bottom-0 h-[24%] w-full" preserveAspectRatio="none" viewBox="0 0 800 300" aria-hidden>
        <defs>
          <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.2" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 215 C90 205 130 160 210 168 S330 120 400 132 S520 62 600 74 S720 22 800 8 V300 H0Z" fill="url(#fade)" />
        <path d="M0 215 C90 205 130 160 210 168 S330 120 400 132 S520 62 600 74 S720 22 800 8" fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d="M0 238 C120 232 200 205 300 208 S470 170 560 176 S700 128 800 116" fill="none" stroke="var(--muted)" strokeWidth="1.5" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" opacity="0.55" />
      </svg>
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:block">
        <Backdrop />
        <div className="relative flex h-full flex-col justify-between gap-10 p-12 xl:p-16">
          <div className="flex items-center justify-between gap-4">
            <Brand size="lg" tagline />
            <InstallButton className="bg-surface/80 backdrop-blur" />
          </div>
          <div className="max-w-lg">
            <h1 className="text-[40px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink xl:text-[46px]">
              Know what your portfolio is doing, and why.
            </h1>
            <p className="mt-4 text-base leading-relaxed text-ink-2">
              One place to track your investments, measure real returns and risk, and see how different scenarios would play out.
            </p>
            <ul className="mt-9 flex flex-col gap-5">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex gap-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent ring-1 ring-inset ring-accent/15">
                    <f.icon className="size-[18px]" />
                  </span>
                  <div>
                    <div className="text-sm font-medium text-ink">{f.title}</div>
                    <div className="mt-0.5 text-[13px] leading-relaxed text-muted">{f.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="flex w-fit items-center gap-2 rounded-full bg-surface/80 py-1.5 pl-2.5 pr-3.5 text-xs text-ink-2 ring-1 ring-line backdrop-blur">
            <ShieldCheck className="size-4 shrink-0 text-accent" />
            A tracking and analysis tool. It never places trades or connects to a broker.
          </p>
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm animate-rise">
          {/* Signing in needs the server too, so say so if it is still being started. */}
          <ServerStarting className="mb-6" />
          {children}
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { accountsEnabled, signIn, signUp, sendPasswordReset, enterDemo } = useAuth();
  const { pathname, search } = useLocation();
  const heading = destination(pathname, search);
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.");
    if (mode !== "forgot" && password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    try {
      if (mode === "signin") await signIn(email, password);
      else if (mode === "signup") {
        if (await signUp(email, password, name.trim())) setNotice(`We sent a confirmation link to ${email}. Open it to finish creating your account.`);
      } else {
        await sendPasswordReset(email);
        setNotice(`If an account exists for ${email}, a reset link is on its way.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: typeof mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  return (
    <Frame>
      <Brand size="md" className="mb-8 lg:hidden" />

      {notice ? (
        <div>
          <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <MailCheck className="size-5" />
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Check your inbox</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{notice}</p>
          <Button className="mt-6" onClick={() => switchMode("signin")}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <>
          {heading && (
            <p className="mb-5 flex items-start gap-2 rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink ring-1 ring-inset ring-accent/20">
              <LockKeyhole className="mt-px size-4 shrink-0 text-accent" aria-hidden />
              <span>Sign in, or open the demo, to continue to <span className="font-medium">{heading}</span>. You will land there straight away.</span>
            </p>
          )}
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            {mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}
          </h2>
          <p className="mt-1.5 text-sm text-muted">
            {mode === "signin"
              ? "Sign in to your portfolios."
              : mode === "signup"
                ? "Your portfolios stay private to your account."
                : "Enter your email and we'll send a link to set a new password."}
          </p>

          {accountsEnabled ? (
            <>
              {mode !== "forgot" && (
                <Segmented
                  className="mt-6 w-full [&>button]:flex-1"
                  label="Sign in or create an account"
                  value={mode}
                  onChange={switchMode}
                  options={[{ value: "signin", label: "Sign in" }, { value: "signup", label: "Create account" }]}
                />
              )}
              <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
                {mode === "signup" && (
                  <Field label="Name">
                    {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="What should we call you?" />}
                  </Field>
                )}
                <Field label="Email">
                  {(props) => <Input {...props} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />}
                </Field>
                {mode !== "forgot" && (
                  <Field label="Password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
                    {(props) => (
                      <Input {...props} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
                    )}
                  </Field>
                )}
                {error && (
                  <p role="alert" className="rounded-lg bg-loss-soft px-3 py-2 text-[13px] text-loss">
                    {error}
                  </p>
                )}
                <Button type="submit" variant="primary" size="lg" loading={busy}>
                  {mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
                </Button>
              </form>
              <div className="mt-3 text-center">
                <button className="text-[13px] font-medium text-muted transition-colors hover:text-ink" onClick={() => switchMode(mode === "forgot" ? "signin" : "forgot")}>
                  {mode === "forgot" ? "Back to sign in" : "Forgot your password?"}
                </button>
              </div>
              <div className="my-6 flex items-center gap-3 text-xs text-muted">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>
            </>
          ) : (
            <p className="mt-6 rounded-xl bg-surface-2 p-4 text-[13px] leading-relaxed text-ink-2 ring-1 ring-line">
              Accounts aren't set up on this install yet. Add your Supabase URL and key to the env files to turn on sign-in. Until then, the demo workspace has everything.
            </p>
          )}

          <button
            onClick={enterDemo}
            className="group mt-0 flex w-full items-center gap-3 rounded-xl border border-line-strong bg-surface p-3.5 text-left transition-colors hover:border-accent/50 hover:bg-surface-2 [p+&]:mt-4"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
              <FlaskConical className="size-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">Explore the demo workspace</span>
              <span className="block text-xs text-muted">No account needed. Sample portfolios at live prices.</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
          </button>
          <Link to="/docs" className="mt-5 flex items-center justify-center gap-1.5 text-[13px] font-medium text-muted transition-colors hover:text-ink">
            <BookOpen className="size-4" aria-hidden />
            New here? See how WealthOS works
          </Link>
          {/* The wide layout has this button beside the logo. */}
          <div className="mt-3 flex justify-center lg:hidden">
            <InstallButton variant="ghost" size="sm" className="text-muted" />
          </div>
        </>
      )}
    </Frame>
  );
}

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    try {
      await updatePassword(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame>
      <h2 className="text-2xl font-semibold tracking-tight text-ink">Set a new password</h2>
      <p className="mt-1.5 text-sm text-muted">Choose a password you don't use anywhere else.</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="New password" error={error} hint="At least 8 characters.">
          {(props) => <Input {...props} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus />}
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Save password
        </Button>
      </form>
    </Frame>
  );
}
