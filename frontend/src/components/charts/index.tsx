/**
 * The chart kit. Every chart in the app goes through one of these so marks,
 * axes, tooltips and colours stay consistent:
 *   - lines are 2px, area fills are a faint wash, gridlines are hairlines
 *   - bars are capped at 24px with a rounded data end
 *   - touching fills are separated by a 2px gap in the surface colour
 *   - two or more series always get a legend; text never wears a series colour
 */
import { useMemo, type ReactNode } from "react";
import { inr, number, pct, signedPct } from "@/lib/format";
import { diverging, seriesColor, signedColor, textOn, useTheme } from "@/lib/theme";
import type { Candle, Percentiles } from "@/lib/types";
import { cn } from "@/lib/utils";
import { LegendItem } from "../ui";
import {
  alpha, axisFormat, baseOption, categoryAxis, EChart, FONT, labelFormat, longDate, timeAxis, tip, tooltipBase, valueAxis, valueFormat,
  type Format, type Option, type TipRow,
} from "./EChart";

export { EChart } from "./EChart";
export type { Format } from "./EChart";

function Legend({ items, className }: { items: { color: string; label: string; dashed?: boolean }[]; className?: string }) {
  if (items.length < 2) return null;
  return (
    <div className={cn("mb-2 flex flex-wrap items-center gap-x-4 gap-y-1", className)}>
      {items.map((item) => (
        <LegendItem key={item.label} color={item.color} label={item.label} dashed={item.dashed} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------ time series
export interface LineSeries {
  name: string;
  data: (number | null)[];
  color?: string;
  /** Faint fill under the line. Use for a single headline series. */
  area?: boolean;
  /** A reference series: benchmark, invested amount. */
  dashed?: boolean;
  step?: boolean;
}

export function TimeSeriesChart({
  dates,
  series,
  format = "inr",
  height = 280,
  zeroLine,
  marks,
  zoom,
  legend = true,
  label,
}: {
  dates: string[];
  series: LineSeries[];
  format?: Format;
  height?: number;
  /** Draw a baseline at zero (for returns and drawdowns). */
  zeroLine?: boolean;
  /** Vertical markers at dates, e.g. a journal entry. */
  marks?: { date: string; label: string }[];
  /** Enable scroll/pinch zoom. */
  zoom?: boolean;
  legend?: boolean;
  label?: string;
}) {
  const { chart: t } = useTheme();
  const colors = series.map((s, i) => s.color ?? seriesColor(t, i));
  const option = useMemo<Option>(() => {
    const fmt = valueFormat(format);
    return {
      ...baseOption(t),
      tooltip: tooltipBase(t, {
        trigger: "axis",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) =>
          tip(
            t,
            longDate(params[0].axisValue),
            params.filter((p) => p.value != null).map((p) => ({ color: colors[p.seriesIndex], label: p.seriesName, value: fmt(p.value), dashed: series[p.seriesIndex]?.dashed })),
          ),
      }),
      xAxis: timeAxis(t, dates),
      yAxis: valueAxis(t, format),
      dataZoom: zoom ? [{ type: "inside", zoomOnMouseWheel: true, moveOnMouseMove: true }] : undefined,
      series: series.map((s, i) => ({
        name: s.name,
        type: "line",
        data: s.data,
        step: s.step ? "end" : undefined,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 8,
        connectNulls: true,
        lineStyle: { width: s.dashed ? 1.5 : 2, color: colors[i], type: s.dashed ? [4, 3] : "solid", join: "round", cap: "round" },
        itemStyle: { color: colors[i], borderColor: t.surface, borderWidth: 2 },
        emphasis: { disabled: false, scale: false, lineStyle: { width: s.dashed ? 1.5 : 2 } },
        areaStyle: s.area
          ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(colors[i], 0.18) }, { offset: 1, color: alpha(colors[i], 0) }] } }
          : undefined,
        z: s.dashed ? 1 : 3,
        markLine:
          i === 0 && (zeroLine || marks?.length)
            ? {
                silent: true,
                symbol: "none",
                animation: false,
                label: { show: false },
                data: [
                  ...(zeroLine ? [{ yAxis: 0, lineStyle: { color: t.axis, width: 1, type: "solid" } }] : []),
                  ...(marks ?? []).map((m) => ({
                    xAxis: m.date,
                    lineStyle: { color: t.muted, width: 1, type: [3, 3] },
                    label: { show: true, formatter: m.label, color: t.ink2, fontSize: 11, fontFamily: FONT, position: "insideEndTop" },
                  })),
                ],
              }
            : undefined,
      })),
    };
  }, [t, dates, series, format, zeroLine, marks, zoom, colors.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {legend && <Legend items={series.map((s, i) => ({ color: colors[i], label: s.name, dashed: s.dashed }))} />}
      <EChart option={option} height={height} label={label} />
    </div>
  );
}

// ------------------------------------------------------------------ donut
export interface Slice {
  name: string;
  value: number;
  color?: string;
}

/** Share-of-whole ring. Pair it with a list of the slices so no value hides behind colour. */
export function DonutChart({
  data,
  height = 220,
  format = "inr",
  center,
  label,
}: {
  data: Slice[];
  height?: number;
  format?: Format;
  /** Content for the middle of the ring: usually the total. */
  center?: ReactNode;
  label?: string;
}) {
  const { chart: t } = useTheme();
  const option = useMemo<Option>(() => {
    const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
    const fmt = valueFormat(format);
    return {
      animationDuration: 420,
      tooltip: tooltipBase(t, {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => tip(t, p.name, [{ color: p.color, label: "Share", value: pct((p.value / total) * 100, 1) }, { label: "Value", value: fmt(p.value) }]),
      }),
      series: [
        {
          type: "pie",
          radius: ["66%", "92%"],
          padAngle: 1.5,
          minAngle: 2,
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderRadius: 4, borderColor: t.surface, borderWidth: 2 },
          emphasis: { scale: true, scaleSize: 4 },
          data: data.map((d, i) => ({ name: d.name, value: d.value, itemStyle: { color: d.color ?? seriesColor(t, i) } })),
        },
      ],
    };
  }, [t, data, format]);
  return (
    <div className="relative" style={{ height }}>
      <EChart option={option} height={height} label={label} />
      {center && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  );
}

// ------------------------------------------------------------------- bars
export interface BarSeries {
  name: string;
  data: (number | null)[];
  color?: string;
}

export function BarChart({
  categories,
  series,
  format = "inr",
  height = 260,
  horizontal,
  stacked,
  signed,
  valueLabels,
  legend = true,
  onSelect,
  label,
}: {
  categories: string[];
  series: BarSeries[];
  format?: Format;
  height?: number;
  horizontal?: boolean;
  stacked?: boolean;
  /** Colour each bar by its sign (gain/loss) instead of by series. */
  signed?: boolean;
  /** Print the value at the bar tip. Only for a handful of bars. */
  valueLabels?: boolean;
  legend?: boolean;
  onSelect?: (category: string) => void;
  label?: string;
}) {
  const { chart: t } = useTheme();
  const colors = series.map((s, i) => s.color ?? seriesColor(t, i));
  const option = useMemo<Option>(() => {
    const fmt = valueFormat(format);
    const short = labelFormat(format);
    const cat = categoryAxis(t, categories, horizontal ? { inverse: true, axisLine: { show: false }, axisLabel: { color: t.ink2, fontSize: 12, margin: 10 } } : {});
    const val = valueAxis(t, format, { scale: false });
    const radius = (v: number | null) => {
      const up = (v ?? 0) >= 0;
      if (stacked) return 0;
      if (horizontal) return up ? [0, 4, 4, 0] : [4, 0, 0, 4];
      return up ? [4, 4, 0, 0] : [0, 0, 4, 4];
    };
    return {
      ...baseOption(t),
      grid: { left: 4, right: valueLabels && horizontal ? 64 : 10, top: valueLabels && !horizontal ? 22 : 10, bottom: 2, containLabel: true },
      tooltip: tooltipBase(t, {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: alpha(t.name === "dark" ? "#ffffff" : "#000000", 0.04) } },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) =>
          tip(
            t,
            params[0].axisValue,
            params.filter((p) => p.value != null).map((p) => ({
              color: signed ? ((p.value as number) >= 0 ? t.gain : t.loss) : colors[p.seriesIndex],
              label: p.seriesName,
              value: fmt(p.value),
            })),
          ),
      }),
      xAxis: horizontal ? val : cat,
      yAxis: horizontal ? cat : val,
      series: series.map((s, i) => ({
        name: s.name,
        type: "bar",
        stack: stacked ? "total" : undefined,
        barMaxWidth: 24,
        barMinHeight: 1,
        barGap: "12%",
        cursor: onSelect ? "pointer" : "default",
        data: s.data.map((v) => ({
          value: v,
          itemStyle: {
            color: signed ? ((v ?? 0) >= 0 ? t.gain : t.loss) : colors[i],
            borderRadius: radius(v),
            ...(stacked ? { borderColor: t.surface, borderWidth: 1 } : {}),
          },
        })),
        label: valueLabels
          ? { show: true, position: horizontal ? "right" : "top", color: t.ink2, fontSize: 11, fontFamily: FONT, formatter: (p: { value: number }) => short(p.value) }
          : undefined,
        emphasis: { focus: "none", itemStyle: { opacity: 0.85 } },
      })),
    };
  }, [t, categories, series, format, horizontal, stacked, signed, valueLabels, onSelect, colors.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {legend && !signed && <Legend items={series.map((s, i) => ({ color: colors[i], label: s.name }))} />}
      <EChart option={option} height={height} label={label} onClick={onSelect ? (p) => onSelect(p.name) : undefined} />
    </div>
  );
}

