import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { price, signedPct } from "@/lib/format";
import { useSearch } from "@/lib/queries";
import type { Instrument } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Signed } from "../ui";

export function useDebounced<V>(value: V, delay = 180): V {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

/** One search result row, shared by the picker and the command palette. */
export function InstrumentRow({ item }: { item: Instrument }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{item.symbol}</span>
          <span className="truncate text-xs text-muted">{item.sector}</span>
        </div>
        <div className="truncate text-xs text-muted">{item.name}</div>
      </div>
      {item.price != null && (
        <div className="text-right">
          <div className="num text-[13px] text-ink">{price(item.price)}</div>
          <Signed value={item.change_pct} className="text-xs">{signedPct(item.change_pct)}</Signed>
        </div>
      )}
    </>
  );
}

/** Type-ahead for stocks, ETFs and indices. */
export function SymbolPicker({
  value,
  onSelect,
  id,
  placeholder = "Search by name or symbol",
  autoFocus,
  invalid,
  className,
}: {
  value: string;
  onSelect: (instrument: Instrument) => void;
  id?: string;
  placeholder?: string;
  autoFocus?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const query = useDebounced(text.trim());
  const { data, isFetching } = useSearch(open ? query : "");

  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpen(false);
        setText(value);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [value]);

  return (
    <Command shouldFilter={false} loop className={cn("relative", className)} ref={box}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Command.Input
          id={id}
          value={text}
          onValueChange={(v) => {
            setText(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && open && (e.stopPropagation(), setOpen(false))}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          className={cn(
            "h-9 w-full rounded-[10px] border border-line-strong bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-muted",
            "transition-colors hover:border-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft aria-[invalid=true]:border-loss",
          )}
        />
      </div>
      {open && query && (
        <Command.List className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-line-strong bg-surface p-1 shadow-pop animate-pop">
          {!data?.length && <div className="px-3 py-6 text-center text-[13px] text-muted">{isFetching ? "Searching…" : `Nothing found for “${query}”`}</div>}
          {data?.map((item) => (
            <Command.Item
              key={item.symbol}
              value={item.symbol}
              onSelect={() => {
                onSelect(item);
                setText(item.symbol);
                setOpen(false);
              }}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-[13px] data-[selected=true]:bg-surface-2"
            >
              <InstrumentRow item={item} />
            </Command.Item>
          ))}
        </Command.List>
      )}
    </Command>
  );
}
