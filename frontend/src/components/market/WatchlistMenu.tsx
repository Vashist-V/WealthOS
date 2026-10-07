import { Check, Plus, Star } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Dialog, Field, Input, Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useWatchlists } from "@/lib/queries";
import type { Watchlist } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Everything a watchlist change touches: the lists themselves and the calendar built from them. */
export const WATCHLIST_KEYS = ["watchlists", "calendar"];

/** Name a new watchlist, or rename one when `editing` is given. `addSymbol` puts a stock on the new list straight away. */
export function WatchlistNameDialog({
  open,
  onOpenChange,
  editing,
  addSymbol,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Watchlist | null;
  addSymbol?: string;
  onCreated?: (list: Pick<Watchlist, "id" | "name">) => void;
}) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setTouched(false);
  }, [open, editing]);

  const trimmed = name.trim();
  const error = !trimmed ? "Give the watchlist a name" : null;
  const save = useAction(
    async () => {
      if (editing) return api.renameWatchlist(editing.id, trimmed);
      const list = await api.createWatchlist(trimmed);
      if (addSymbol) await api.addToWatchlist(list.id, addSymbol);
      return list;
    },
    {
      invalidate: WATCHLIST_KEYS,
      success: editing ? "Watchlist renamed" : addSymbol ? `${addSymbol} added to ${trimmed}` : "Watchlist created",
      onSuccess: (list) => {
        if (!editing) onCreated?.(list);
        onOpenChange(false);
      },
    },
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!error && !(editing && trimmed === editing.name)) save.mutate(undefined);
    else if (!error) onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Rename watchlist" : "New watchlist"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="watchlist-name-form" loading={save.isPending}>
            {editing ? "Save name" : addSymbol ? `Create and add ${addSymbol}` : "Create watchlist"}
          </Button>
        </>
      }
    >
      <form id="watchlist-name-form" onSubmit={submit} noValidate>
        <Field label="Name" error={touched ? error : null}>
          {(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} placeholder="Dividend ideas" maxLength={60} autoFocus />}
        </Field>
      </form>
    </Dialog>
  );
}

/** "Add to watchlist" button: lists the user's watchlists, marks the ones that already hold the stock, and can create a new one. */
export function WatchlistMenu({ symbol }: { symbol: string }) {
  const lists = useWatchlists();
  const [creating, setCreating] = useState(false);
  const add = useAction((list: Watchlist) => api.addToWatchlist(list.id, symbol), {
    invalidate: WATCHLIST_KEYS,
    success: (_, list) => `${symbol} added to ${list.name}`,
  });
  const watched = !!lists.data?.some((list) => list.stocks.some((s) => s.symbol === symbol));

  return (
    <>
      <Menu
        className="w-64"
        trigger={
          <Button icon={<Star className={cn("size-4", watched && "fill-current text-accent")} />} loading={add.isPending}>
            Add to watchlist
          </Button>
        }
      >
        <MenuLabel>Add {symbol} to</MenuLabel>
        {lists.isLoading && <p className="px-2.5 py-2 text-[13px] text-muted">Loading watchlists…</p>}
        {lists.isError && <p className="px-2.5 py-2 text-[13px] text-muted">Watchlists didn't load. Close this menu and try again.</p>}
        {lists.data?.length === 0 && <p className="px-2.5 py-2 text-[13px] text-muted">You have no watchlists yet.</p>}
        {lists.data?.map((list) => {
          const has = list.stocks.some((s) => s.symbol === symbol);
          return (
            <MenuItem
              key={list.id}
              disabled={has}
              onSelect={() => add.mutate(list)}
              trailing={
                has ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs text-ink-2">
                    <Check className="size-3.5" /> Added
                  </span>
                ) : (
                  <span className="num shrink-0 text-xs text-muted">{list.stocks.length}</span>
                )
              }
            >
              {list.name}
            </MenuItem>
          );
        })}
        <MenuSeparator />
        <MenuItem icon={<Plus />} onSelect={() => setCreating(true)}>
          New watchlist
        </MenuItem>
      </Menu>
      <WatchlistNameDialog open={creating} onOpenChange={setCreating} addSymbol={symbol} />
    </>
  );
}
