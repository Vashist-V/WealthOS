/**
 * The news centre: headlines about every company the app tracks (or only the
 * user's own), each marked good, bad or neutral for the stock, with the
 * companies whose news leans clearly good (in green) or clearly bad beside it.
 * Everything here is a summary of what is being reported, not advice.
 */
import { Loader2, Newspaper, SearchX, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { NewsRow, SignalCard } from "@/components/news/News";
import { SearchField } from "@/components/portfolio/shared";
import { useDebounced } from "@/components/forms/SymbolPicker";
import { Badge, Button, Card, EmptyState, ErrorState, Page, Segmented, Select, Skeleton } from "@/components/ui";
import { number } from "@/lib/format";
import { useNews } from "@/lib/queries";
import type { NewsQuery, NewsStock, NewsTone } from "@/lib/types";

type Scope = "all" | "mine";
type ToneFilter = "any" | NewsTone;
type Sort = NonNullable<NewsQuery["sort"]>;

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "important", label: "Biggest news first" },
  { value: "good", label: "Good news first" },
  { value: "bad", label: "Bad news first" },
];

function Signals({ title, hint, stocks, active, onPick, empty }: { title: string; hint: string; stocks: NewsStock[]; active: string | null; onPick: (s: string) => void; empty: string }) {
  return (
    <Card title={title} description={hint}>
      {stocks.length ? (
        // A strip to swipe through on a phone, so the headlines stay near the top; a column beside them on a wide screen.
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
          {stocks.slice(0, 6).map((s) => (
            <div key={s.symbol} className="w-64 shrink-0 lg:w-full">
              <SignalCard stock={s} active={active === s.symbol} onPick={onPick} />
            </div>
          ))}
        </div>
      ) : (
        <p className="py-2 text-[13px] text-muted">{empty}</p>
      )}
    </Card>
  );
}

