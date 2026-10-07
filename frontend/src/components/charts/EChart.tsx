import { BarChart, CandlestickChart, CustomChart, HeatmapChart, LineChart, PieChart, ScatterChart, TreemapChart } from "echarts/charts";
import {
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { compact, inr, number, pct, price, signedPct } from "@/lib/format";
import type { ChartTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

echarts.use([
  BarChart, CandlestickChart, CustomChart, HeatmapChart, LineChart, PieChart, ScatterChart, TreemapChart,
  DataZoomComponent, GridComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TooltipComponent, VisualMapComponent,
  CanvasRenderer,
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Option = Record<string, any>;
export const FONT = '"Geist Variable", ui-sans-serif, system-ui, sans-serif';

export function EChart({
  option,
  height = 280,
  className,
  onClick,
  label,
}: {
  option: Option;
  height?: number | string;
  className?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClick?: (params: any) => void;
  /** Describes the chart for screen readers. */
  label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const click = useRef(onClick);
  click.current = onClick;

  useEffect(() => {
    const instance = echarts.init(host.current!, undefined, { renderer: "canvas" });
    chart.current = instance;
    instance.on("click", (params) => click.current?.(params));
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(host.current!);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={host} role="img" aria-label={label} className={cn("w-full", className)} style={{ height }} />;
}

export type Format = "inr" | "price" | "pct" | "signedPct" | "number";

/** Short form for axis ticks. */
export function axisFormat(format: Format): (v: number) => string {
  if (format === "inr") return (v) => compact(v, Math.abs(v) >= 1e5 ? 1 : 0);
  if (format === "price") return (v) => number(v, v < 100 ? 2 : 0);
  if (format === "pct") return (v) => `${number(v, Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0)}%`;
  if (format === "signedPct") return (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${number(Math.abs(v), Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0)}%`;
  return (v) => number(v, Math.abs(v) < 10 && v % 1 !== 0 ? 2 : 0);
}

/** For values printed on a mark: one more digit than an axis tick. */
export function labelFormat(format: Format): (v: number) => string {
  if (format === "inr") return (v) => compact(v, 1);
  if (format === "pct") return (v) => pct(v, 1);
  if (format === "signedPct") return (v) => signedPct(v, 1);
  return axisFormat(format);
}

/** Full precision for tooltips. */
export function valueFormat(format: Format): (v: number | null | undefined) => string {
  if (format === "inr") return inr;
  if (format === "price") return price;
  if (format === "pct") return (v) => pct(v);
  if (format === "signedPct") return (v) => signedPct(v);
  return (v) => number(v, 2);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Jan" for short spans, "Jan 26" once the axis covers more than ~18 months. */
export function dateTick(dates: string[]): (value: string) => string {
  const span = dates.length > 1 ? new Date(dates[dates.length - 1]).getTime() - new Date(dates[0]).getTime() : 0;
  const long = span > 540 * 86_400_000;
  return (value) => {
    const [y, m, d] = value.slice(0, 10).split("-");
    return long ? `${MONTHS[+m - 1]} ${y.slice(2)}` : `${+d} ${MONTHS[+m - 1]}`;
  };
}

export function longDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
}

export function tooltipBase(t: ChartTheme, extra: Option = {}): Option {
  return {
    backgroundColor: t.tooltipBg,
    borderColor: t.tooltipBorder,
    borderWidth: 1,
    padding: [8, 11],
    textStyle: { color: t.ink, fontSize: 12, fontFamily: FONT },
    extraCssText: "border-radius:10px;box-shadow:0 10px 28px -6px rgba(0,0,0,.28);",
    confine: true,
    axisPointer: { type: "line", lineStyle: { color: t.axis, width: 1, type: "solid" }, label: { show: false } },
    ...extra,
  };
}

export interface TipRow {
  color?: string;
  label: string;
  value: string;
  dashed?: boolean;
}

/** Shared tooltip body: a title, then one swatch · label · value row per series. */
export function tip(t: ChartTheme, title: string, rows: TipRow[], footer?: string): string {
  const body = rows
    .map((r) => {
      const swatch = r.color
        ? `<span style="display:inline-block;width:10px;height:${r.dashed ? 2 : 3}px;border-radius:2px;background:${r.color};margin-right:7px;vertical-align:middle;${r.dashed ? "opacity:.75;" : ""}"></span>`
        : "";
      return `<div style="display:flex;justify-content:space-between;gap:18px;align-items:center;line-height:1.7"><span style="color:${t.ink2}">${swatch}${r.label}</span><span style="font-weight:600;font-variant-numeric:tabular-nums">${r.value}</span></div>`;
    })
    .join("");
  const foot = footer ? `<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${t.tooltipBorder};color:${t.muted};font-size:11px">${footer}</div>` : "";
  return `<div style="min-width:132px"><div style="color:${t.muted};font-size:11px;margin-bottom:3px">${title}</div>${body}${foot}</div>`;
}

export function baseOption(t: ChartTheme): Option {
  return {
    animationDuration: 320,
    animationDurationUpdate: 200,
    textStyle: { fontFamily: FONT, color: t.ink2 },
    grid: { left: 4, right: 10, top: 10, bottom: 2, containLabel: true },
  };
}

export function timeAxis(t: ChartTheme, dates: string[], extra: Option = {}): Option {
  return {
    type: "category",
    data: dates,
    boundaryGap: false,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, formatter: dateTick(dates), hideOverlap: true, margin: 10 },
    splitLine: { show: false },
    ...extra,
  };
}

export function categoryAxis(t: ChartTheme, data: string[], extra: Option = {}): Option {
  return {
    type: "category",
    data,
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, margin: 10 },
    splitLine: { show: false },
    ...extra,
  };
}

export function valueAxis(t: ChartTheme, format: Format, extra: Option = {}): Option {
  return {
    type: "value",
    scale: true,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, formatter: axisFormat(format), margin: 10 },
    splitLine: { lineStyle: { color: t.grid, width: 1, type: "solid" } },
    splitNumber: 4,
    ...extra,
  };
}

/** Hex colour with alpha, for area washes. */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}
