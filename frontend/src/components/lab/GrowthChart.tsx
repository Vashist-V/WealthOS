import { useMemo } from "react";
import { alpha, baseOption, categoryAxis, EChart, tip, tooltipBase, valueAxis, type Option } from "@/components/charts/EChart";
import { LegendItem } from "@/components/ui";
import { inr } from "@/lib/format";
import { seriesColor, useTheme } from "@/lib/theme";

export interface GrowthSeries {
  name: string;
  /** Value at the end of each year, starting with today at index 0. */
  values: number[];
}

/**
 * Projected value by year, one line per plan. The chart kit's time-series
 * chart needs calendar dates; a projection is counted in years from today, so
 * this draws the same marks on a "Year n" axis instead.
 */
export function GrowthChart({ plans, height = 300, label }: { plans: GrowthSeries[]; height?: number; label?: string }) {
  const { chart: t } = useTheme();
  const years = Math.max(1, ...plans.map((p) => p.values.length - 1));
  const option = useMemo<Option>(() => {
    const ticks = Array.from({ length: years + 1 }, (_, i) => String(i));
    return {
      ...baseOption(t),
      tooltip: tooltipBase(t, {
        trigger: "axis",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any[]) =>
          tip(
            t,
            +params[0].axisValue === 0 ? "Today" : `Year ${params[0].axisValue}`,
            params.filter((p) => p.value != null).map((p) => ({ color: seriesColor(t, p.seriesIndex), label: p.seriesName, value: inr(p.value) })),
          ),
      }),
      xAxis: categoryAxis(t, ticks, {
        boundaryGap: false,
        axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, margin: 10, formatter: (v: string) => (+v === 0 ? "Now" : `Year ${v}`) },
      }),
      yAxis: valueAxis(t, "inr", { scale: false }),
      series: plans.map((plan, i) => {
        const color = seriesColor(t, i);
        return {
          name: plan.name,
          type: "line",
          data: plan.values,
          showSymbol: years <= 15,
          symbol: "circle",
          symbolSize: years <= 15 ? 6 : 8,
          lineStyle: { width: 2, color, join: "round", cap: "round" },
          itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
          emphasis: { scale: false, lineStyle: { width: 2 } },
          areaStyle:
            plans.length === 1
              ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: alpha(color, 0.18) }, { offset: 1, color: alpha(color, 0) }] } }
              : undefined,
        };
      }),
    };
  }, [t, plans, years]);

  return (
    <div>
      {plans.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {plans.map((plan, i) => (
            <LegendItem key={i} color={seriesColor(t, i)} label={plan.name} />
          ))}
        </div>
      )}
      <EChart option={option} height={height} label={label} />
    </div>
  );
}