// ---------------------------------------------------------------- heatmap
/** Square matrix on a blue–grey–red scale: correlation between holdings. */
export function CorrelationHeatmap({ symbols, matrix, height, label }: { symbols: string[]; matrix: (number | null)[][]; height?: number; label?: string }) {
  const { chart: t } = useTheme();
  const n = symbols.length;
  const size = height ?? Math.min(560, Math.max(260, n * 34 + 70));
  // Cell values only fit when the grid has room; on a phone the tooltip carries them.
  const roomy = typeof window === "undefined" || window.innerWidth >= 1024;
  const option = useMemo<Option>(() => {
    const cells: Option[] = [];
    matrix.forEach((row, y) =>
      row.forEach((v, x) => {
        if (v == null) return;
        // The diagonal (a holding against itself) is drawn neutral, not as a perfect +1.
        const shown = x === y ? 0 : v;
        cells.push({ value: [x, y, shown], label: { color: textOn(diverging(t, shown)) } });
      }),
    );
    const axis = (extra: Option): Option => ({
      type: "category",
      data: symbols,
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: { color: t.ink2, fontSize: 11, interval: 0, ...extra },
    });
    return {
      animation: false,
      textStyle: { fontFamily: FONT },
      grid: { left: 4, right: 4, top: 4, bottom: 4, containLabel: true },
      tooltip: tooltipBase(t, {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          const [x, y, v] = p.value as [number, number, number];
          return x === y ? tip(t, symbols[x], [{ label: "Itself", value: "1.00" }]) : tip(t, `${symbols[y]} × ${symbols[x]}`, [{ color: p.color, label: "Correlation", value: v.toFixed(2) }]);
        },
      }),
      xAxis: axis({ rotate: n > 9 ? 45 : 0, position: "bottom" }),
      yAxis: { ...axis({}), inverse: true },
      visualMap: { show: false, type: "continuous", min: -1, max: 1, dimension: 2, inRange: { color: [t.cool, t.neutral, t.warm] } },
      series: [
        {
          type: "heatmap",
          data: cells,
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
          label: { show: n <= (roomy ? 16 : 7), fontSize: n > 10 ? 10 : 11, fontFamily: FONT, formatter: (p: { value: [number, number, number] }) => (p.value[0] === p.value[1] ? "" : p.value[2].toFixed(2)) },
          emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1.5 } },
        },
      ],
    };
  }, [t, symbols, matrix, n, roomy]);
  return (
    <div>
      <EChart option={option} height={size} label={label} />
      <DivergingKey left="−1 · move opposite" mid="0 · unrelated" right="+1 · move together" low={t.cool} high={t.warm} neutral={t.neutral} />
    </div>
  );
}

