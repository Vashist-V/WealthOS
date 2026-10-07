import { CalendarClock, Coins, FileText, Split } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { BarChart } from "@/components/charts";
import { Card, ErrorState, Skeleton } from "@/components/ui";
import { date, price, quantity, todayIso } from "@/lib/format";
import { useStockEvents } from "@/lib/queries";
import { daysBetween, relativeDay } from "./shared";

const RECENT = 5;

function Heading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-medium text-muted">{children}</h3>;
}

function Line({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: string }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted ring-1 ring-line [&>svg]:size-3.5" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{label}</span>
      <span className="shrink-0 text-right">
        <span className="num block text-[13px] font-medium text-ink">{value}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </li>
  );
}

/** Dividend history, splits and bonuses, and the dates coming up for one stock. */
export function CorporateActionsCard({ symbol, className }: { symbol: string; className?: string }) {
  const events = useStockEvents(symbol);
  const [all, setAll] = useState(false);
  const data = events.data;
  const today = todayIso();

  const upcoming = useMemo(() => {
    if (!data) return [];
    const rows: { key: string; icon: ReactNode; label: string; when: string }[] = [];
    const results = (data.upcoming.earnings_dates ?? []).map((d) => d.slice(0, 10)).filter((d) => d >= today).sort();
    if (results.length) rows.push({ key: "results", icon: <FileText />, label: "Quarterly results (expected)", when: results[0] });
    const exDate = data.upcoming.ex_dividend_date?.slice(0, 10);
    if (exDate && exDate >= today) rows.push({ key: "ex", icon: <Coins />, label: "Ex-dividend date", when: exDate });
    return rows.sort((a, b) => a.when.localeCompare(b.when));
  }, [data, today]);

  const byYear = useMemo(
    () => ({
      categories: (data?.dividends_by_year ?? []).slice(-10).map((d) => d.year),
      series: [{ name: "Dividend per share", data: (data?.dividends_by_year ?? []).slice(-10).map((d) => d.amount) }],
    }),
    [data],
  );

  const nothing = !!data && data.dividends.length === 0 && data.splits.length === 0 && upcoming.length === 0;
  const dividends = data ? (all ? data.dividends : data.dividends.slice(0, RECENT)) : [];

  return (
    <Card title="Corporate actions" description="Dividends, splits and the dates coming up" className={className}>
      {!data ? (
        events.isError ? (
          <ErrorState error={events.error} onRetry={() => events.refetch()} />
        ) : (
          <Skeleton className="h-64 w-full" />
        )
      ) : nothing ? (
        <p className="py-8 text-center text-[13px] leading-relaxed text-muted">
          No dividends, splits or upcoming dates are on record for {symbol}.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          <section>
            <Heading>Coming up</Heading>
            {upcoming.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] text-muted">
                <CalendarClock className="size-4 shrink-0" aria-hidden />
                No results or ex-dividend date has been announced.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((u) => (
                  <Line key={u.key} icon={u.icon} label={u.label} value={date(u.when)} sub={relativeDay(daysBetween(today, u.when))} />
                ))}
              </ul>
            )}
          </section>

          {byYear.categories.length > 0 && (
            <section>
              <Heading>Dividend per share by year (₹)</Heading>
              <BarChart
                label={`${symbol} dividend per share by calendar year`}
                format="price"
                height={170}
                valueLabels={byYear.categories.length <= 8}
                categories={byYear.categories}
                series={byYear.series}
              />
            </section>
          )}

          {data.dividends.length > 0 && (
            <section>
              <Heading>Recent dividends</Heading>
              <ul className="divide-y divide-line">
                {dividends.map((d, i) => (
                  <li key={`${d.date}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-[13px]">
                    <span className="text-ink-2">
                      Ex-date <span className="num text-ink">{date(d.date)}</span>
                    </span>
                    <span className="num shrink-0 font-medium text-ink">
                      {price(d.amount)} <span className="font-normal text-muted">per share</span>
                    </span>
                  </li>
                ))}
              </ul>
              {data.dividends.length > RECENT && (
                <button type="button" className="mt-2 text-xs font-medium text-accent hover:underline" onClick={() => setAll((v) => !v)}>
                  {all ? "Show fewer" : `Show all ${data.dividends.length}`}
                </button>
              )}
            </section>
          )}

          {data.splits.length > 0 && (
            <section>
              <Heading>Splits and bonuses</Heading>
              <ul className="divide-y divide-line">
                {data.splits.map((s, i) => (
                  <Line key={`${s.date}-${i}`} icon={<Split />} label={`Each share became ${quantity(s.ratio)}`} value={date(s.date)} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}
