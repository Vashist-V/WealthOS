import { Sparkles, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAction, useMe } from "@/lib/queries";
import type { SampleRemoval } from "@/lib/types";
import { Button, ConfirmDialog, IconButton } from "./ui";

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 portfolios, 2 watchlists and 6 journal entries" from a removal result. */
function describe(result: SampleRemoval): string {
  const parts = [
    result.portfolios && count(result.portfolios, "portfolio"),
    result.watchlists && count(result.watchlists, "watchlist"),
    result.journal_entries && count(result.journal_entries, "journal entry", "journal entries"),
    result.alerts && count(result.alerts, "alert"),
    result.strategies && count(result.strategies, "saved strategy", "saved strategies"),
  ].filter(Boolean) as string[];
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The remove-sample-data action with its confirmation. Render `dialog` once and call `ask()` to start. */
export function useRemoveSampleData() {
  const [open, setOpen] = useState(false);
  const { status } = useAuth();
  const remove = useAction(api.removeSampleData, {
    invalidate: "portfolio",
    onSuccess: (result) => {
      setOpen(false);
      const summary = describe(result);
      const kept = result.kept_portfolios.length
        ? ` ${result.kept_portfolios.join(" and ")} ${result.kept_portfolios.length === 1 ? "was" : "were"} kept because you added your own trades.`
        : "";
      if (summary) toast.success(`Removed ${summary}.${kept}`);
      else toast(result.kept_portfolios.length ? `Nothing to remove.${kept}` : "There was no sample data left to remove.");
    },
  });
  const dialog = (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Remove the sample data?"
      description={
        <>
          This deletes the sample portfolios with their transactions, plus the sample watchlists, journal entries, alerts and saved strategies.
          Anything you created or changed yourself stays.
          {status === "demo" ? " You can bring the samples back with Reset demo." : " You can load them again from Settings."}
        </>
      }
      confirmLabel="Remove sample data"
      onConfirm={() => remove.mutate(undefined)}
      loading={remove.isPending}
    />
  );
  return { ask: () => setOpen(true), dialog, pending: remove.isPending };
}

const DISMISSED = "wealthos.sample-banner.dismissed";

/** A reminder, on the dashboard, that the numbers on screen are samples, with the way out. */
export function SampleBanner() {
  const { data } = useMe();
  const { status } = useAuth();
  const removal = useRemoveSampleData();
  const [hidden, setHidden] = useState(() => sessionStorage.getItem(DISMISSED) === "1");
  if (!data?.has_sample_data || hidden) return removal.dialog;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3">
      <Sparkles className="size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 basis-64 text-[13px] leading-relaxed text-ink">
        <span className="font-medium">These are sample portfolios.</span>{" "}
        <span className="text-ink-2">
          {status === "demo"
            ? "They're here so every page has something to show. Remove them to try WealthOS with your own entries."
            : "Remove them when you're ready to track your own investments. Anything you've added yourself stays."}
        </span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" icon={<Trash2 className="size-3.5" />} onClick={removal.ask}>
          Remove sample data
        </Button>
        <IconButton
          label="Hide this reminder"
          onClick={() => {
            sessionStorage.setItem(DISMISSED, "1");
            setHidden(true);
          }}
        >
          <X className="size-4" />
        </IconButton>
      </div>
      {removal.dialog}
    </div>
  );
}