/** Gradient key for a diverging scale. */
export function DivergingKey({ left, mid, right, low, high, neutral }: { left: string; mid?: string; right: string; low: string; high: string; neutral: string }) {
  return (
    <div className="mt-3">
      <div className="h-1.5 rounded-full" style={{ background: `linear-gradient(90deg, ${low}, ${neutral} 50%, ${high})` }} />
      <div className="mt-1.5 flex justify-between text-[11px] text-muted">
        <span>{left}</span>
        {mid && <span>{mid}</span>}
        <span>{right}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- treemap
export interface TreemapItem {
  symbol: string;
  name: string;
  sector: string;
  change_pct: number;
  size: number;
}

/** Market map: tile area is company size, colour is today's move (labelled on every tile). */
export function MarketTreemap({ items, height = 460, onSelect, label }: { items: TreemapItem[]; height?: number; onSelect?: (symbol: string) => void; label?: string }) {
  const { chart: t } = useTheme();
  const option = useMemo<Option>(() => {
    const groups = new Map<string, TreemapItem[]>();
    items.forEach((item) => groups.set(item.sector, [...(groups.get(item.sector) ?? []), item]));
    return {
      animationDuration: 300,
      tooltip: tooltipBase(t, {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) =>
          p.data.symbol
            ? tip(t, `${p.data.symbol} · ${p.data.sector}`, [{ label: p.data.fullName, value: "" }, { color: p.color, label: "Today", value: signedPct(p.data.change) }])
            : tip(t, p.name, [{ label: "Stocks", value: String(p.data.children?.length ?? "") }]),
      }),
      series: [
        {
          type: "treemap",
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          left: 0, right: 0, top: 0, bottom: 0,
          squareRatio: 1.2,
          upperLabel: { show: true, height: 22, color: t.ink2, fontSize: 11, fontWeight: 600, fontFamily: FONT, padding: [0, 0, 0, 4], formatter: "{b}" },
          label: {
            show: true,
            fontFamily: FONT,
            fontSize: 12,
            lineHeight: 15,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            formatter: (p: any) => `{s|${p.data.symbol}}\n${signedPct(p.data.change)}`,
            rich: { s: { fontWeight: 600, fontSize: 12, lineHeight: 15 } },
          },
          itemStyle: { borderColor: t.surface, borderWidth: 1, gapWidth: 2 },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 8 }, upperLabel: { show: false } },
            { itemStyle: { borderColor: t.surface, borderWidth: 0, gapWidth: 2 }, upperLabel: { show: true, formatter: "{b}" } },
          ],
          data: [...groups.entries()]
            .map(([sector, rows]) => ({
              name: sector,
              itemStyle: { color: t.surface },
              children: rows.map((r) => {
                const fill = signedColor(t, r.change_pct, 3);
                return { name: r.symbol, symbol: r.symbol, fullName: r.name, sector: r.sector, change: r.change_pct, value: Math.max(r.size, 1), itemStyle: { color: fill, borderRadius: 3 }, label: { color: textOn(fill) } };
              }),
            }))
            .sort((a, b) => b.children.reduce((s, c) => s + c.value, 0) - a.children.reduce((s, c) => s + c.value, 0)),
        },
      ],
    };
  }, [t, items]);
  return (
    <div>
      <EChart option={option} height={height} label={label} onClick={(p) => p.data?.symbol && onSelect?.(p.data.symbol)} />
      <DivergingKey left="−3% or worse" mid="Flat" right="+3% or better" low={t.loss} high={t.gain} neutral={t.neutral} />
    </div>
  );
}

