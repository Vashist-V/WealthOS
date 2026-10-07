import { useMemo } from "react";
import { FanChart, HistogramChart } from "@/components/charts";
import { Card, StatTile } from "@/components/ui";
import { compact, inr, number, pct } from "@/lib/format";
import type { MonteCarloResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ScenarioNote, tidyPct } from "./shared";

// Five tiles in reading order: 2 + 1 + 2 on a phone, 3 + 2 on mid widths, one row on wide screens.
export const PERCENTILE_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-6 2xl:grid-cols-5";
export const PERCENTILE_SPANS = [
  "sm:col-span-2 2xl:col-span-1",
  "sm:col-span-2 2xl:col-span-1",
  "col-span-2 2xl:col-span-1",
  "sm:col-span-3 2xl:col-span-1",
  "sm:col-span-3 2xl:col-span-1",
];

/** "0.1%" for a probability, with very small non-zero chances kept visible. */
function chance(p: number): string {
  if (p > 0 && p < 0.001) return "<0.1%";
  if (p < 1 && p > 0.999) return ">99.9%";
  return pct(p * 100, 1);
}

/** Everything a finished simulation shows: percentiles, odds, the cone of paths and where they ended. */
export function MonteCarloResults({ result, stale }: { result: MonteCarloResult; stale: boolean }) {
  const a = result.assumptions;
  const t = result.terminal;
  const markers = useMemo(() => {
    const [low, high] = [result.histogram.edges[0], result.histogram.edges[result.histogram.edges.length - 1]];
    return [
      { value: t.p50, label: "Median" },
      { value: result.total_invested, label: "Invested" },
    ].filter((m) => m.value >= low && m.value <= high);
  }, [result, t.p50]);
  const investedOffChart = !markers.some((m) => m.label === "Invested");
  const pathsBelow = Math.round(result.probability_of_loss * result.paths);

  const basis =
    a.method === "bootstrap"
      ? `monthly returns resampled from the last three years of the current holdings (${tidyPct(a.expected_return * 100)} a year on average, ${tidyPct(a.volatility * 100)} volatility)`
      : `${tidyPct(a.expected_return * 100)} expected return and ${tidyPct(a.volatility * 100)} volatility a year, log-normal`;

  return (
    <div className={cn("flex min-w-0 flex-col gap-4 transition-opacity", stale && "opacity-60")}>
      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">Value after {a.years} year{a.years === 1 ? "" : "s"}</h2>
          <p className="text-xs text-muted">{number(result.paths)} simulated paths · {basis}</p>
        </div>
        <div className={PERCENTILE_GRID}>
          <StatTile className={PERCENTILE_SPANS[0]} label="5th percentile" value={compact(t.p5)} sub="1 in 20 paths ends lower" hint="Only 5% of the simulated paths finished below this value. A poor outcome under these assumptions, not a floor." />
          <StatTile className={PERCENTILE_SPANS[0]} label="25th percentile" value={compact(t.p25)} sub="1 in 4 paths ends lower" hint="A quarter of the simulated paths finished below this value." />
          <StatTile className={PERCENTILE_SPANS[2]} label="Median" value={compact(t.p50)} sub="Half end higher, half lower" hint="The middle outcome: half of the simulated paths finished above this value and half below." />
          <StatTile className={PERCENTILE_SPANS[3]} label="75th percentile" value={compact(t.p75)} sub="1 in 4 paths ends higher" hint="Three quarters of the simulated paths finished below this value." />
          <StatTile className={PERCENTILE_SPANS[3]} label="95th percentile" value={compact(t.p95)} sub="1 in 20 paths ends higher" hint="Only 5% of the simulated paths finished above this value. A strong outcome under these assumptions, not a ceiling." />
        </div>
      </div>

      <div className={cn("grid grid-cols-2 gap-3", a.target ? "2xl:grid-cols-4" : "sm:grid-cols-3")}>
        <StatTile
          label="Amount invested"
          value={compact(result.total_invested)}
          sub={a.monthly > 0 ? `${inr(a.initial)} now + ${inr(a.monthly)} a month` : "No further investment"}
          hint="The starting value plus every monthly investment over the period, before any growth."
        />
        <StatTile
          label="Chance of loss"
          value={chance(result.probability_of_loss)}
          sub={`${number(pathsBelow)} of ${number(result.paths)} paths end below the amount invested`}
          hint="The share of simulated paths whose final value is lower than the amount invested."
        />
        {a.target != null && result.probability_of_target != null && (
          <StatTile
            label={`Chance of reaching ${compact(a.target)}`}
            value={chance(result.probability_of_target)}
            sub="Paths ending at or above the target"
            hint="The share of simulated paths whose final value is at least the target you set."
          />
        )}
        <StatTile
          label="Median multiple"
          value={result.median_multiple == null ? "—" : `${number(result.median_multiple, 2)}×`}
          sub="Median value ÷ amount invested"
          hint="How many times the amount invested the median path ends at. 2.00× means the money doubled."
          className={a.target ? undefined : "max-sm:col-span-2"}
        />
      </div>

      <Card title="Range of paths over time" description="The shaded bands hold the middle 50% and 90% of simulated paths; the thin lines are individual paths">
        <FanChart label="Simulated portfolio value over time" months={result.months} bands={result.bands} invested={result.invested} samples={result.sample_paths} />
      </Card>

      <Card
        title="Where the paths ended"
        description={`Final values after ${a.years} year${a.years === 1 ? "" : "s"}. The most extreme 0.5% at each end is left out${investedOffChart ? `; the amount invested (${compact(result.total_invested)}) lies outside this range` : ""}.`}
      >
        <HistogramChart label="Distribution of final portfolio values" edges={result.histogram.edges} counts={result.histogram.counts} format="inr" markers={markers} />
      </Card>

      <ScenarioNote>
        This is scenario analysis built from historical return and volatility assumptions. It is not a prediction or a guarantee: real markets can fall further, stay down longer or behave unlike the past. Nothing here changes your real portfolio.
      </ScenarioNote>
    </div>
  );
}
