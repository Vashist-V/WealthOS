/**
 * The front door: what a visitor sees at "/" before signing in, and at
 * "/welcome" any time.
 *
 * Design notes. The brand is forest and gold at full strength: a deep forest
 * hero lit by a slow gold-and-green glow, the product itself as the hero image
 * (a faithful app window that tilts back and settles as you scroll, crossing
 * from the dark band onto the page), then the product's main jobs as large
 * alternating scenes. Every product picture is drawn in code at a fixed design
 * size and scaled to fit its space (`Fit`), so it looks the same, and never
 * overlaps itself, at any screen width. Every figure in a picture is a sample
 * and says so; the copy claims only what the app does.
 */
import {
  ArrowLeftRight, ArrowRight, BarChart3, BellRing, BookOpen, Camera, Check, ClipboardCheck, Eye, FileSpreadsheet, Gauge, Globe, IndianRupee,
  Layers, LayoutDashboard, LineChart, LockKeyhole, MessageSquareText, Moon, Newspaper, Plus, Search, ShieldCheck, Smartphone, Sparkles, Star,
  Target, TrendingDown, TrendingUp, Wallet, type LucideIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Brand } from "@/components/layout/AppShell";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

// =============================================================== utilities
/** Draws `children` at a fixed design size and scales it down to the space it is given, centred. */
function Fit({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, left: 0 });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const room = el.clientWidth;
      const scale = Math.min(1, room / width);
      setView({ scale, left: Math.max(0, (room - width * scale) / 2) });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [width]);
  return (
    <div ref={box} className={cn("relative w-full", className)} style={{ height: height * view.scale }}>
      <div className="absolute top-0 origin-top-left" style={{ width, height, left: view.left, transform: `scale(${view.scale})` }}>
        {children}
      </div>
    </div>
  );
}

/** Things marked `data-reveal` that start below the fold rise into place as they scroll into view. Nothing is hidden without this. */
function useReveal(root: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = root.current;
    if (!el || !("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const seen = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.reveal = "shown";
          seen.unobserve(entry.target);
        }),
      { rootMargin: "0px 0px -6% 0px", threshold: 0.05 },
    );
    el.querySelectorAll<HTMLElement>("[data-reveal]").forEach((item) => {
      if (item.getBoundingClientRect().top > window.innerHeight * 0.92) {
        item.dataset.reveal = "pending";
        seen.observe(item);
      }
    });
    return () => seen.disconnect();
  }, [root]);
}

/** A small seeded random walk, so the sample charts look like markets and never change between visits. */
function walk(seed: number, points: number, drift: number, swing: number): number[] {
  let s = seed;
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [0];
  for (let i = 1; i < points; i++) out.push(out[i - 1] + drift + (next() - 0.5) * swing);
  return out;
}

function chart(values: number[], w: number, h: number, pad = 6): { line: string; area: string } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const line = values
    .map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * w).toFixed(1)} ${(h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2)).toFixed(1)}`)
    .join(" ");
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}

const VALUE_CHART = chart(walk(11, 96, 0.55, 5.2), 600, 168, 10);
const PHONE_CHART = chart(walk(11, 60, 0.55, 5.2), 260, 84, 6);
const sparkline = (seed: number, up: boolean) => chart(walk(seed, 28, up ? 0.32 : -0.32, 2.4), 84, 28, 3).line;

// ============================================================= small parts
/** A half-circle gauge, as the app draws the health score. */
function Arc({ value, width }: { value: number; width: number }) {
  const length = Math.PI * 46;
  return (
    <svg viewBox="0 0 120 66" width={width} height={(width * 66) / 120} aria-hidden>
      <defs>
        <linearGradient id="arc-ink" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#1f6e52" />
          <stop offset="1" stopColor="#3fae7d" />
        </linearGradient>
      </defs>
      <path d="M14 60 A46 46 0 0 1 106 60" fill="none" stroke="#ece9ef" strokeWidth="9" strokeLinecap="round" />
      <path d="M14 60 A46 46 0 0 1 106 60" fill="none" stroke="url(#arc-ink)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(value / 100) * length} ${length}`} />
    </svg>
  );
}

/** A full ring, as the trade check shows its score. */
function Ring({ value, size }: { value: number; size: number }) {
  const c = 2 * Math.PI * 50;
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
      <defs>
        <linearGradient id="ring-ink" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#1f6e52" />
          <stop offset="1" stopColor="#c8a33a" />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="50" fill="none" stroke="#ece9ef" strokeWidth="11" />
      <circle cx="60" cy="60" r="50" fill="none" stroke="url(#ring-ink)" strokeWidth="11" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} transform="rotate(-90 60 60)" />
    </svg>
  );
}