// ---------------------------------------------------------------- candles
export interface TradeMarker {
  date: string;
  price: number;
  side: "buy" | "sell";
  label?: string;
}

/** Price chart with optional candles, volume panel, indicator overlays and trade markers. */
export function PriceChart({
  candles,
  mode = "line",
  overlays = [],
  markers = [],
  volume = true,
  height = 380,
  baseline,
  intraday,
  zoom = true,
  label,
}: {
  candles: Candle[];
  mode?: "line" | "candles";
  overlays?: { name: string; values: (number | null)[] }[];
  markers?: TradeMarker[];
  volume?: boolean;
  height?: number;
  /** Reference price (previous close) drawn across an intraday chart. */
  baseline?: number;
  intraday?: boolean;
  zoom?: boolean;
  label?: string;
}) {
  const { chart: t } = useTheme();
  const overlayColors = overlays.map((_, i) => seriesColor(t, i + 1));
  const option = useMemo<Option>(() => {
    const times = candles.map((c) => c.t);
    const up = candles.length ? candles[candles.length - 1].c >= (baseline ?? candles[0].c) : true;
    const lineColor = mode === "line" ? (up ? t.gain : t.loss) : t.series[0];
    // A multi-day intraday chart is labelled at the first bar of each session; a single day by the clock.
    const sessions = new Set(times.map((time) => time.slice(0, 10)));
    const firstOfDay = new Set(times.filter((time, i) => i === 0 || times[i - 1].slice(0, 10) !== time.slice(0, 10)));
    const multiDay = intraday && sessions.size > 1;
    const tick = (value: string) => {
      if (!intraday) return "";
      const d = new Date(value);
      if (multiDay) return `${d.getDate()} ${d.toLocaleString("en-IN", { month: "short" })}`;
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const xAxis = (index: number, show: boolean): Option =>
      intraday
        ? {
            ...categoryAxis(t, times, {
              boundaryGap: mode === "candles",
              axisLabel: {
                color: t.muted, fontSize: 11, formatter: tick, hideOverlap: true, show,
                ...(multiDay ? { interval: (_: number, value: string) => firstOfDay.has(value), alignMinLabel: "left" } : {}),
              },
            }),
            gridIndex: index,
          }
        : {
            ...timeAxis(t, times, { boundaryGap: mode === "candles", ...(show ? {} : { axisLabel: { show: false }, axisLine: { show: false } }) }),
            gridIndex: index,
          };
    const title = (value: string) => {
      if (!intraday) return longDate(value);
      const d = new Date(value);
      return `${longDate(value)} · ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    };
    const price = valueFormat("price");
    return {
      ...baseOption(t),
      axisPointer: { link: [{ xAxisIndex: "all" }] },
      grid: volume
        ? [{ left: 4, right: 10, top: 10, bottom: "24%", containLabel: true }, { left: 4, right: 10, top: "80%", bottom: 2, containLabel: true }]
        : [{ left: 4, right: 10, top: 10, bottom: 2, containLabel: true }],
      tooltip: tooltipBase(t, {
        trigger: "axis",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          const c = candles[params[0].dataIndex];
          if (!c) return "";
          const rows: TipRow[] =
            mode === "candles"
              ? [{ label: "Open", value: price(c.o) }, { label: "High", value: price(c.h) }, { label: "Low", value: price(c.l) }, { label: "Close", value: price(c.c) }]
              : [{ color: lineColor, label: "Price", value: price(c.c) }];
          overlays.forEach((o, i) => {
            const v = o.values[params[0].dataIndex];
            if (v != null) rows.push({ color: overlayColors[i], label: o.name, value: price(v) });
          });
          return tip(t, title(c.t), rows, volume && c.v ? `Volume ${number(c.v)}` : undefined);
        },
      }),
      xAxis: volume ? [xAxis(0, false), xAxis(1, true)] : [xAxis(0, true)],
      yAxis: [
        {
          ...valueAxis(t, "price"),
          gridIndex: 0,
          // Keep the previous-close line inside the plot on days that gap away from it.
          ...(baseline ? { min: (v: { min: number }) => Math.min(v.min, baseline), max: (v: { max: number }) => Math.max(v.max, baseline) } : {}),
        },
        ...(volume ? [{ type: "value", gridIndex: 1, axisLabel: { show: false }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false } }] : []),
      ],
      dataZoom: zoom ? [{ type: "inside", xAxisIndex: volume ? [0, 1] : [0], zoomOnMouseWheel: true, moveOnMouseMove: true }] : undefined,
      series: [
        mode === "candles"
          ? {
              type: "candlestick",
              name: "Price",
              data: candles.map((c) => [c.o, c.c, c.l, c.h]),
              barMaxWidth: 14,
              itemStyle: { color: t.gain, color0: t.loss, borderColor: t.gain, borderColor0: t.loss, borderWidth: 1 },
            }
          : {
              type: "line",
              name: "Price",
              data: candles.map((c) => c.c),
              showSymbol: false,
              symbolSize: 8,
              lineStyle: { width: 2, color: lineColor, join: "round" },
              itemStyle: { color: lineColor, borderColor: t.surface, borderWidth: 2 },
              areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(lineColor, 0.16) }, { offset: 1, color: alpha(lineColor, 0) }] } },
              markLine: baseline
                ? { silent: true, symbol: "none", animation: false, data: [{ yAxis: baseline, lineStyle: { color: t.muted, width: 1, type: [3, 3] }, label: { show: true, formatter: "Prev close", color: t.muted, fontSize: 10, position: "insideEndTop" } }] }
                : undefined,
            },
        ...overlays.map((o, i) => ({
          type: "line",
          name: o.name,
          data: o.values,
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: overlayColors[i] },
          itemStyle: { color: overlayColors[i] },
          z: 2,
        })),
        ...(markers.length
          ? [
              {
                type: "scatter",
                name: "Trades",
                data: markers.map((m) => ({
                  value: [m.date, m.price],
                  symbol: "triangle",
                  symbolRotate: m.side === "buy" ? 0 : 180,
                  symbolOffset: [0, m.side === "buy" ? 12 : -12],
                  itemStyle: { color: m.side === "buy" ? t.gain : t.loss, borderColor: t.surface, borderWidth: 1.5 },
                })),
                symbolSize: 11,
                z: 5,
                tooltip: { show: false },
              },
            ]
          : []),
        ...(volume
          ? [
              {
                type: "bar",
                name: "Volume",
                xAxisIndex: 1,
                yAxisIndex: 1,
                barMaxWidth: 6,
                data: candles.map((c) => ({ value: c.v, itemStyle: { color: alpha(c.c >= c.o ? t.gain : t.loss, 0.45), borderRadius: [1, 1, 0, 0] } })),
              },
            ]
          : []),
      ],
    };
  }, [t, candles, mode, overlays, markers, volume, baseline, intraday, zoom, overlayColors.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      {overlays.length > 0 && (
        <Legend
          items={[{ color: mode === "candles" ? t.ink2 : t.gain, label: "Price" }, ...overlays.map((o, i) => ({ color: overlayColors[i], label: o.name }))]}
        />
      )}
      <EChart option={option} height={height} label={label} />
    </div>
  );
}

// -------------------------------------------------------------- fan chart
/** Monte Carlo cone: the middle 50% and 90% of simulated paths around the median. */
export function FanChart({
  months,
  bands,
  invested,
  samples = [],
  height = 360,
  label,
}: {
  months: number[];
  bands: Record<keyof Percentiles, number[]>;
  invested: number[];
  samples?: number[][];
  height?: number;
  label?: string;
}) {
  const { chart: t } = useTheme();
  const c = t.series[0];
  const option = useMemo<Option>(() => {
    const labels = months.map((m) => String(m));
    const band = (name: string, low: number[], high: number[], opacity: number): Option[] => [
      { type: "line", name: `${name}-base`, stack: name, data: low, lineStyle: { opacity: 0 }, showSymbol: false, silent: true, tooltip: { show: false } },
      { type: "line", name, stack: name, data: high.map((v, i) => v - low[i]), lineStyle: { opacity: 0 }, showSymbol: false, silent: true, areaStyle: { color: alpha(c, opacity) } },
    ];
    return {
      ...baseOption(t),
      tooltip: tooltipBase(t, {
        trigger: "axis",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) => {
          const i = params[0].dataIndex;
          const m = months[i];
          const when = m === 0 ? "Today" : m % 12 === 0 ? `Year ${m / 12}` : `Year ${Math.floor(m / 12)}, month ${m % 12}`;
          return tip(t, when, [
            { label: "95th percentile", value: inr(bands.p95[i]) },
            { label: "75th percentile", value: inr(bands.p75[i]) },
            { color: c, label: "Median", value: inr(bands.p50[i]) },
            { label: "25th percentile", value: inr(bands.p25[i]) },
            { label: "5th percentile", value: inr(bands.p5[i]) },
            { color: t.muted, label: "Amount invested", value: inr(invested[i]), dashed: true },
          ]);
        },
      }),
      xAxis: categoryAxis(t, labels, {
        boundaryGap: false,
        axisLabel: { color: t.muted, fontSize: 11, interval: (i: number) => months[i] % 12 === 0, formatter: (v: string) => (+v === 0 ? "Now" : `${+v / 12}y`) },
      }),
      yAxis: valueAxis(t, "inr", { scale: false }),
      series: [
        ...band("5th–95th", bands.p5, bands.p95, 0.1),
        ...band("25th–75th", bands.p25, bands.p75, 0.16),
        ...samples.slice(0, 24).map((path, i) => ({ type: "line", name: `path-${i}`, data: path, showSymbol: false, silent: true, lineStyle: { width: 0.75, color: alpha(c, 0.28) }, tooltip: { show: false }, z: 2 })),
        { type: "line", name: "Invested", data: invested, showSymbol: false, lineStyle: { width: 1.5, color: t.muted, type: [4, 3] }, z: 3 },
        { type: "line", name: "Median", data: bands.p50, showSymbol: false, symbolSize: 8, lineStyle: { width: 2, color: c }, itemStyle: { color: c, borderColor: t.surface, borderWidth: 2 }, z: 4 },
      ],
    };
  }, [t, months, bands, invested, samples, c]);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <LegendItem color={c} label="Median outcome" />
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: alpha(c, 0.36) }} />Middle 50% of paths</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-sm" style={{ background: alpha(c, 0.14) }} />Middle 90% of paths</span>
        <LegendItem color={t.muted} label="Amount invested" dashed />
      </div>
      <EChart option={option} height={height} label={label} />
    </div>
  );
}

// -------------------------------------------------------------- histogram
export function HistogramChart({
  edges,
  counts,
  format = "pct",
  height = 240,
  signed,
  markers = [],
  label,
}: {
  /** Bin boundaries: one more than `counts`. */
  edges: number[];
  counts: number[];
  format?: Format;
  height?: number;
  /** Colour bins below zero as losses and above as gains. */
  signed?: boolean;
  /** Labelled vertical lines at values on the x scale. */
  markers?: { value: number; label: string }[];
  label?: string;
}) {
  const { chart: t } = useTheme();
  const option = useMemo<Option>(() => {
    const short = axisFormat(format);
    const full = valueFormat(format);
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const fill = (i: number) => (signed ? ((edges[i] + edges[i + 1]) / 2 < 0 ? t.loss : t.gain) : t.series[0]);
    const inRange = markers.filter((m) => m.value >= edges[0] && m.value <= edges[edges.length - 1]);
    return {
      ...baseOption(t),
      grid: { left: 8, right: 14, top: inRange.length ? 26 : 10, bottom: 2, containLabel: true },
      tooltip: tooltipBase(t, {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => {
          const i = p.dataIndex as number;
          return tip(t, `${full(edges[i])} to ${full(edges[i + 1])}`, [{ color: fill(i), label: "Share of outcomes", value: pct((counts[i] / total) * 100, 1) }]);
        },
      }),
      // A true value axis, so marker lines land exactly on their value rather than on a bin centre.
      xAxis: {
        type: "value",
        min: edges[0],
        max: edges[edges.length - 1],
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, margin: 10, alignMinLabel: "left", alignMaxLabel: "right", formatter: (v: number) => short(v) },
        splitLine: { show: false },
        splitNumber: 6,
      },
      yAxis: { ...valueAxis(t, "number", { scale: false }), axisLabel: { show: false } },
      series: [
        {
          type: "custom",
          encode: { x: [0, 1], y: 2 },
          data: counts.map((count, i) => [edges[i], edges[i + 1], count]),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          renderItem: (params: any, api: any) => {
            const from = api.coord([api.value(0), 0]);
            const to = api.coord([api.value(1), api.value(2)]);
            const width = Math.max(to[0] - from[0] - 2, 1); // 2px surface gap between neighbours
            return {
              type: "rect",
              shape: { x: from[0] + 1, y: to[1], width, height: Math.max(from[1] - to[1], 0), r: [3, 3, 0, 0] },
              style: { fill: fill(params.dataIndex) },
              emphasis: { style: { opacity: 0.82 } },
            };
          },
          markLine: inRange.length
            ? {
                silent: true,
                symbol: "none",
                animation: false,
                data: inRange.map((m) => ({
                  xAxis: m.value,
                  lineStyle: { color: t.ink2, width: 1, type: [3, 3] },
                  label: { show: true, formatter: m.label, color: t.ink2, fontSize: 11, fontFamily: FONT, position: "end" },
                })),
              }
            : undefined,
        },
      ],
    };
  }, [t, edges, counts, format, signed, markers]);
  return <EChart option={option} height={height} label={label} />;
}

// ---------------------------------------------------------------- scatter
export interface ScatterPoint {
  name: string;
  x: number;
  y: number;
  /** Relative bubble size, e.g. portfolio weight. */
  size?: number;
}

/** Risk against return, one bubble per holding. Labelled directly, so one colour is enough. */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  xFormat = "pct",
  yFormat = "signedPct",
  height = 300,
  onSelect,
  label,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat?: Format;
  yFormat?: Format;
  height?: number;
  onSelect?: (name: string) => void;
  label?: string;
}) {
  const { chart: t } = useTheme();
  const option = useMemo<Option>(() => {
    const max = Math.max(...points.map((p) => p.size ?? 1), 1);
    const fx = valueFormat(xFormat);
    const fy = valueFormat(yFormat);
    const named = { nameTextStyle: { color: t.muted, fontSize: 11, fontFamily: FONT }, nameGap: 28 };
    return {
      ...baseOption(t),
      grid: { left: 8, right: 16, top: 12, bottom: 26, containLabel: true },
      tooltip: tooltipBase(t, {
        trigger: "item",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (p: any) => tip(t, p.data.name, [{ label: xLabel, value: fx(p.data.value[0]) }, { label: yLabel, value: fy(p.data.value[1]) }]),
      }),
      xAxis: { ...valueAxis(t, xFormat), name: xLabel, nameLocation: "middle", ...named, axisLine: { show: true, lineStyle: { color: t.axis } } },
      yAxis: { ...valueAxis(t, yFormat), name: yLabel, nameLocation: "end", nameTextStyle: { color: t.muted, fontSize: 11, fontFamily: FONT, align: "left" }, nameGap: 6 },
      series: [
        {
          type: "scatter",
          cursor: onSelect ? "pointer" : "default",
          data: points.map((p) => ({ name: p.name, value: [p.x, p.y], symbolSize: 10 + Math.sqrt((p.size ?? 1) / max) * 22 })),
          itemStyle: { color: alpha(t.series[0], 0.75), borderColor: t.surface, borderWidth: 2 },
          label: { show: points.length <= 24, formatter: "{b}", position: "top", color: t.ink2, fontSize: 10.5, fontFamily: FONT, distance: 4 },
          labelLayout: { hideOverlap: true },
          emphasis: { scale: 1.1, itemStyle: { color: t.series[0] } },
          markLine: { silent: true, symbol: "none", animation: false, label: { show: false }, data: [{ yAxis: 0, lineStyle: { color: t.axis, width: 1, type: "solid" } }] },
        },
      ],
    };
  }, [t, points, xLabel, yLabel, xFormat, yFormat, onSelect]);
  return <EChart option={option} height={height} label={label} onClick={onSelect ? (p) => onSelect(p.data.name) : undefined} />;
}
