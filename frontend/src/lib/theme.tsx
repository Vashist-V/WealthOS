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
  light: {
    name: "light",
    surface: "#ffffff",
    ink: "#0f1116",
    ink2: "#474b55",
    muted: "#7b808c",
    grid: "#ececE8",
    axis: "#cfd0cc",
    series: ["#4f5bd5", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
    gain: "#12924b",
    loss: "#d9463f",
    neutral: "#eeeeea",
    cool: "#2a78d6",
    warm: "#e34948",
    ramp: ["#dfe2fa", "#bcc2f3", "#959eea", "#6f7be0", "#4f5bd5", "#3b45ad", "#2b3384"],
    tooltipBg: "#ffffff",
    tooltipBorder: "rgba(15,17,22,0.12)",
  },
  dark: {
    name: "dark",
    surface: "#12151c",
    ink: "#f2f3f5",
    ink2: "#b3b8c4",
    muted: "#7d8493",
    grid: "#1f232c",
    axis: "#2e3440",
    series: ["#6e7bff", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
    gain: "#2fb872",
    loss: "#e8605f",
    neutral: "#262b35",
    cool: "#3987e5",
    warm: "#e66767",
    ramp: ["#1d2247", "#2a3170", "#39439c", "#4b57c4", "#6e7bff", "#97a0ff", "#c3c8ff"],
    tooltipBg: "#1b1f29",
    tooltipBorder: "rgba(255,255,255,0.12)",
  },
};

/** Identity colours a user can give a portfolio — the categorical palette. */
export const PORTFOLIO_COLORS = ["#6E7BFF", "#E8A23B", "#2FB67C", "#D4669B", "#D95926", "#9085E9", "#3987E5", "#E66767"];

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
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0d12" : "#f4f4f1");
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