export function NewsPage() {
  const [params, setParams] = useSearchParams();
  const scope: Scope = params.get("scope") === "mine" ? "mine" : "all";
  const tone = (["good", "bad", "neutral"].includes(params.get("tone") ?? "") ? params.get("tone") : "any") as ToneFilter;
  const sort = (SORTS.some((s) => s.value === params.get("sort")) ? params.get("sort") : "newest") as Sort;
  const symbol = params.get("symbol");
  const sector = params.get("sector");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(150);
  const q = useDebounced(search.trim(), 250);

  const set = (key: string, value: string | null) =>
    setParams(
      (now) => {
        const next = new URLSearchParams(now);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const news = useNews({ scope, tone: tone === "any" ? null : tone, sort, symbol, sector, q: q || null, limit });
  const data = news.data;
  const good = useMemo(() => (data?.stocks ?? []).filter((s) => s.signal === "good"), [data]);
  const bad = useMemo(() => (data?.stocks ?? []).filter((s) => s.signal === "bad"), [data]);
  const picked = symbol ? data?.stocks.find((s) => s.symbol === symbol) : null;
  const pick = (s: string) => set("symbol", symbol === s ? null : s);
  const gathering = !!data?.updating && !data.items.length;
  const matching = data ? (tone === "any" ? data.counts.all : data.counts[tone]) : 0;

  return (
    <Page
      title="News"
      description="Headlines about every company the app tracks, each marked good, bad or neutral for the stock. Green marks companies whose news is mostly good and whose long-term score is decent."
    >
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented<Scope>
            label="Whose news"
            value={scope}
            onChange={(v) => set("scope", v === "all" ? null : v)}
            options={[{ value: "all", label: "All stocks" }, { value: "mine", label: "My stocks" }]}
          />
          <Segmented<ToneFilter>
            label="Good or bad"
            value={tone}
            onChange={(v) => set("tone", v === "any" ? null : v)}
            options={[
              { value: "any", label: `All${data ? ` ${number(data.counts.all)}` : ""}` },
              { value: "good", label: <span className="text-gain">Good{data ? ` ${number(data.counts.good)}` : ""}</span> },
              { value: "bad", label: <span className="text-loss">Bad{data ? ` ${number(data.counts.bad)}` : ""}</span> },
              { value: "neutral", label: `Neutral${data ? ` ${number(data.counts.neutral)}` : ""}` },
            ]}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_12rem]">
          <SearchField value={search} onChange={setSearch} label="Search the news" placeholder="Search a company or a word in the headline" />
          <Select aria-label="Sort" value={sort} onChange={(e) => set("sort", e.target.value === "newest" ? null : e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
          <Select aria-label="Sector" value={sector ?? ""} onChange={(e) => set("sector", e.target.value || null)}>
            <option value="">All sectors</option>
            {(data?.sectors ?? []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
        {symbol && (
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <span className="text-muted">Showing news about</span>
            <Badge tone="accent" className="text-xs">
              {symbol}
              {picked ? ` · ${picked.name}` : ""}
              <button type="button" aria-label="Show all companies" onClick={() => set("symbol", null)} className="-mr-0.5 ml-0.5 rounded hover:bg-accent/15">
                <X className="size-3" />
              </button>
            </Badge>
            {picked && <span className="text-muted">{picked.reason}</span>}
          </div>
        )}
      </div>

      {news.isError && !data ? (
        <Card><ErrorState error={news.error} onRetry={() => news.refetch()} /></Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-4 lg:order-2 lg:col-span-4">
            <Signals
              title="Good signs"
              hint="Mostly good news this week, and a long-term score of 55 or more"
              stocks={good}
              active={symbol}
              onPick={pick}
              empty={data ? "No company's news leans clearly good this week." : "Looking…"}
            />
            <Signals
              title="Needs watching"
              hint="Mostly bad news this week"
              stocks={bad}
              active={symbol}
              onPick={pick}
              empty={data ? "No company's news leans clearly bad this week." : "Looking…"}
            />
          </div>

          <Card
            className="lg:order-1 lg:col-span-8"
            title={scope === "mine" ? "News about your stocks" : "All news"}
            description={
              data
                ? `${number(data.items.length)} of ${number(matching)} headline${matching === 1 ? "" : "s"} from the past two weeks${data.updating ? " · fetching the latest" : ""}`
                : "Gathering headlines"
            }
            action={news.isFetching && data ? <Loader2 className="size-4 animate-spin text-muted" aria-label="Refreshing" /> : undefined}
            bodyClassName="!pt-1"
          >
            {!data || gathering ? (
              <div className="flex flex-col gap-3 py-2" role="status">
                {gathering && (
                  <p className="flex items-center gap-2 text-[13px] text-muted">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Gathering news for every company the app tracks. The first time takes about a minute; this page fills in by itself.
                  </p>
                )}
                {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : scope === "mine" && !data.held.length ? (
              <EmptyState icon={<Newspaper />} title="You don't hold any stocks yet" description="Once you add trades, news about your stocks gathers here." action={<Button onClick={() => set("scope", null)}>See all news</Button>} />
            ) : !data.items.length ? (
              <EmptyState
                icon={<SearchX />}
                title="No headlines match"
                description="Nothing in the past two weeks fits these choices."
                action={
                  <Button
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setParams(scope === "mine" ? { scope } : {}, { replace: true });
                    }}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-line">
                {data.items.map((item) => <NewsRow key={item.id} item={item} onStock={pick} />)}
              </ul>
            )}
            {data && !gathering && data.items.length < matching && limit < 300 && (
              <div className="pt-2 text-center">
                <Button size="sm" onClick={() => setLimit(300)} loading={news.isFetching}>
                  Show more
                </Button>
              </div>
            )}
            <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-3 text-[11px] leading-relaxed text-muted">
              <Sparkles className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>
                Good or bad is how a headline is likely to affect the stock, judged {data?.ai ? "by AI" : "by simple rules"} from the headline alone. It is not advice, and
                headlines can mislead: read the article before acting.
              </span>
            </p>
          </Card>
        </div>
      )}
    </Page>
  );
}
