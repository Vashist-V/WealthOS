import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, Dialog, ErrorState, Input, Skeleton, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { useAction, useShare } from "@/lib/queries";
import type { Portfolio } from "@/lib/types";

function Setting({ id, title, detail, checked, onChange }: { id: string; title: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{detail}</span>
      </label>
      <Switch id={id} label={title} checked={checked} onChange={onChange} />
    </div>
  );
}

/** Turn a portfolio's public, read-only link on or off and choose what it reveals. */
export function ShareDialog({ portfolio, open, onOpenChange }: { portfolio: Portfolio | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const id = portfolio?.id ?? null;
  const share = useShare(open ? id : null);
  const field = useRef<HTMLInputElement>(null);
  /** The amounts choice made before a link exists; applied when the link is created. */
  const [amounts, setAmounts] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmounts(false);
    setCopied(false);
  }, [open, id]);

  const link = useAction(async (on: boolean): Promise<unknown> => (on ? api.setShare(id!, amounts) : api.revokeShare(id!)), {
    invalidate: ["share"],
    success: (_, on) => (on ? "Public link is on" : "Public link turned off"),
  });
  const values = useAction((show: boolean) => api.setShare(id!, show), {
    invalidate: ["share"],
    success: (_, show) => (show ? "Viewers now see rupee amounts and quantities" : "Viewers now see weights and percentages only"),
  });
  const busy = link.isPending || values.isPending;

  // Show the requested state while the request and the refetch are in flight.
  const current = share.data ?? null;
  const linkOn = link.isPending ? !!link.variables : !!current;
  const showAmounts = values.isPending ? !!values.variables : current ? current.show_values : amounts;
  const url = current ? `${window.location.origin}/shared/${current.id}` : "";

  const copy = async () => {
    let done = false;
    try {
      await navigator.clipboard.writeText(url);
      done = true;
    } catch {
      field.current?.select();
      done = document.execCommand("copy");
    }
    if (!done) {
      toast.error("The link couldn't be copied. Select it and copy it yourself.");
      return;
    }
    toast.success("Link copied");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={portfolio ? `Share ${portfolio.name}` : "Share portfolio"}
      description="A read-only view for people you send the link to."
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      {share.isError ? (
        <ErrorState error={share.error} onRetry={() => share.refetch()} className="py-8" />
      ) : share.isLoading ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] leading-relaxed text-ink-2">
            A share link gives anyone with the link a read-only view of this portfolio&apos;s holdings, weights and returns, without signing in. Your transactions and other portfolios are
            never included.
          </p>

          <div className="divide-y divide-line rounded-xl ring-1 ring-line">
            <Setting
              id="share-public-link"
              title="Public link"
              detail={linkOn ? "On. Anyone with the link can view this portfolio." : "Off. Only you can see this portfolio."}
              checked={linkOn}
              onChange={(on) => {
                if (!busy && id) link.mutate(on);
              }}
            />
            <Setting
              id="share-show-amounts"
              title="Show rupee amounts and quantities"
              detail={showAmounts ? "Viewers see values, quantities, average cost and P&L in rupees." : "Viewers see weights and percentages only."}
              checked={showAmounts}
              onChange={(show) => {
                if (busy || !id) return;
                if (current) values.mutate(show);
                else setAmounts(show);
              }}
            />
          </div>

          {linkOn && (
            <div>
              <label htmlFor="share-url" className="text-[13px] font-medium text-ink-2">Link</label>
              {current ? (
                <div className="mt-1.5 flex gap-2">
                  <Input id="share-url" ref={field} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 text-[13px]" />
                  <Button icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>
                    Copy
                  </Button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open the shared view in a new tab"
                    title="Open the shared view in a new tab"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-line-strong text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                  >
                    <ExternalLink className="size-4" />
                  </a>
                </div>
              ) : (
                <Skeleton className="mt-1.5 h-9 w-full" />
              )}
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Turning the link off stops it working straight away. Turning it on again creates a new link.
              </p>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
