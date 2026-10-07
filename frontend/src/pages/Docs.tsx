/**
 * The public docs: what WealthOS is and how to use it, readable without an
 * account. Anything that has to be done inside the app is a link to that page;
 * a visitor who is not signed in is asked to sign in first and then lands on it.
 *
 * The section reference and the lessons are the same entries the app shows
 * behind the ? button and in the hands-on guide, so the two cannot drift apart.
 */
import { ArrowRight, Check, ClipboardCheck, Compass, Info, LockKeyhole, Minus, Moon, ShieldCheck, Sun, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { INSTALL_GUIDES, InstallButton, InstallSteps, useInstaller } from "@/components/InstallApp";
import { Brand } from "@/components/layout/AppShell";
import { IconButton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { GUIDE, type GuideSection } from "@/lib/guide";
import { LESSONS } from "@/lib/lessons";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const CONTENTS = [
  { id: "what", label: "What WealthOS is" },
  { id: "start", label: "Start in three steps" },
  { id: "trade-check", label: "Check a trade first" },
  { id: "ask", label: "Ask the market" },
  { id: "guide", label: "The hands-on guide" },
  { id: "install", label: "Get the app" },
  { id: "sections", label: "Every section" },
  { id: "words", label: "Words you will meet" },
  { id: "numbers", label: "How the numbers are worked out" },
  { id: "questions", label: "Questions people ask" },
] as const;

const SECTIONS = GUIDE.filter((s) => s.path !== null);
const GROUPS = [...new Set(SECTIONS.map((s) => s.group))];

const NUMBERS = [
  { term: "Cost and profit", text: "Your cost is the average of what you paid across all your buys, fees included. Fees are added to cost on a buy and taken from the proceeds on a sell." },
  { term: "XIRR", text: "Your own yearly return, counting the date every rupee went in or came out, and what the holdings are worth today." },
  { term: "CAGR and the return charts", text: "Yearly growth with your deposits and withdrawals taken out, so the figure can be set fairly beside an index." },
  { term: "Risk", text: "Today's holdings, at today's sizes, replayed over the period you choose. Volatility is a yearly figure; value at risk is a one-day figure from what actually happened." },
  { term: "Confidence score", text: "Each check in a trade check supports the trade, goes against it or is neutral, and carries a weight. The score starts at 50 and moves up or down by the share of that weight on each side. A language model never sets it." },
  { term: "Market mood", text: "The same arithmetic over checks on the whole market: the index against its 50 and 200-day averages, how many stocks are above their own averages, new highs against new lows, and India VIX, the market's fear gauge." },
  { term: "Sector and company scores", text: "A company gets the trade check's trend, valuation, business and risk checks. A sector is scored on how many of its companies are in an uptrend, how it has done against the index, and its growth, profitability and price. Short-term scores use only the price checks; long-term scores add the business ones." },
  { term: "Dividends", text: "Estimated from the shares you held on each ex-dividend date. What your bank actually received can differ." },
  { term: "Backtests", text: "A rule reads the closing price and trades at the next day's open. Slippage, tax and how easily the shares trade are left out." },
  { term: "Monte Carlo", text: "Thousands of made-up futures drawn from past monthly returns, to show how wide the range of outcomes is. It is not a forecast." },
];

const QUESTIONS = [
  {
    q: "Does WealthOS buy or sell for me?",
    a: "No. It never places a trade and is not connected to a broker. You buy and sell with your broker as you always have, then record what you did. Everything on screen is worked out from those records and from market prices.",
  },
  {
    q: "Is the confidence score telling me what to do?",
    a: "No. It counts how much of the evidence lines up behind a trade today: the trend, the valuation, the business, the risk and what the trade does to your portfolio. It cannot know your goals, how long you will hold or what else you own outside the app. It is there to make your own decision better informed, not to make it for you, and it is not investment advice.",
  },
  {
    q: "Do I need an account to try it?",
    a: "No. The sign-in page has a demo workspace with sample portfolios at live prices and every feature switched on. Nothing you do there touches real money. Create an account when you want to keep your own portfolios.",
  },
  {
    q: "Who can see my portfolio?",
    a: "Only you. Each account can read and change only its own records. If you share a portfolio you get a read-only link, and rupee amounts stay hidden on it unless you switch them on. You can switch the link off again at any time.",
  },
  {
    q: "Where do the prices come from, and how fresh are they?",
    a: "Prices, company figures and corporate actions for NSE-listed shares and funds come from Yahoo Finance and run a few minutes behind the market. They are fine for following your investments, and should not be relied on to time an order to the minute.",
  },
  {
    q: "What does the AI see?",
    a: "When AI is switched on, a question about a stock is answered from a briefing the app prepares: that stock's prices and figures, recent headlines, and your own position, trades and journal notes for that one stock. A question about the market is answered from the market's figures and scores, recent headlines, and which sectors and stocks you hold. Without AI, the same questions are answered straight from the data.",
  },
  {
    q: "Will it tell me which stocks to buy with my money?",
    a: "It will rank them, and show its working. Ask where ₹50,000 could go and you get the highest-scoring sector and its highest-scoring companies, each with the checks behind its score and what your money buys of it. That is a ranking of today's evidence, not a recommendation: it does not know your goals, and companies in one sector tend to rise and fall together. Run any of them through Trade check to see how it fits what you already hold.",
  },
  {
    q: "Is there a WealthOS app for my phone or computer?",
    a: "Yes, and it installs from this site rather than from an app store. On Android, and in Chrome or Edge on a computer, the Get the app button does it in one tap. On an iPhone or iPad you add it from the browser's Share menu. It is the same WealthOS with the same account, in its own window.",
  },
  {
    q: "I'm new to investing. Where should I start?",
    a: "Open the demo, take the first hands-on lesson, then run a trade you have been wondering about through Trade check and read every line of the result. Hover any ⓘ for a one-line meaning of the term beside it.",
  },
];

/** A trade check with made-up figures, to show what a result looks like. */
const SAMPLE: { verdict: "for" | "against" | "neutral"; title: string; reading: string; text: string }[] = [
  { verdict: "for", title: "Price against earnings", reading: "18.7 vs 29.8", text: "It costs fewer rupees for each rupee of profit than similar companies do." },
  { verdict: "against", title: "Longer trend", reading: "4.6% below", text: "The price is under its 200-day average, so the longer trend is down." },
  { verdict: "neutral", title: "Share of your portfolio", reading: "0% → 15%", text: "A sizeable position: a 10% fall in it would take 1.5% off the portfolio." },
];
const MARKS: Record<"for" | "against" | "neutral", { icon: LucideIcon; className: string; label: string }> = {
  for: { icon: Check, className: "bg-gain-soft text-gain", label: "Supports the trade" },
  against: { icon: X, className: "bg-loss-soft text-loss", label: "Goes against it" },
  neutral: { icon: Minus, className: "bg-surface-3 text-ink-2", label: "Neutral" },
};

// ------------------------------------------------------------------- pieces
/** A link into the app. Signed-out visitors are sent through sign-in and land on the page afterwards. */
function AppLink({ to, children, primary, className }: { to: string; children: ReactNode; primary?: boolean; className?: string }) {
  const { status } = useAuth();
  const locked = status === "signed_out";
  return (
    <Link
      to={to}
      title={locked ? "You will be asked to sign in first, then taken straight there." : undefined}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 font-medium transition-colors",
        primary
          ? "h-10 rounded-[10px] bg-accent px-4 text-sm text-on-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] hover:bg-accent-hover"
          : "text-[13px] text-accent hover:underline",
        className,
      )}
    >
      {locked && <LockKeyhole className={primary ? "size-4" : "size-3.5"} aria-hidden />}
      {children}
      <ArrowRight className={primary ? "size-4" : "size-3.5"} aria-hidden />
      {locked && <span className="sr-only">(sign-in needed)</span>}
    </Link>
  );
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-line pt-10 first:border-t-0 first:pt-0">
      <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h2>
      {lead && <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-ink-2">{lead}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function SectionCard({ section }: { section: GuideSection }) {
  return (
    <article id={`section-${section.id}`} className="card scroll-mt-20 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent ring-1 ring-inset ring-accent/15">
          <section.icon className="size-[18px]" />
        </span>
        <div className="min-w-0">
          <h4 className="text-base font-semibold leading-tight tracking-tight text-ink">{section.title}</h4>
          <p className="mt-0.5 text-[13px] text-accent">“{section.question}”</p>
        </div>
      </div>
      <p className="mt-3.5 text-sm leading-relaxed text-ink-2">{section.what}</p>
      <ol className="mt-3.5 flex flex-col gap-2">
        {section.how.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
            <span className="num mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-medium text-ink">{i + 1}</span>
            {line}
          </li>
        ))}
      </ol>
      {section.terms && (
        <dl className="mt-3.5 flex flex-col gap-2 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
          {section.terms.map((t) => (
            <div key={t.term} className="text-[13px] leading-relaxed">
              <dt className="inline font-medium text-ink">{t.term}. </dt>
              <dd className="inline text-ink-2">{t.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
      <AppLink to={section.path!} className="mt-4">
        Open {section.title}
      </AppLink>
    </article>
  );
}

/** What a trade check result looks like, with figures that are plainly an example. */
function SampleCheck() {
  return (
    <figure className="card overflow-hidden">
      <figcaption className="flex items-center gap-2 border-b border-line bg-surface-2 px-5 py-2.5 text-xs text-muted">
        <Info className="size-3.5 shrink-0" aria-hidden />
        An example with made-up figures, to show the shape of a result.
      </figcaption>
      <div className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-[180px_minmax(0,1fr)]">
        <div className="text-center">
          <div className="text-[13px] text-muted">Buying 30 shares</div>
          <div className="relative mx-auto mt-2 w-[170px]">
            <svg viewBox="0 0 200 112" className="w-full" role="img" aria-label="Example confidence score: 58 out of 100">
              <path d="M16 100 A84 84 0 0 1 184 100" fill="none" stroke="var(--surface-3)" strokeWidth="14" strokeLinecap="round" />
              <path d="M16 100 A84 84 0 0 1 184 100" fill="none" stroke="var(--gain)" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${0.58 * Math.PI * 84} ${Math.PI * 84}`} />
            </svg>
            <div className="absolute inset-x-0 bottom-0">
              <div className="num text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink">58</div>
              <div className="mt-0.5 text-[11px] text-muted">out of 100</div>
            </div>
          </div>
          <div className="mt-3 text-[13px] font-medium leading-snug text-ink">More checks support this buy than go against it</div>
        </div>
        <ul className="flex flex-col divide-y divide-line">
          {SAMPLE.map((row) => {
            const mark = MARKS[row.verdict];
            return (
              <li key={row.title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span role="img" aria-label={mark.label} className={cn("mt-px flex size-[22px] shrink-0 items-center justify-center rounded-full", mark.className)}>
                  <mark.icon className="size-3.5" strokeWidth={2.6} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-[13px] font-medium text-ink">{row.title}</span>
                    <span className="num text-[13px] text-ink-2">{row.reading}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{row.text}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </figure>
  );
}

/** The id of the section the reader has scrolled to, for the contents list. */
function useCurrent(ids: readonly string[]): string {
  const [current, setCurrent] = useState(ids[0]);
  useEffect(() => {
    const onScroll = () => {
      // The last section whose heading has passed under the top bar.
      let found = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) found = id;
      }
      setCurrent(found);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ids]);
  return current;
}

// --------------------------------------------------------------------- page
export function DocsPage() {
  const { status } = useAuth();
  const { theme, toggle } = useTheme();
  const { hash } = useLocation();
  const signedOut = status === "signed_out";
  const installer = useInstaller();
  const current = useCurrent(useMemo(() => CONTENTS.map((c) => c.id), []));

  useEffect(() => {
    document.title = "Docs · WealthOS";
  }, []);
  // The page loads after the browser has tried the #anchor, so go there once it exists.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);

  const words = useMemo(() => {
    const seen = new Map<string, string>();
    for (const section of GUIDE) for (const t of section.terms ?? []) if (!seen.has(t.term)) seen.set(t.term, t.meaning);
    return [...seen].map(([term, meaning]) => ({ term, meaning })).sort((a, b) => a.term.localeCompare(b.term));
  }, []);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md print:hidden">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center">
            <Brand />
          </Link>
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-muted ring-1 ring-inset ring-line">Docs</span>
          <span className="flex-1" />
          <IconButton label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={toggle}>
            {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
          </IconButton>
          {/* Too wide for a phone's top bar; there the page's own "Get the app" section has it. */}
          <InstallButton size="sm" className="hidden sm:inline-flex" />
          <Link to="/" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[13px] font-medium text-on-accent transition-colors hover:bg-accent-hover">
            {signedOut ? "Sign in" : "Open the app"}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 sm:px-6">
        <div className="max-w-3xl pb-10 pt-12 sm:pt-16">
          <h1 className="text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[44px]">Understand your investments, and check a trade before you make it.</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
            WealthOS keeps track of what you own, shows how it is really doing, and tests an idea before you put money behind it. This page explains all of it in plain words. No finance background needed.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <AppLink to="/?guide=basics" primary>
              {signedOut ? "Sign in and take the guided start" : "Take the guided start"}
            </AppLink>
            <a href="#trade-check" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
              See how a trade check works <ArrowRight className="size-4" aria-hidden />
            </a>
            {!installer.installed && !installer.onDevice && (
              <a href="#install" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                Get the app <ArrowRight className="size-4" aria-hidden />
              </a>
            )}
          </div>
          <p className="mt-6 flex w-fit items-start gap-2 rounded-xl bg-surface px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2 ring-1 ring-line">
            <ShieldCheck className="mt-px size-4 shrink-0 text-accent" aria-hidden />
            WealthOS tracks and analyses. It never places a trade and is not connected to a broker.
          </p>
        </div>

        <div className="grid gap-x-12 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="On this page" className="sticky top-20 hidden h-fit lg:block">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">On this page</div>
            <ul className="flex flex-col border-l border-line">
              {CONTENTS.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    aria-current={current === item.id ? "location" : undefined}
                    className={cn("-ml-px block border-l py-1.5 pl-3.5 text-[13px] transition-colors", current === item.id ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink")}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <main className="flex min-w-0 flex-col gap-10">
            <Section
              id="what"
              title="What WealthOS is"
              lead="A place to see your investments clearly. You tell it what you bought and sold; it works out everything else and explains it."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  { title: "It keeps the record", text: "Record each buy, sell and dividend, or import them from your broker's export. Your holdings, cost and profit are rebuilt from that record every time, so they are always consistent." },
                  { title: "It measures honestly", text: "Real yearly return, counting when each rupee went in. How bumpy the ride has been. How much rides on your largest few holdings. Each number has a one-line meaning beside it." },
                  { title: "It checks an idea first", text: "Thinking of buying or selling? Trade check tests the trend, the valuation, the business, the risk and the effect on your portfolio, and scores how the evidence stacks up." },
                  { title: "It lets you practise", text: "A paper account trades virtual money at real prices. Backtests and what-if tools show how a rule or a market fall would have played out." },
                ].map((item) => (
                  <div key={item.title} className="card p-5">
                    <h3 className="text-[15px] font-semibold tracking-tight text-ink">{item.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{item.text}</p>
                  </div>
                ))}
              </div>
              <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-2">
                What it is not: a broker, a tip service or a financial adviser. It will not tell you what to buy. It shows you the evidence, in words you can follow, and leaves the decision with you.
              </p>
            </Section>

            <Section id="start" title="Start in three steps" lead="Ten minutes is enough to see your own numbers.">
              <ol className="grid gap-4 md:grid-cols-3">
                {[
                  { title: "Open the demo, or sign up", text: "The demo workspace comes with sample portfolios at live prices, so every page has something to show. An account keeps your own portfolios private to you.", to: "/", link: "Open WealthOS" },
                  { title: "Record what you own", text: "Add your trades one at a time, or import a CSV. Zerodha and Groww exports are recognised automatically. Enter each trade as it happened.", to: "/transactions", link: "Go to Transactions" },
                  { title: "Read your dashboard", text: "What it is worth, how much of that is profit, what changed today and where the money sits. The ? button explains any page you are on.", to: "/", link: "Go to the Dashboard" },
                ].map((step, i) => (
                  <li key={step.title} className="card flex flex-col p-5">
                    <span className="num flex size-7 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{i + 1}</span>
                    <h3 className="mt-3 text-[15px] font-semibold tracking-tight text-ink">{step.title}</h3>
                    <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-2">{step.text}</p>
                    <AppLink to={step.to} className="mt-4">
                      {step.link}
                    </AppLink>
                  </li>
                ))}
              </ol>
            </Section>

            <Section
              id="trade-check"
              title="Check a trade before you make it"
              lead="Say what you are thinking of doing, for example buying 30 shares of a company. WealthOS runs it through every check, scores how the evidence stacks up and explains the result. Then you decide."
            >
              <SampleCheck />
              <div className="mt-6 grid gap-x-10 gap-y-6 md:grid-cols-2">
                <div>
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">What gets checked</h3>
                  <ul className="mt-2.5 flex flex-col gap-2 text-sm leading-relaxed text-ink-2">
                    {[
                      ["Trend", "which way the price has been heading, and how it compares with the market."],
                      ["Valuation", "whether the price is high or low for what the company earns."],
                      ["Business", "growth, profit on shareholders' money, debt, and profit over the years."],
                      ["Risk", "how widely the price swings, and what a bad day means in rupees for your order."],
                      ["Your portfolio", "how much would ride on this one stock and its sector afterwards."],
                      ["Timing", "results or a dividend cut-off coming up, and whether the order is easy to fill."],
                    ].map(([name, text]) => (
                      <li key={name}>
                        <span className="font-medium text-ink">{name}: </span>
                        {text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">Reading the confidence score</h3>
                  <ul className="mt-2.5 flex flex-col gap-2 text-sm leading-relaxed text-ink-2">
                    <li>It runs from 0 to 100. At 50 the checks are evenly split; higher means more of them support the trade.</li>
                    <li>It is calculated from the checks, the same way every time. AI explains the result when it is switched on, but never sets the number.</li>
                    <li>For a sale the same facts are read the other way round: a strong company is a reason to buy, and a reason not to sell.</li>
                    <li>It sums up evidence as it stands today. It is not a forecast of the price, and it cannot know your goals or how long you plan to hold.</li>
                  </ul>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
                <AppLink to="/lab/trade-check" primary>
                  {signedOut ? "Sign in to check a trade" : "Check a trade"}
                </AppLink>
                <AppLink to="/?guide=trade-check">Or be walked through one</AppLink>
              </div>
            </Section>

            <Section
              id="ask"
              title="Ask the market"
              lead="The Market page has an assistant you can ask in your own words. It answers in plain language, and every answer carries a confidence score with the evidence behind it."
            >
              <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
                <div>
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">Things you can ask</h3>
                  <ul className="mt-2.5 flex flex-col gap-2">
                    {[
                      "What happened in the market today, and why?",
                      "Which sectors did well? Which look strongest?",
                      "Is it a good time to invest in IT for the short term?",
                      "I have ₹50,000. Which sector, and which five companies?",
                      "How is Reliance doing? And for the long term?",
                    ].map((question) => (
                      <li key={question} className="w-fit rounded-2xl rounded-bl-md bg-surface-2 px-3.5 py-2 text-sm text-ink ring-1 ring-line">
                        {question}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">What you get back</h3>
                  <ul className="mt-2.5 flex flex-col gap-2 text-sm leading-relaxed text-ink-2">
                    <li><span className="font-medium text-ink">A score for everything: </span>the market as a whole, each of the 15 sectors and each of about 120 large and mid-sized companies, out of 100.</li>
                    <li><span className="font-medium text-ink">Two horizons: </span>a short-term score from how prices are behaving now, and a long-term one that adds the business and what it costs.</li>
                    <li><span className="font-medium text-ink">The working: </span>a card under each answer lists the checks behind the score. Open any of them to see what it found and what it measures.</li>
                    <li><span className="font-medium text-ink">The why: </span>with AI switched on, it reads the day's reports and says where each claim came from.</li>
                    <li><span className="font-medium text-ink">A next step: </span>from a ranked company, one tap runs a trade check on buying it, against your own portfolio.</li>
                  </ul>
                </div>
              </div>
              <p className="mt-5 max-w-2xl text-sm leading-relaxed text-ink-2">
                It will not tell you to buy or sell, promise a return or name a price target. Short-term moves in particular are hard to call: a score reads how things stand today, not where they go next.
              </p>
              <AppLink to="/market" primary className="mt-5">
                {signedOut ? "Sign in to ask the market" : "Ask the market"}
              </AppLink>
            </Section>

            <Section
              id="guide"
              title="The hands-on guide"
              lead="Short lessons inside the app. Each one points at a real control, says what it does and waits while you try it, so you learn the app by using it. It is offered on your first visit, and “Take the tour” in the menu brings it back."
            >
              <ol className="grid gap-3 md:grid-cols-2">
                {LESSONS.map((lesson, i) => (
                  <li key={lesson.id} className="card flex items-start gap-3 p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                      <lesson.icon className="size-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-ink">
                        {i + 1}. {lesson.title}
                      </h3>
                      <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{lesson.summary}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span className="text-xs text-muted">
                          {lesson.steps.length} steps · about {lesson.minutes} min
                        </span>
                        <AppLink to={`/?guide=${lesson.id}`}>Start this lesson</AppLink>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="mt-4 flex items-start gap-2 text-[13px] leading-relaxed text-muted">
                <Compass className="mt-px size-4 shrink-0" aria-hidden />
                Nothing in a lesson places a real trade. On any page, the ? button at the top explains that page.
              </p>
            </Section>

            <Section
              id="install"
              title="Get the app"
              lead="WealthOS installs straight from this site onto a phone, a tablet or a computer. It gets its own icon, opens in its own window and keeps itself up to date. There is nothing to find in an app store, and it is the same WealthOS with the same account."
            >
              {installer.installed || installer.onDevice ? (
                <p className="flex w-fit items-start gap-2 rounded-xl bg-gain-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
                  <Check className="mt-px size-4 shrink-0 text-gain" aria-hidden />
                  {installer.installed ? "You are using the installed app." : "WealthOS is installed on this device: open it from your list of apps or home screen."} The steps below are for your other devices.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <InstallButton variant="primary" size="lg" />
                  <p className="max-w-md text-[13px] leading-relaxed text-ink-2">
                    On Android, and in Chrome or Edge on a computer, this button installs it. An Android phone takes up to a minute to finish, and the app then appears in your list of apps. On an iPhone or iPad the button shows the steps, because Apple leaves that to you.
                  </p>
                </div>
              )}
              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {(["ios", "android", "computer"] as const).map((kind) => (
                  <div key={kind} className="card flex flex-col p-5">
                    <h3 className="text-[15px] font-semibold tracking-tight text-ink">{INSTALL_GUIDES[kind].heading}</h3>
                    <InstallSteps kind={kind} className="mt-4 flex-1" />
                    <p className="mt-4 border-t border-line pt-3.5 text-xs leading-relaxed text-muted">{INSTALL_GUIDES[kind].note}</p>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="sections" title="Every section" lead="Each page answers one question. This is the same guide the ? button opens inside the app.">
              <div className="flex flex-col gap-8">
                {GROUPS.map((group) => (
                  <div key={group}>
                    <h3 className="mb-3 text-[11px] font-medium uppercase tracking-wider text-muted">{group}</h3>
                    <div className="grid items-start gap-4 md:grid-cols-2">
                      {SECTIONS.filter((s) => s.group === group).map((section) => (
                        <SectionCard key={section.id} section={section} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section id="words" title="Words you will meet" lead="Investing has its own vocabulary. These are the terms the app uses, each in one line.">
              <dl className="grid gap-x-10 gap-y-4 md:grid-cols-2">
                {words.map((w) => (
                  <div key={w.term}>
                    <dt className="text-sm font-medium text-ink">{w.term}</dt>
                    <dd className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{w.meaning}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            <Section id="numbers" title="How the numbers are worked out" lead="Nothing is a black box. These are the rules behind the main figures.">
              <dl className="flex flex-col divide-y divide-line">
                {NUMBERS.map((n) => (
                  <div key={n.term} className="grid gap-x-8 gap-y-1 py-3.5 first:pt-0 last:pb-0 sm:grid-cols-[200px_minmax(0,1fr)]">
                    <dt className="text-sm font-medium text-ink">{n.term}</dt>
                    <dd className="text-sm leading-relaxed text-ink-2">{n.text}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            <Section id="questions" title="Questions people ask">
              <div className="flex flex-col divide-y divide-line">
                {QUESTIONS.map((item) => (
                  <div key={item.q} className="py-4 first:pt-0 last:pb-0">
                    <h3 className="text-[15px] font-semibold tracking-tight text-ink">{item.q}</h3>
                    <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink-2">{item.a}</p>
                  </div>
                ))}
              </div>
            </Section>

            <div className="card flex flex-wrap items-center justify-between gap-x-8 gap-y-4 p-6">
              <div className="min-w-0">
                <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-ink">
                  <ClipboardCheck className="size-5 text-accent" aria-hidden /> Ready to try it?
                </h2>
                <p className="mt-1 text-sm text-ink-2">The demo workspace needs no account and has every feature switched on.</p>
              </div>
              <AppLink to="/" primary>
                {signedOut ? "Sign in or open the demo" : "Open the app"}
              </AppLink>
            </div>

            <p className="text-xs leading-relaxed text-muted">
              WealthOS is a tracking and analysis tool. Nothing in it, or on this page, is investment advice or a recommendation to buy or sell. Market data is delayed and comes from a third party; check anything that matters before you act on it.
            </p>
          </main>
        </div>
      </div>
    </div>
  );
}