function Tag({ tone, children, className }: { tone: "good" | "bad" | "gold" | "plain"; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-[3px] text-[11px] font-semibold leading-none",
        tone === "good" && "bg-[#e3f5ec] text-[#0a7c4a]",
        tone === "bad" && "bg-[#fbe9ec] text-[#b3243a]",
        tone === "gold" && "bg-[#f8f0da] text-[#7a5f13]",
        tone === "plain" && "bg-[#f1eef3] text-[#3d4643]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A white card inside a product picture. */
const PANEL = "rounded-[18px] bg-white ring-1 ring-black/[0.06] shadow-[0_1px_2px_rgba(14,32,25,0.05),0_18px_40px_-22px_rgba(14,32,25,0.28)]";

function Initials({ symbol }: { symbol: string }) {
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#e6efea] text-[10px] font-bold text-[#0f3b2d]">{symbol.slice(0, 2)}</span>;
}

// ======================================================= the app, pictured
function MockRail() {
  const groups: [string, [LucideIcon, string, boolean?][]][] = [
    ["Portfolio", [[LayoutDashboard, "Dashboard", true], [Layers, "Holdings"], [ArrowLeftRight, "Transactions"], [Wallet, "Portfolios"]]],
    ["Analytics", [[BarChart3, "Allocation"], [Gauge, "Risk"], [LineChart, "Compare"]]],
    ["Markets", [[Globe, "Market"], [Newspaper, "News"], [Star, "Watchlists"]]],
  ];
  return (
    <div className="flex w-[212px] shrink-0 flex-col gap-5 bg-[#0f3b2d] px-3.5 py-4 text-[#eef4f0]">
      <div className="flex items-center gap-2.5 px-1.5">
        <img src="/logo-mark.png" alt="" className="size-7 rounded-[22%]" />
        <span className="text-[15px] font-semibold tracking-tight">
          Wealth<span className="rail-brand-ink">OS</span>
        </span>
      </div>
      <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.06] px-2.5 py-2 ring-1 ring-inset ring-white/15">
        <span className="flex size-7 items-center justify-center rounded-lg bg-[#c8a33a] text-[#1f1804]">
          <ClipboardCheck className="size-3.5" />
        </span>
        <span>
          <span className="block text-[12px] font-semibold leading-tight">Check a trade</span>
          <span className="block text-[10px] leading-tight text-[#9dbcae]">Before you buy or sell</span>
        </span>
      </div>
      {groups.map(([title, items]) => (
        <div key={title}>
          <div className="mb-1 px-2 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-[#9dbcae]/75">{title}</div>
          {items.map(([Icon, label, active]) => (
            <div key={label} className={cn("relative flex h-8 items-center gap-2.5 rounded-lg px-2 text-[12px] font-medium", active ? "bg-white/[0.11] text-white" : "text-[#9dbcae]")}>
              {active && <span className="absolute inset-y-1.5 -left-3.5 w-[3px] rounded-r-full bg-[#c8a33a]" />}
              <Icon className={cn("size-3.5", active && "text-[#c8a33a]")} />
              {label}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function MockTopbar() {
  return (
    <div className="flex h-[58px] shrink-0 items-center gap-3 border-b border-[#ece9ef] bg-white/70 px-6">
      <div className="flex h-8 items-center gap-2 rounded-lg px-2.5 text-[12px] font-semibold text-[#111614] ring-1 ring-[#e4e1e7]">
        <span className="size-2 rounded-full bg-[#2f8a63]" /> Long-Term Investments
      </div>
      <div className="flex h-8 w-[260px] items-center gap-2 rounded-lg bg-[#f6f3f7] px-3 text-[12px] text-[#9c9ea2] ring-1 ring-[#ece9ef]">
        <Search className="size-3.5" /> Search stocks or jump to…
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="flex h-8 items-center gap-1.5 rounded-lg bg-[#e6efea] px-2.5 text-[12px] font-semibold text-[#0f3b2d] ring-1 ring-[#a7c7b7]/60">
          <ClipboardCheck className="size-3.5" /> Check a trade
        </span>
        <span className="flex h-8 items-center gap-1.5 rounded-lg bg-[#0f3b2d] px-3 text-[12px] font-semibold text-white">
          <Plus className="size-3.5" /> Add transaction
        </span>
        <span className="size-8 rounded-full bg-[linear-gradient(140deg,#e6efea,#f8f0da)] ring-1 ring-[#e4e1e7]" />
      </div>
    </div>
  );
}

const HOLDINGS: [string, string, string, string, boolean, number][] = [
  ["RELIANCE", "Reliance Industries", "₹1,37,750", "+1.42%", true, 21],
  ["HDFCBANK", "HDFC Bank", "₹84,600", "+0.61%", true, 34],
  ["BHARTIARTL", "Bharti Airtel", "₹97,277", "+0.83%", true, 8],
  ["TCS", "Tata Consultancy Services", "₹71,286", "−0.94%", false, 52],
];

/** The dashboard, drawn at 1200 × 740. */
function DashboardMock() {
  return (
    <div className="flex h-[740px] w-[1200px] flex-col overflow-hidden rounded-[16px] bg-white text-[#111614]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[#ebe7ee] bg-[#f4f1f6] px-4">
        {["#ec6a5e", "#f4bf4f", "#61c554"].map((c) => (
          <span key={c} className="size-3 rounded-full" style={{ background: c }} />
        ))}
        <div className="mx-auto flex h-7 w-[340px] items-center justify-center gap-2 rounded-lg bg-white text-[12px] text-[#6a716e] ring-1 ring-[#e7e3ea]">
          <LockKeyhole className="size-3" /> WealthOS · Dashboard
        </div>
        <div className="w-[52px]" />
      </div>
      <div className="flex min-h-0 flex-1">
        <MockRail />
        <div className="flex min-w-0 flex-1 flex-col bg-[#faf7fc]">
          <MockTopbar />
          <div className="flex-1 overflow-hidden px-7 pt-6">
            <div className="flex items-end justify-between">
              <div>
                <div className="font-display text-[40px] leading-none">Dashboard</div>
                <div className="mt-2 text-[13px] text-[#6a716e]">Long-Term Investments · 28 transactions since Jan 2024</div>
              </div>
              <div className="flex items-center gap-2">
                <Tag tone="good" className="px-2 py-1.5 text-[12px]"><TrendingUp className="size-3.5" /> Up 18.4% this year</Tag>
                <Tag tone="gold" className="px-2 py-1.5 text-[12px]"><Sparkles className="size-3.5" /> 3 things worth knowing</Tag>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-[1.62fr_1fr] gap-4">
              <div className={cn(PANEL, "p-5")}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-[12px] font-medium text-[#6a716e]">Current value</div>
                    <div className="num mt-1 text-[40px] font-semibold leading-none tracking-[-0.035em]">₹8,84,165</div>
                    <div className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#0a7c4a]">
                      <TrendingUp className="size-4" /> +₹4,220 (+0.48%) <span className="font-normal text-[#6a716e]">today</span>
                    </div>
                  </div>
                  <div className="flex rounded-lg bg-[#f6f3f7] p-0.5 text-[11px] font-semibold text-[#6a716e] ring-1 ring-[#ece9ef]">
                    {["1M", "6M", "YTD", "1Y", "5Y"].map((r) => (
                      <span key={r} className={cn("rounded-md px-2 py-1", r === "1Y" && "bg-white text-[#111614] shadow-sm ring-1 ring-[#ece9ef]")}>{r}</span>
                    ))}
                  </div>
                </div>
                <svg viewBox="0 0 600 168" preserveAspectRatio="none" className="mt-4 h-[168px] w-full" aria-hidden>
                  <defs>
                    <linearGradient id="mock-fill" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0" stopColor="#1f6e52" stopOpacity="0.2" />
                      <stop offset="1" stopColor="#1f6e52" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  {[34, 84, 134].map((y) => (
                    <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#f0edf2" />
                  ))}
                  <path d={VALUE_CHART.area} fill="url(#mock-fill)" />
                  <path d="M0 150 C150 146 260 132 360 122 S520 102 600 96" fill="none" stroke="#c8a33a" strokeWidth="1.6" strokeDasharray="5 5" vectorEffect="non-scaling-stroke" />
                  <path d={VALUE_CHART.line} fill="none" stroke="#1f6e52" strokeWidth="2.4" vectorEffect="non-scaling-stroke" />
                </svg>
                <div className="mt-2 flex gap-5 text-[11px] text-[#6a716e]">
                  <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded bg-[#1f6e52]" /> Portfolio value</span>
                  <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-[#c8a33a]" /> Amount invested</span>
                </div>
              </div>

              <div className={cn(PANEL, "flex flex-col p-5")}>
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold">Portfolio health</span>
                  <span className="text-[11px] text-[#6a716e]">How it is built</span>
                </div>
                <div className="relative mx-auto mt-4">
                  <Arc value={94} width={236} />
                  <div className="absolute inset-x-0 bottom-0 text-center">
                    <div className="num text-[46px] font-semibold leading-none tracking-[-0.03em]">94</div>
                    <div className="mt-1 text-[11px] text-[#6a716e]">out of 100</div>
                  </div>
                </div>
                <div className="mt-4 text-center text-[14px] font-semibold text-[#0a7c4a]">In good shape</div>
                <div className="mt-auto flex justify-center gap-4 pt-4 text-[11px] text-[#3d4643]">
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#2f8a63]" /> 9 going well</span>
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#c8a33a]" /> 1 between</span>
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-[#d0d3d1]" /> 0 to watch</span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-[1.62fr_1fr] gap-4">
              <div className={cn(PANEL, "p-5")}>
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-semibold">Holdings</span>
                  <span className="text-[12px] font-semibold text-[#0f3b2d]">View all →</span>
                </div>
                <div className="mt-3 flex flex-col">
                  {HOLDINGS.map(([sym, name, value, change, up, seed]) => (
                    <div key={sym} className="grid grid-cols-[1.7fr_100px_1fr_80px] items-center gap-3 border-t border-[#f1eef3] py-2.5 first:border-t-0">
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Initials symbol={sym} />
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold leading-tight">{sym}</span>
                          <span className="block truncate text-[11px] text-[#6a716e]">{name}</span>
                        </span>
                      </span>
                      <svg viewBox="0 0 84 28" className="h-7 w-[84px]" aria-hidden>
                        <path d={sparkline(seed, up)} fill="none" stroke={up ? "#2f8a63" : "#c2384c"} strokeWidth="1.6" />
                      </svg>
                      <span className="num text-right text-[13px] font-semibold">{value}</span>
                      <span className={cn("num text-right text-[12px] font-semibold", up ? "text-[#0a7c4a]" : "text-[#b3243a]")}>{change}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={cn(PANEL, "p-5")}>
                <div className="flex items-center gap-2 text-[14px] font-semibold">
                  <Newspaper className="size-4 text-[#1f6e52]" /> News about your stocks
                </div>
                <div className="mt-3 flex flex-col gap-3">
                  {[
                    ["good", "New order", "Large contract adds to the order book", "LT"],
                    ["good", "Profit up", "Quarterly profit beats expectations", "HDFCBANK"],
                    ["bad", "Target cut", "Brokerage trims its price target", "TCS"],
                  ].map(([tone, why, title, sym]) => (
                    <div key={title} className="relative pl-3">
                      <span className={cn("absolute inset-y-0.5 left-0 w-[3px] rounded-full", tone === "good" ? "bg-[#2f8a63]" : "bg-[#c2384c]")} />
                      <div className="flex items-center gap-1.5">
                        <Tag tone={tone as "good" | "bad"}>{tone === "good" ? "Good" : "Bad"}</Tag>
                        <span className="text-[11px] font-medium text-[#3d4643]">{why}</span>
                      </div>
                      <div className="mt-1 truncate text-[12.5px] font-semibold">{title}</div>
                      <div className="mt-0.5 text-[10.5px] text-[#9c9ea2]">{sym} · You hold this</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The same dashboard on a phone, drawn at 300 × 640 including the frame. */
function PhoneMock() {
  return (
    <div className="w-[300px] rounded-[46px] bg-[#0b1611] p-[9px] shadow-[0_50px_90px_-30px_rgba(0,0,0,0.75)] ring-1 ring-white/15">
      <div className="relative h-[622px] overflow-hidden rounded-[38px] bg-[#faf7fc] text-[#111614]">
        <div className="absolute left-1/2 top-2 h-[22px] w-[88px] -translate-x-1/2 rounded-full bg-[#0b1611]" />
        <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm bg-[#111614]" />
            <span className="h-2.5 w-5 rounded-[3px] ring-1 ring-[#111614]" />
          </span>
        </div>
        <div className="mt-4 px-4">
          <div className="flex items-center justify-between">
            <span className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold ring-1 ring-[#e4e1e7]">
              <span className="size-1.5 rounded-full bg-[#2f8a63]" /> Long-Term
            </span>
            <span className="size-7 rounded-full bg-[linear-gradient(140deg,#e6efea,#f8f0da)] ring-1 ring-[#e4e1e7]" />
          </div>
          <div className="mt-3 flex h-9 items-center gap-2 rounded-full bg-white px-3.5 text-[11.5px] text-[#9c9ea2] ring-1 ring-[#0f3b2d]/25">
            <Search className="size-3.5 text-[#1f6e52]" /> Search stocks, e.g. TCS
          </div>
          <div className="mt-4 font-display text-[28px] leading-none">Dashboard</div>
          <div className={cn(PANEL, "mt-3 p-3.5")}>
            <div className="text-[10.5px] text-[#6a716e]">Current value</div>
            <div className="num text-[26px] font-semibold leading-tight tracking-[-0.03em]">₹8,84,165</div>
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#0a7c4a]">
              <TrendingUp className="size-3" /> +₹4,220 (+0.48%) <span className="font-normal text-[#6a716e]">today</span>
            </div>
            <svg viewBox="0 0 260 84" preserveAspectRatio="none" className="mt-2 h-[70px] w-full" aria-hidden>
              <path d={PHONE_CHART.area} fill="#1f6e52" fillOpacity="0.12" />
              <path d={PHONE_CHART.line} fill="none" stroke="#1f6e52" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-2.5">
            <div className={cn(PANEL, "p-3")}>
              <div className="text-[10.5px] font-semibold">Health</div>
              <div className="relative mt-1 flex justify-center">
                <Arc value={94} width={96} />
                <span className="num absolute bottom-0 text-[17px] font-semibold leading-none">94</span>
              </div>
              <div className="mt-1 text-center text-[10px] font-semibold text-[#0a7c4a]">In good shape</div>
            </div>
            <div className={cn(PANEL, "p-3")}>
              <div className="text-[10.5px] font-semibold">News</div>
              <div className="mt-2 flex flex-col gap-1.5">
                <Tag tone="good" className="w-fit">Good · LT</Tag>
                <Tag tone="good" className="w-fit">Good · INFY</Tag>
                <Tag tone="bad" className="w-fit">Bad · TCS</Tag>
              </div>
            </div>
          </div>
          <div className={cn(PANEL, "mt-2.5 px-3 py-1")}>
            {HOLDINGS.slice(0, 3).map(([sym, , value, change, up]) => (
              <div key={sym} className="flex items-center gap-2.5 border-t border-[#f1eef3] py-2 first:border-t-0">
                <Initials symbol={sym} />
                <span className="flex-1 text-[11.5px] font-semibold">{sym}</span>
                <span className="text-right">
                  <span className="num block text-[11.5px] font-semibold">{value}</span>
                  <span className={cn("num block text-[10px] font-semibold", up ? "text-[#0a7c4a]" : "text-[#b3243a]")}>{change}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 flex h-[62px] items-center justify-around border-t border-[#ece9ef] bg-white/90 px-4 backdrop-blur">
          <LayoutDashboard className="size-[18px] text-[#0f3b2d]" />
          <Layers className="size-[18px] text-[#9c9ea2]" />
          <span className="flex size-10 items-center justify-center rounded-full bg-[#0f3b2d] text-white shadow-[0_8px_18px_-6px_rgba(15,59,45,0.7)]">
            <Plus className="size-5" />
          </span>
          <Globe className="size-[18px] text-[#9c9ea2]" />
          <ClipboardCheck className="size-[18px] text-[#9c9ea2]" />
        </div>
      </div>
    </div>
  );
}

// ================================================================ scenes
/** Screenshot to trades, drawn at 520 × 440. */
function ImportScene() {
  return (
    <div className="relative h-[440px] w-[520px] text-[#111614]">
      <div className="absolute left-2 top-3 w-[196px] rounded-[34px] bg-[#0b1611] p-[7px] shadow-[0_30px_60px_-24px_rgba(14,32,25,0.55)]">
        <div className="h-[406px] overflow-hidden rounded-[28px] bg-white px-3.5 pt-7">
          <div className="text-[17px] font-bold tracking-tight">Orders</div>
          <div className="mt-2 flex gap-3 border-b border-[#eeebf0] text-[10.5px] font-semibold">
            <span className="border-b-2 border-[#111614] pb-1.5">Stocks</span>
            <span className="pb-1.5 text-[#9c9ea2]">Mutual funds</span>
          </div>
          {[
            ["Infosys", "BUY", "5", "₹1,104.25", "Executed"],
            ["HDFC Bank", "BUY", "10", "₹838.60", "Executed"],
            ["Tata Consultancy", "SELL", "2", "₹2,398.40", "Executed"],
            ["ITC", "BUY", "20", "₹298.10", "Cancelled"],
          ].map(([name, side, qty, price, status]) => (
            <div key={name} className="border-b border-[#f3f0f5] py-2.5">
              <div className="flex justify-between text-[11.5px] font-semibold">
                <span className="truncate pr-2">{name}</span>
                <span className="num">{price}</span>
              </div>
              <div className="mt-0.5 flex justify-between text-[10px]">
                <span className={cn("font-bold", side === "BUY" ? "text-[#0a7c4a]" : "text-[#b3243a]")}>
                  {side} <span className="font-medium text-[#9c9ea2]">· {qty} shares</span>
                </span>
                <span className={status === "Executed" ? "font-medium text-[#0a7c4a]" : "text-[#9c9ea2]"}>{status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <span className="absolute left-[222px] top-[22px] inline-flex items-center gap-1.5 rounded-full bg-[#0f3b2d] px-3 py-1.5 text-[11.5px] font-semibold text-[#e8d28e] shadow-[0_10px_24px_-10px_rgba(15,59,45,0.8)]">
        <Sparkles className="size-3.5" /> Read by AI
      </span>
      <svg className="absolute left-[200px] top-[150px]" width="70" height="80" viewBox="0 0 70 80" aria-hidden>
        <path d="M4 40 C24 40 34 40 58 40" fill="none" stroke="#c8a33a" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" />
        <path d="M52 33 L60 40 L52 47" fill="none" stroke="#c8a33a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <div className={cn(PANEL, "absolute right-2 top-[66px] w-[254px] p-4")}>
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold">Found 3 trades</span>
          <Tag tone="gold">1 to check</Tag>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {[
            ["INFY", "Buy", "5", "₹1,104.25", false],
            ["HDFCBANK", "Buy", "10", "₹838.60", true],
            ["TCS", "Sell", "2", "₹2,398.40", false],
          ].map(([sym, side, qty, price, flag]) => (
            <div key={sym as string} className={cn("grid grid-cols-[1fr_34px_22px_auto] items-center gap-2 rounded-xl px-2.5 py-2 text-[11.5px] ring-1", flag ? "bg-[#fdf8ea] ring-[#e5d29b]" : "bg-[#faf8fb] ring-[#efecf1]")}>
              <span className="font-semibold">{sym}</span>
              <span className={side === "Buy" ? "font-semibold text-[#0a7c4a]" : "font-semibold text-[#b3243a]"}>{side}</span>
              <span className="num text-right text-[#3d4643]">{qty}</span>
              <span className={cn("num text-right", flag ? "font-semibold text-[#7a5f13]" : "text-[#3d4643]")}>{price}</span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 flex gap-1.5 text-[10.5px] leading-snug text-[#7a5f13]">
          <Eye className="mt-px size-3 shrink-0" /> HDFCBANK traded ₹804–822 that day. Check the price.
        </p>
        <p className="mt-1.5 text-[10.5px] text-[#9c9ea2]">Cancelled ITC order left out.</p>
        <div className="mt-3 flex h-9 items-center justify-center rounded-xl bg-[#0f3b2d] text-[12px] font-semibold text-white">Save 3 trades</div>
      </div>
    </div>
  );
}

/** Health score and why it moved, drawn at 520 × 440. */
function HealthScene() {
  return (
    <div className="relative grid h-[440px] w-[520px] grid-cols-[296px_1fr] gap-3.5 p-2 text-[#111614]">
      <div className={cn(PANEL, "flex flex-col p-5")}>
        <div className="flex items-center gap-2 text-[13px] font-semibold">
          <Gauge className="size-4 text-[#1f6e52]" /> Portfolio health
        </div>
        <div className="relative mx-auto mt-5">
          <Arc value={82} width={220} />
          <div className="absolute inset-x-0 bottom-0 text-center">
            <div className="num text-[44px] font-semibold leading-none tracking-[-0.03em]">82</div>
            <div className="mt-1 text-[11px] text-[#6a716e]">out of 100</div>
          </div>
        </div>
        <div className="mt-4 text-center text-[13.5px] font-semibold text-[#0a7c4a]">In good shape</div>
        <div className="mt-5 flex flex-col gap-2.5 text-[12px] text-[#3d4643]">
          <span className="flex items-center gap-2"><Check className="size-4 text-[#0a7c4a]" /> Spread across 9 sectors</span>
          <span className="flex items-center gap-2"><Check className="size-4 text-[#0a7c4a]" /> Steadier than the NIFTY this year</span>
          <span className="flex items-center gap-2"><Eye className="size-4 text-[#a2520a]" /> Banks are 31% of the portfolio</span>
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        <div className={cn(PANEL, "p-4")}>
          <div className="text-[12.5px] font-semibold">Why it moved today</div>
          <div className="mt-3 flex flex-col gap-2.5">
            {[
              ["RELIANCE", "+₹1,920", 82, true],
              ["HDFCBANK", "+₹540", 30, true],
              ["TCS", "−₹610", 34, false],
            ].map(([sym, amount, width, up]) => (
              <div key={sym as string}>
                <div className="flex justify-between text-[10.5px] font-semibold">
                  <span>{sym}</span>
                  <span className={cn("num", up ? "text-[#0a7c4a]" : "text-[#b3243a]")}>{amount}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[#f0edf2]">
                  <div className={cn("h-full rounded-full", up ? "bg-[linear-gradient(90deg,#1f6e52,#3fae7d)]" : "bg-[#e0707f]")} style={{ width: `${width}%` }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 rounded-lg bg-[#f6f3f7] px-2.5 py-2 text-[10.5px] leading-snug text-[#3d4643]">
            About <span className="font-semibold text-[#0f3b2d]">60%</span> of today's rise was the market itself.
          </p>
        </div>
        <div className={cn(PANEL, "flex-1 p-4")}>
          <div className="text-[12.5px] font-semibold">Worth knowing today</div>
          <div className="mt-3 flex flex-col gap-2.5 text-[11px] leading-snug text-[#3d4643]">
            <span className="flex gap-2"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#c8a33a]" /> Results from INFY on Thursday</span>
            <span className="flex gap-2"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#2f8a63]" /> ITC pays its dividend next week</span>
            <span className="flex gap-2"><span className="mt-1 size-1.5 shrink-0 rounded-full bg-[#c2384c]" /> TCS is near its one-year low</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A trade, checked before it is made, drawn at 520 × 440. */
function TradeScene() {
  const groups: [string, number, string][] = [
    ["Trend", 82, "Rising above its averages"],
    ["Valuation", 44, "Priced above its sector"],
    ["Business", 76, "Profits growing steadily"],
    ["Risk", 63, "Swings less than most"],
    ["Fit", 70, "Adds a new sector"],
  ];
  return (
    <div className="relative h-[440px] w-[520px] p-2 text-[#111614]">
      <div className={cn(PANEL, "h-full p-6")}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[#6a716e]">
              <ClipboardCheck className="size-4 text-[#1f6e52]" /> Trade check
            </div>
            <div className="mt-1 text-[20px] font-semibold tracking-[-0.02em]">Buy 30 HEROMOTOCO</div>
          </div>
          <Tag tone="plain" className="px-2 py-1.5 text-[11.5px]">in Long-Term</Tag>
        </div>
        <div className="mt-5 grid grid-cols-[150px_1fr] items-center gap-6">
          <div className="relative flex items-center justify-center">
            <Ring value={68} size={150} />
            <div className="absolute text-center">
              <div className="num text-[40px] font-semibold leading-none tracking-[-0.03em]">68</div>
              <div className="mt-1 text-[10.5px] font-semibold text-[#0a7c4a]">Leans positive</div>
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {groups.map(([name, score, note]) => (
              <div key={name}>
                <div className="flex justify-between text-[11px]">
                  <span className="font-semibold">{name}</span>
                  <span className="text-[#6a716e]">{note}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-[#f0edf2]">
                  <div className={cn("h-full rounded-full", score >= 55 ? "bg-[linear-gradient(90deg,#1f6e52,#3fae7d)]" : "bg-[#d4a843]")} style={{ width: `${score}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 rounded-2xl bg-[#f6f3f7] p-4">
          <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#0f3b2d]">
            <Sparkles className="size-3.5 text-[#c8a33a]" /> In plain words
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#3d4643]">
            A rising trend and steady profits count for this buy. The price, above what the sector usually pays, counts against it.
          </p>
        </div>
      </div>
    </div>
  );
}

/** News marked for each stock, drawn at 520 × 440. */
function NewsScene() {
  return (
    <div className="relative grid h-[440px] w-[520px] grid-cols-[1fr_188px] gap-3.5 p-2 text-[#111614]">
      <div className={cn(PANEL, "p-4")}>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-[13px] font-semibold">
            <Newspaper className="size-4 text-[#1f6e52]" /> News
          </span>
          <span className="flex gap-1">
            <Tag tone="good">Good 231</Tag>
            <Tag tone="bad">Bad 84</Tag>
          </span>
        </div>
        <div className="mt-3 flex flex-col">
          {[
            ["good", "Big news", "Wins a large export order", "HEROMOTOCO", "2h"],
            ["good", "", "Quarterly profit beats estimates", "HDFCBANK", "5h"],
            ["bad", "", "Brokerage trims its price target", "TCS", "7h"],
            ["good", "", "New plant to raise capacity", "ASHOKLEY", "9h"],
          ].map(([tone, big, title, sym, ago]) => (
            <div key={title} className="relative border-t border-[#f1eef3] py-3 pl-3 first:border-t-0">
              <span className={cn("absolute inset-y-3 left-0 w-[3px] rounded-full", tone === "good" ? "bg-[#2f8a63]" : "bg-[#c2384c]")} />
              <div className="flex items-center gap-1.5">
                <Tag tone={tone as "good" | "bad"}>
                  {tone === "good" ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />} {tone === "good" ? "Good" : "Bad"}
                </Tag>
                {big && <Tag tone="gold">{big}</Tag>}
              </div>
              <div className="mt-1.5 text-[12.5px] font-semibold leading-snug">{title}</div>
              <div className="mt-1 text-[10.5px] text-[#9c9ea2]">
                <span className="rounded bg-[#f6f3f7] px-1 py-px font-semibold text-[#3d4643]">{sym}</span> · {ago} ago
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#0a7c4a]">Good signs</div>
        {[
          ["HEROMOTOCO", 82, 9, 0],
          ["ASHOKLEY", 62, 7, 0],
        ].map(([sym, score, good, bad]) => (
          <div key={sym as string} className="rounded-2xl bg-[#effaf4] p-3 ring-1 ring-[#a6e2c3]">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-bold">{sym}</span>
              <span className="num rounded-md bg-[#0f8a52] px-1.5 py-0.5 text-[11px] font-bold text-white">{score}</span>
            </div>
            <div className="mt-1.5 text-[10.5px]">
              <span className="font-semibold text-[#0a7c4a]">{good} good</span> · <span className="text-[#b3243a]">{bad} bad</span>
            </div>
          </div>
        ))}
        <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#b3243a]">Needs watching</div>
        <div className="rounded-2xl bg-[#fdf1f3] p-3 ring-1 ring-[#f3bcc2]">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold">INDUSINDBK</span>
            <span className="num rounded-md bg-[#c2384c] px-1.5 py-0.5 text-[11px] font-bold text-white">38</span>
          </div>
          <div className="mt-1.5 text-[10.5px]">
            <span className="text-[#0a7c4a]">2 good</span> · <span className="font-semibold text-[#b3243a]">10 bad</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ================================================================== page
function GoldButton({ children, onClick, className }: { children: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative inline-flex h-[52px] items-center gap-2 overflow-hidden whitespace-nowrap rounded-full bg-[linear-gradient(180deg,#e2c463,#c8a33a)] px-7 text-[15.5px] font-semibold text-[#1f1804]",
        "shadow-[0_16px_40px_-12px_rgba(200,163,58,0.75),inset_0_1px_0_rgba(255,255,255,0.5)] transition-[translate,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_22px_48px_-12px_rgba(200,163,58,0.85),inset_0_1px_0_rgba(255,255,255,0.5)] active:translate-y-0",
        className,
      )}
    >
      <span className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/3 -skew-x-12 bg-white/35 opacity-0 blur-md transition-all duration-700 group-hover:left-[120%] group-hover:opacity-100" />
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </button>
  );
}

function GlassButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-[52px] items-center gap-2 whitespace-nowrap rounded-full bg-white/[0.06] px-7 text-[15.5px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur transition-colors hover:bg-white/[0.11]"
    >
      {children}
    </button>
  );
}

function Nav({ onDemo, signedIn }: { onDemo: () => void; signedIn: boolean }) {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const check = () => setScrolled(window.scrollY > 16);
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => window.removeEventListener("scroll", check);
  }, []);
  return (
    <div className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <header
        className={cn(
          "mx-auto flex h-14 max-w-6xl items-center gap-6 rounded-2xl px-3 transition-[background-color,box-shadow] duration-300 sm:px-4",
          scrolled ? "bg-[#06130e]/75 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.6)] ring-1 ring-white/10 backdrop-blur-xl" : "bg-transparent",
        )}
      >
        <Link to="/" aria-label="WealthOS home" className="shrink-0">
          <Brand size="md" onRail />
        </Link>
        <nav className="hidden items-center gap-7 whitespace-nowrap text-[14px] font-medium text-[#c3d6cc] lg:flex" aria-label="On this page">
          {[["#import", "Features"], ["#how", "How it works"], ["#india", "Privacy"], ["#faq", "Questions"]].map(([href, label]) => (
            <a key={href} href={href} className="transition-colors hover:text-white">{label}</a>
          ))}
          <Link to="/docs" className="transition-colors hover:text-white">Docs</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          {!signedIn && (
            <button type="button" onClick={() => navigate("/login")} className="hidden h-9 whitespace-nowrap rounded-full px-4 text-[14px] font-medium text-[#d3e3da] transition-colors hover:bg-white/10 hover:text-white sm:inline-flex sm:items-center">
              Sign in
            </button>
          )}
          <button
            type="button"
            onClick={onDemo}
            className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-[linear-gradient(180deg,#e2c463,#c8a33a)] px-4 text-[13.5px] font-semibold text-[#1f1804] shadow-[0_8px_24px_-8px_rgba(200,163,58,0.7),inset_0_1px_0_rgba(255,255,255,0.45)] transition-[translate] hover:-translate-y-px"
          >
            {signedIn ? "Open WealthOS" : "Try the demo"} <ArrowRight className="size-3.5" />
          </button>
        </div>
      </header>
    </div>
  );
}

/** The slow gold and green light, the faint grid and the grain behind every dark band. */
function DarkBackdrop({ grid = true }: { grid?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-[-460px] h-[860px] w-[1280px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(212,179,79,0.30),rgba(212,179,79,0))] motion-safe:animate-aurora" />
      <div className="absolute -left-[260px] top-[60px] h-[640px] w-[760px] rounded-[50%] bg-[radial-gradient(closest-side,rgba(31,138,99,0.42),rgba(31,138,99,0))] motion-safe:animate-aurora [animation-delay:-6s]" />
      <div className="absolute -right-[220px] top-[180px] h-[560px] w-[660px] rounded-[50%] bg-[radial-gradient(closest-side,rgba(126,224,181,0.16),rgba(126,224,181,0))] motion-safe:animate-aurora [animation-delay:-12s]" />
      {grid && (
        <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(ellipse_75%_65%_at_50%_0%,black,transparent)]" />
      )}
      <div className="landing-grain absolute inset-0 opacity-[0.07] mix-blend-overlay" />
    </div>
  );
}

function Hero({ onDemo, signedIn }: { onDemo: () => void; signedIn: boolean }) {
  const navigate = useNavigate();
  const tilt = useRef<HTMLDivElement>(null);
  // The product leans back at first and settles flat as the page scrolls.
  useEffect(() => {
    const el = tilt.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = "none";
      return;
    }
    let frame = 0;
    const settle = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const t = Math.max(0, 1 - window.scrollY / 420);
        el.style.transform = `rotateX(${(t * 14).toFixed(2)}deg) scale(${(0.94 + 0.06 * (1 - t)).toFixed(3)})`;
      });
    };
    settle();
    window.addEventListener("scroll", settle, { passive: true });
    return () => {
      window.removeEventListener("scroll", settle);
      cancelAnimationFrame(frame);
    };
  }, []);

  // The dark band is one piece, so its light never stops at a seam: it runs down behind the product and ends
  // part of the way down it, which leaves the product standing across the edge onto the page.
  const product = useRef<HTMLDivElement>(null);
  const [below, setBelow] = useState(0);
  useLayoutEffect(() => {
    const el = product.current;
    if (!el) return;
    const measure = () => setBelow(Math.round(el.offsetHeight * 0.45));
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <section className="relative isolate">
      <div className="absolute inset-x-0 top-0 -z-10 overflow-hidden bg-[#06130e]" style={{ bottom: below }} aria-hidden>
        <DarkBackdrop />
        <div className="absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,rgba(232,210,142,0.55),transparent)]" />
      </div>
      <div className="relative text-white">
        <div className="mx-auto max-w-5xl px-5 pb-20 pt-36 text-center sm:px-8 sm:pb-24 sm:pt-44 lg:pt-48">
          <a
            href="#import"
            data-reveal=""
            className="group inline-flex items-center gap-2 rounded-full bg-white/[0.06] py-1 pl-1 pr-3.5 text-[13px] text-[#d3e3da] ring-1 ring-inset ring-white/[0.12] backdrop-blur transition-colors hover:bg-white/[0.1]"
          >
            <span className="rounded-full bg-[linear-gradient(180deg,#e2c463,#c8a33a)] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[#1f1804]">New</span>
            <span className="sm:hidden">Groww screenshots to holdings</span>
            <span className="hidden sm:inline">Groww screenshots to holdings, in seconds</span>
            <ArrowRight className="size-3.5 text-[#e8d28e] transition-transform group-hover:translate-x-0.5" />
          </a>
          <h1 data-reveal="" className="mt-8 text-[48px] font-semibold leading-[0.98] tracking-[-0.045em] sm:text-[76px] lg:text-[96px]">
            <span className="bg-[linear-gradient(180deg,#ffffff_30%,#c9ddd2)] bg-clip-text text-transparent">Your portfolio,</span>
            <br />
            <span className="gold-sheen inline-block pb-[0.08em] pr-[0.06em] font-display text-[1.06em] font-normal italic tracking-[-0.02em] motion-safe:animate-sheen">
              finally explained.
            </span>
          </h1>
          <p data-reveal="" className="mx-auto mt-6 max-w-2xl text-[17px] leading-[1.65] text-[#c3d6cc] sm:text-[19px]">
            See what your investments are worth, what they have really earned and why they moved. Every headline about your stocks is marked good or
            bad, and any trade can be checked before you make it.
          </p>
          <div data-reveal="" className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <GoldButton onClick={onDemo}>
              {signedIn ? "Open WealthOS" : "Explore the live demo"}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </GoldButton>
            {!signedIn && <GlassButton onClick={() => navigate("/login?mode=signup")}>Create a free account</GlassButton>}
          </div>
          <ul data-reveal="" className="mt-8 flex flex-wrap justify-center gap-x-7 gap-y-2.5 text-[13.5px] text-[#8fb1a2]">
            {["No sign-up for the demo", "Never connects to your broker", "Made for Indian investors"].map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <Check className="size-4 text-[#e8d28e]" strokeWidth={2.5} /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* The product crosses from the dark band onto the page. */}
      <div ref={product} className="relative">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[70%] w-[80%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(200,163,58,0.3),transparent)] blur-2xl" aria-hidden />
        <div className="relative mx-auto max-w-[1240px] px-4 sm:px-8">
          <div className="hidden [perspective:2400px] sm:block">
            <div ref={tilt} className="origin-top will-change-transform" style={{ transform: "rotateX(14deg) scale(0.94)" }}>
              <div className="rounded-[24px] bg-white/[0.08] p-2 shadow-[0_70px_140px_-40px_rgba(0,0,0,0.7)] ring-1 ring-white/20 backdrop-blur">
                <Fit width={1200} height={740}>
                  <DashboardMock />
                </Fit>
              </div>
            </div>
          </div>
          <div className="flex justify-center sm:hidden">
            <PhoneMock />
          </div>
          <p className="sr-only">A sample WealthOS dashboard: portfolio value with today's change and a chart, the health score, holdings, and news about the stocks held.</p>
        </div>
      </div>
    </section>
  );
}

function Marquee() {
  const items: [LucideIcon, string][] = [
    [LineChart, "Live NSE prices"],
    [Camera, "Groww screenshot import"],
    [MessageSquareText, "Trades typed in plain words"],
    [TrendingUp, "Real returns, after every trade"],
    [Gauge, "Portfolio health score"],
    [ClipboardCheck, "Trade check"],
    [Newspaper, "News marked good or bad"],
    [Sparkles, "Ask the market"],
    [Target, "Goals"],
    [BellRing, "Price alerts"],
    [Wallet, "Paper trading"],
    [FileSpreadsheet, "Zerodha tradebooks"],
    [Moon, "Dark mode"],
    [Smartphone, "Installs on your phone"],
  ];
  return (
    <section className="py-14 sm:py-20" aria-label="What WealthOS does">
      <div className="relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
        <div className="flex w-max motion-safe:animate-marquee hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <ul key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
              {items.map(([Icon, label]) => (
                <li key={label} className="flex items-center gap-2.5 whitespace-nowrap px-5 text-[15px] font-medium text-ink-2">
                  <Icon className="size-4 text-accent" />
                  {label}
                  <span className="ml-5 size-1 rounded-full bg-gold" />
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}

function Heading({ eyebrow, title, accent, text, align = "center", dark }: { eyebrow: string; title: string; accent: string; text?: string; align?: "center" | "left"; dark?: boolean }) {
  return (
    <div data-reveal="" className={cn(align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-xl")}>
      <div className={cn("text-[12.5px] font-semibold uppercase tracking-[0.22em]", dark ? "text-[#e8d28e]" : "text-gold-ink")}>{eyebrow}</div>
      <h2 className={cn("mt-4 text-[38px] font-semibold leading-[1.02] tracking-[-0.04em] sm:text-[52px]", dark ? "text-white" : "text-ink")}>
        {title}{" "}
        <span className={cn("inline-block pb-[0.06em] pr-[0.06em] font-display text-[1.06em] font-normal italic tracking-[-0.015em]", dark ? "gold-sheen" : "brand-ink")}>{accent}</span>
      </h2>
      {text && <p className={cn("mt-5 text-[17px] leading-[1.7]", dark ? "text-[#c3d6cc]" : "text-ink-2", align === "center" && "mx-auto max-w-2xl")}>{text}</p>}
    </div>
  );
}

/** The soft green-and-gold stage a product scene stands on. */
function Stage({ children, width, height }: { children: ReactNode; width: number; height: number }) {
  return (
    <div className="relative overflow-hidden rounded-[32px] border border-line bg-surface p-4 shadow-[var(--shadow-lift)] sm:p-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_0%_0%,var(--accent-soft),transparent_60%),radial-gradient(110%_90%_at_100%_100%,var(--gold-soft),transparent_60%)]" aria-hidden />
      <div className="pointer-events-none absolute inset-0 opacity-70 [background-image:radial-gradient(var(--line-strong)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_72%)]" aria-hidden />
      <div className="relative">
        <Fit width={width} height={height}>{children}</Fit>
      </div>
      <span className="absolute bottom-3 right-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted/70">Sample</span>
    </div>
  );
}

function Feature({
  id, icon: Icon, eyebrow, title, accent, text, points, flip, children,
}: {
  id: string; icon: LucideIcon; eyebrow: string; title: string; accent: string; text: string; points: string[]; flip?: boolean; children: ReactNode;
}) {
  return (
    <div id={id} className="mx-auto grid max-w-6xl scroll-mt-28 items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div data-reveal="" className={cn("max-w-xl", flip && "lg:order-2")}>
        <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-[12.5px] font-semibold text-accent ring-1 ring-inset ring-accent/15">
          <Icon className="size-3.5" /> {eyebrow}
        </span>
        <h3 className="mt-5 text-[34px] font-semibold leading-[1.04] tracking-[-0.038em] text-ink sm:text-[44px]">
          {title} <span className="brand-ink inline-block pb-[0.06em] pr-[0.06em] font-display text-[1.06em] font-normal italic tracking-[-0.01em]">{accent}</span>
        </h3>
        <p className="mt-5 text-[17px] leading-[1.7] text-ink-2">{text}</p>
        <ul className="mt-7 flex flex-col gap-3.5">
          {points.map((point) => (
            <li key={point} className="flex gap-3 text-[15.5px] leading-snug text-ink-2">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(140deg,#0f3b2d,#1f5e48)] text-[#e8d28e]">
                <Check className="size-3" strokeWidth={3} />
              </span>
              {point}
            </li>
          ))}
        </ul>
      </div>
      <div data-reveal="" style={{ transitionDelay: "120ms" }} className={cn(flip && "lg:order-1")}>
        {children}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section className="px-5 pb-28 sm:px-8 lg:pb-36">
      <Heading
        eyebrow="What it does"
        title="Everything you need to invest"
        accent="with clarity."
        text="WealthOS answers the questions people actually ask about their money, in plain words, with the numbers beside them."
      />
      <div className="mt-20 flex flex-col gap-28 lg:mt-24 lg:gap-36">
        <Feature
          id="import"
          icon={Camera}
          eyebrow="Bring your trades"
          title="Screenshots in."
          accent="Holdings out."
          text="Add screenshots of your Groww orders and AI reads every trade. Each price is checked against what the stock really traded at that day, and anything doubtful is marked before you save."
          points={["Cancelled and rejected orders are left out for you", "Or type a trade: “I sold 2 TCS at 4,120 yesterday”", "Screenshots are read once and never stored"]}
        >
          <Stage width={520} height={440}><ImportScene /></Stage>
        </Feature>
        <Feature
          id="health"
          icon={Gauge}
          eyebrow="Know where you stand"
          title="One number for your portfolio,"
          accent="every reason behind it."
          text="A health score out of 100 for how your portfolio is built: spread, concentration, risk and returns, with every check written out so you can see it and disagree with it."
          points={["Why your portfolio moved today, holding by holding", "How much of a move was simply the market", "The few things worth knowing this week"]}
          flip
        >
          <Stage width={520} height={440}><HealthScene /></Stage>
        </Feature>
        <Feature
          id="check"
          icon={ClipboardCheck}
          eyebrow="Before you act"
          title="Check a trade"
          accent="before you make it."
          text="Run any buy or sell through the same checks every time: trend, price, the business, risk and how it fits what you already own. The score is plain arithmetic, so the same facts always give the same answer."
          points={["A confidence score out of 100, with its reasons", "The result explained in plain words", "Never a tip: the decision stays yours"]}
        >
          <Stage width={520} height={440}><TradeScene /></Stage>
        </Feature>
        <Feature
          id="news"
          icon={Newspaper}
          eyebrow="Stay informed"
          title="News that tells you"
          accent="what it means."
          text="Every headline about the companies you hold, and the whole market, marked good, bad or neutral for the stock with a few words on why. Companies with clearly good news and a strong score are shown in green."
          points={["Your stocks' news on the dashboard, always", "Sort by the biggest news, or by good or bad first", "Stories that only share a name are filtered out"]}
          flip
        >
          <Stage width={520} height={440}><NewsScene /></Stage>
        </Feature>
      </div>
    </section>
  );
}

function More() {
  const small: [LucideIcon, string, string][] = [
    [Target, "Goals", "A target, a date and a monthly amount, worked out three ways."],
    [BellRing, "Alerts", "A price or a move you care about, and a nudge when it happens."],
    [Wallet, "Paper trading", "Practise with virtual money at live prices before risking real money."],
    [Smartphone, "On your phone", "Installs from the browser like an app. No app store needed."],
  ];
  return (
    <section className="px-5 pb-28 sm:px-8 lg:pb-36">
      <Heading eyebrow="And more" title="Everything else" accent="you'd want." />
      <div className="mx-auto mt-14 grid max-w-6xl gap-5 md:grid-cols-2 lg:grid-cols-3">
        <div data-reveal="" className="relative isolate overflow-hidden rounded-[28px] bg-[#06130e] p-7 text-white md:col-span-2">
          <DarkBackdrop grid={false} />
          <div className="grid items-center gap-8 sm:grid-cols-[1fr_1.1fr]">
            <div>
              <span className="flex size-11 items-center justify-center rounded-2xl bg-white/[0.08] text-[#e8d28e] ring-1 ring-inset ring-white/15">
                <Sparkles className="size-5" />
              </span>
              <h3 className="mt-5 text-[24px] font-semibold tracking-[-0.025em]">Ask the market anything</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#c3d6cc]">
                What happened today and why, which sectors look strong, where ₹50,000 could go. Answers come with the app's own scores and their sources.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="ml-auto max-w-[90%] rounded-2xl rounded-br-md bg-[linear-gradient(180deg,#e2c463,#c8a33a)] px-3.5 py-2 text-[13px] font-medium text-[#1f1804]">
                Which sectors look strongest right now?
              </div>
              <div className="rounded-2xl rounded-bl-md bg-white/[0.07] p-3.5 ring-1 ring-inset ring-white/12 backdrop-blur">
                {[["Healthcare", 72], ["Automobiles", 67], ["Financials", 64]].map(([name, score]) => (
                  <div key={name as string} className="grid grid-cols-[92px_1fr_26px] items-center gap-2.5 py-1 text-[12px] text-[#d3e3da]">
                    {name}
                    <span className="h-1.5 rounded-full bg-white/10">
                      <span className="block h-full rounded-full bg-[linear-gradient(90deg,#c8a33a,#e8d28e)]" style={{ width: `${score}%` }} />
                    </span>
                    <span className="num text-right font-semibold text-white">{score}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {small.map(([Icon, title, text], i) => (
          <div
            key={title}
            data-reveal=""
            style={{ transitionDelay: `${(i + 1) * 70}ms` }}
            className="group rounded-[28px] border border-line bg-surface p-7 shadow-card transition-[box-shadow,border-color] duration-300 hover:border-accent/25 hover:shadow-lift"
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent ring-1 ring-inset ring-accent/10 transition-[scale] duration-300 group-hover:scale-105">
              <Icon className="size-5" />
            </span>
            <h3 className="mt-5 text-[19px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-2">{text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function How() {
  const steps: [string, string, string[]][] = [
    ["Bring your trades", "Drop in Groww screenshots, type a trade in a sentence, or import a broker file. Nothing to connect, nothing to link.", ["Screenshot", "Sentence", "CSV"]],
    ["See the whole picture", "Live value, real returns after every buy and sell, risk you can read, and a health score with its reasons.", ["Live value", "XIRR", "Health"]],
    ["Decide with evidence", "Check a trade before you make it, read the news that matters to your stocks, and ask the market in plain words.", ["Trade check", "News", "Ask"]],
  ];
  return (
    <section id="how" className="scroll-mt-24 border-y border-line bg-surface px-5 py-28 sm:px-8 lg:py-36">
      <Heading eyebrow="How it works" title="From scattered trades to" accent="a clear picture." text="Three steps. The first one takes about as long as making tea." />
      <ol className="mx-auto mt-16 grid max-w-6xl gap-5 lg:grid-cols-3">
        {steps.map(([title, text, chips], i) => (
          <li key={title} data-reveal="" style={{ transitionDelay: `${i * 110}ms` }} className="relative overflow-hidden rounded-[28px] border border-line bg-bg p-8">
            <span className="brand-ink inline-block pr-[0.06em] font-display text-[72px] leading-none">0{i + 1}</span>
            <h3 className="mt-4 text-[21px] font-semibold tracking-[-0.02em] text-ink">{title}</h3>
            <p className="mt-2.5 text-[15px] leading-relaxed text-ink-2">{text}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              {chips.map((chip) => (
                <span key={chip} className="rounded-full bg-surface px-3 py-1 text-[12px] font-semibold text-ink-2 ring-1 ring-line">{chip}</span>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function India() {
  const india: [LucideIcon, string, string][] = [
    [IndianRupee, "Rupees, lakh and crore", "Every figure the way you read it."],
    [LineChart, "NSE companies and ETFs", "Scored daily; any listed stock looked up."],
    [Camera, "Groww and Zerodha", "Screenshots, order history and tradebooks."],
    [Globe, "India's hours and dates", "Market open and close, in India time."],
  ];
  const privacy: [LucideIcon, string, string][] = [
    [ShieldCheck, "Read-only by design", "WealthOS never connects to your broker and can never place a trade."],
    [Eye, "Screenshots read, then gone", "Read once to find your trades, then thrown away."],
    [LockKeyhole, "Only you see your data", "Stored under your account; the database refuses anyone else."],
  ];
  return (
    <section id="india" className="relative isolate scroll-mt-20 overflow-hidden bg-[#06130e] px-5 py-28 text-white sm:px-8 lg:py-36">
      <DarkBackdrop />
      <div className="mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <Heading
            eyebrow="Built for India"
            title="Made for how"
            accent="India invests."
            text="Indian market hours, India's dates, rupee formatting and the brokers people here actually use. No converting, no guessing."
            align="left"
            dark
          />
          <div className="mt-10 grid gap-x-8 gap-y-7 sm:grid-cols-2">
            {india.map(([Icon, title, text], i) => (
              <div key={title} data-reveal="" style={{ transitionDelay: `${i * 70}ms` }} className="flex gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.07] text-[#e8d28e] ring-1 ring-inset ring-white/12">
                  <Icon className="size-[18px]" />
                </span>
                <div>
                  <div className="text-[15.5px] font-semibold">{title}</div>
                  <div className="mt-1 text-[14px] leading-relaxed text-[#9fbeb0]">{text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div data-reveal="" className="relative rounded-[30px] bg-white/[0.05] p-8 ring-1 ring-inset ring-white/12 backdrop-blur-md sm:p-10">
          <div className="pointer-events-none absolute -top-px left-10 right-10 h-px bg-[linear-gradient(90deg,transparent,rgba(232,210,142,0.7),transparent)]" aria-hidden />
          <div className="text-[12.5px] font-semibold uppercase tracking-[0.22em] text-[#e8d28e]">Private by design</div>
          <h3 className="mt-4 text-[30px] font-semibold leading-[1.08] tracking-[-0.035em]">
            Your money is personal. <span className="gold-sheen inline-block pb-[0.06em] pr-[0.06em] font-display font-normal italic">We keep it that way.</span>
          </h3>
          <ul className="mt-8 flex flex-col gap-6">
            {privacy.map(([Icon, title, text]) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[linear-gradient(140deg,#c8a33a,#e8d28e)] text-[#1f1804] shadow-[0_10px_24px_-10px_rgba(200,163,58,0.7)]">
                  <Icon className="size-5" />
                </span>
                <div>
                  <div className="text-[16px] font-semibold">{title}</div>
                  <div className="mt-1 text-[14px] leading-relaxed text-[#b3cbbf]">{text}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ["Is WealthOS free?", "Exploring the full demo is free and needs no sign-up. Creating an account is free too. Some AI features may later be part of a paid plan; anything that changes will be clear before you use it."],
  ["Does it connect to my broker or place trades?", "No. WealthOS never links to a broker account and cannot buy or sell anything. You add the trades you made, from screenshots, a sentence or a file."],
  ["Will it tell me what to buy?", "It shows the evidence: scores, checks, news and the reasons behind them, in plain words. The decision stays yours, and nothing in the app is investment advice."],
  ["Which brokers can I bring trades from?", "Groww, by screenshot or order history; Zerodha, by tradebook; and any broker through a simple CSV file. You can also type a trade in a sentence."],
  ["Is my data safe?", "Your portfolio is stored under your own account and only you can read it. Screenshots are read once and never stored."],
  ["Does it work on my phone?", "Yes. It is built for phones first and installs like an app from your browser, with no app store needed."],
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 px-5 py-28 sm:px-8 lg:py-36">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Heading eyebrow="Questions" title="Good questions," accent="straight answers." text="If yours isn't here, the docs go into every detail." align="left" />
          <Link
            to="/docs"
            data-reveal=""
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-surface px-5 text-[14.5px] font-semibold text-ink ring-1 ring-line transition-[box-shadow] hover:ring-accent/40"
          >
            <BookOpen className="size-4 text-accent" /> Read the docs
          </Link>
        </div>
        <div data-reveal="" className="divide-y divide-line border-y border-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-6 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-[17px] font-semibold tracking-[-0.01em] text-ink">
                {q}
                <span className="relative mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <span className="absolute h-[1.5px] w-2.5 rounded-full bg-current" />
                  <span className="absolute h-2.5 w-[1.5px] rounded-full bg-current transition-[rotate,opacity] duration-300 group-open:rotate-90 group-open:opacity-0" />
                </span>
              </summary>
              <p className="mt-3 max-w-2xl pr-10 text-[15.5px] leading-[1.7] text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ onDemo, signedIn }: { onDemo: () => void; signedIn: boolean }) {
  const navigate = useNavigate();
  return (
    <section className="px-4 pb-24 sm:px-8">
      <div data-reveal="" className="relative isolate mx-auto max-w-6xl overflow-hidden rounded-[40px] bg-[#06130e] px-6 py-24 text-center text-white sm:px-12 sm:py-32">
        <DarkBackdrop grid={false} />
        <svg className="pointer-events-none absolute left-1/2 top-1/2 -z-10 -translate-x-1/2 -translate-y-1/2" width="1100" height="1100" viewBox="0 0 1100 1100" aria-hidden>
          {[160, 260, 360, 460, 540].map((r, i) => (
            <circle key={r} cx="550" cy="550" r={r} fill="none" stroke="#e8d28e" strokeOpacity={0.16 - i * 0.025} strokeWidth="1" />
          ))}
        </svg>
        <h2 className="mx-auto max-w-3xl text-[40px] font-semibold leading-[1.02] tracking-[-0.045em] sm:text-[64px]">
          See your money clearly.
          <br />
          <span className="gold-sheen inline-block pb-[0.08em] pr-[0.06em] font-display text-[1.06em] font-normal italic tracking-[-0.02em] motion-safe:animate-sheen">In two minutes.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-[17px] leading-[1.65] text-[#c3d6cc]">
          Open the demo and click around a real-looking portfolio at live prices. When you're ready, bring your own trades.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <GoldButton onClick={onDemo}>
            {signedIn ? "Open WealthOS" : "Explore the live demo"} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </GoldButton>
          {!signedIn && <GlassButton onClick={() => navigate("/login?mode=signup")}>Create a free account</GlassButton>}
        </div>
      </div>
    </section>
  );
}

function Footer({ onDemo }: { onDemo: () => void }) {
  const link = "text-[14px] text-ink-2 transition-colors hover:text-ink";
  return (
    <footer className="border-t border-line bg-surface/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 sm:grid-cols-[1.5fr_1fr_1fr] sm:px-8">
        <div className="max-w-sm">
          <Brand size="md" />
          <p className="mt-4 text-[14px] leading-relaxed text-muted">
            See what your investments are really doing, and check a trade before you make it. Made for investors in India.
          </p>
        </div>
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">Product</div>
          <ul className="mt-4 flex flex-col gap-2.5">
            <li><a href="#import" className={link}>Features</a></li>
            <li><a href="#how" className={link}>How it works</a></li>
            <li><a href="#india" className={link}>Privacy</a></li>
            <li><a href="#faq" className={link}>Questions</a></li>
          </ul>
        </div>
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-muted">Get started</div>
          <ul className="mt-4 flex flex-col gap-2.5">
            <li><button type="button" onClick={onDemo} className={link}>Try the demo</button></li>
            <li><Link to="/login?mode=signup" className={link}>Create an account</Link></li>
            <li><Link to="/login" className={link}>Sign in</Link></li>
            <li><Link to="/docs" className={link}>Docs</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-6 text-[12.5px] text-muted sm:flex-row sm:justify-between sm:px-8">
          <span>© {new Date().getFullYear()} WealthOS</span>
          <span>A tracking and analysis tool. Not investment advice. It never places trades.</span>
        </div>
      </div>
    </footer>
  );
}

export function LandingPage() {
  const { status, enterDemo } = useAuth();
  const navigate = useNavigate();
  const page = useRef<HTMLDivElement>(null);
  const signedIn = status === "user" || status === "demo";
  useReveal(page);
  useEffect(() => {
    document.title = "WealthOS · Your portfolio, finally explained";
  }, []);
  const open = () => {
    if (!signedIn) enterDemo();
    navigate("/");
  };
  return (
    <div ref={page} className="min-h-dvh overflow-x-clip">
      <Nav onDemo={open} signedIn={signedIn} />
      <main>
        <Hero onDemo={open} signedIn={signedIn} />
        <Marquee />
        <Features />
        <More />
        <How />
        <India />
        <Faq />
        <Closing onDemo={open} signedIn={signedIn} />
      </main>
      <Footer onDemo={open} />
    </div>
  );
}
