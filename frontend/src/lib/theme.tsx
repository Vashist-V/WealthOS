import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeName = "light" | "dark";

/** Colours used inside charts. The categorical order is fixed and was checked
 * for colour-vision-deficiency separation against each theme's card surface;
 * assign series in this order and never cycle past the eighth. */
export interface ChartTheme {
  name: ThemeName;
  surface: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[];
  gain: string;
  loss: string;
  neutral: string;
  /** Diverging poles for signed scales such as correlation. */
  cool: string;
  warm: string;
  /** Single-hue ramp, light to dark, for magnitude. */
  ramp: string[];
  tooltipBg: string;
  tooltipBorder: string;
}

const CHART: Record<ThemeName, ChartTheme> = {
  // Forest and gold first, as in the rest of the app, then colours that sit well beside them.
  light: {
    name: "light",
    surface: "#ffffff",
    ink: "#111614",
    ink2: "#3d4643",
    muted: "#6a716e",
    grid: "#eeebf0",
    axis: "#cdcad1",
    series: ["#1f6e52", "#c8a33a", "#3b7dd8", "#d0674a", "#8b6fd6", "#2a9d8f", "#c25b84", "#7a8b2f"],
    gain: "#0f8a52",
    loss: "#c2384c",
    neutral: "#efecf1",
    cool: "#2f74c9",
    warm: "#c2384c",
    ramp: ["#e6efea", "#c3dccf", "#97c2ad", "#66a487", "#3d8564", "#1f6e52", "#0f3b2d"],
    tooltipBg: "#ffffff",
    tooltipBorder: "rgba(17,22,20,0.12)",
  },
  dark: {
    name: "dark",
    surface: "#111a16",
    ink: "#f4f7f5",
    ink2: "#c2cdc8",
    muted: "#8d9f97",
    grid: "#1c2722",
    axis: "#2b3a33",
    series: ["#86c3a5", "#d7b75c", "#6aa5f0", "#e58a6d", "#a891ee", "#4fc1b2", "#e07fa6", "#a9b95a"],
    gain: "#3ad283",
    loss: "#f47e8c",
    neutral: "#1e2b25",
    cool: "#5b9cf0",
    warm: "#f47e8c",
    ramp: ["#12261d", "#173628", "#22503b", "#2f6e52", "#4f9a77", "#86c3a5", "#c6e6d6"],
    tooltipBg: "#16211c",
    tooltipBorder: "rgba(255,255,255,0.12)",
  },
};

/** Identity colours a user can give a portfolio — the categorical palette. */
export const PORTFOLIO_COLORS = ["#2F8A63", "#C8A33A", "#3B7DD8", "#D0674A", "#8B6FD6", "#2A9D8F", "#C25B84", "#7A8B2F"];

interface ThemeState {
  theme: ThemeName;
  chart: ChartTheme;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function initial(): ThemeName {
  const stamped = document.documentElement.dataset.theme;
  return stamped === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(initial);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#08100d" : "#faf7fc");
  }, [theme]);

  const setTheme = useCallback((t: ThemeName) => {
    localStorage.setItem("wealthos.theme", t);
    setThemeState(t);
  }, []);
  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);

  const value = useMemo(() => ({ theme, chart: CHART[theme], setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** Colour for the n-th series; anything past the palette folds into grey. */
export function seriesColor(chart: ChartTheme, index: number): string {
  return chart.series[index] ?? chart.muted;
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Diverging colour for a value in [-1, 1]: cool below zero, neutral at zero, warm above. */
export function diverging(chart: ChartTheme, value: number, low = chart.cool, high = chart.warm): string {
  const v = Math.max(-1, Math.min(1, value));
  return v < 0 ? mix(chart.neutral, low, -v) : mix(chart.neutral, high, v);
}

/** Gain/loss wash for a signed percentage, saturating at `limit`. */
export function signedColor(chart: ChartTheme, value: number, limit = 3): string {
  return diverging(chart, value / limit, chart.loss, chart.gain);
}

/** Pick black or white text for a filled cell. */
export function textOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#0f1116" : "#ffffff";
}
