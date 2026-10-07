import { Activity, Bell, BellOff, BellRing, Coins, FileText, Plus, Trash2, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertDialog, alertRule, isPriceAlert } from "@/components/forms/AlertDialog";
import { Badge, Button, Card, CardSkeleton, EmptyState, ErrorState, IconButton, Page, Signed, Switch, SymbolCell, Tooltip } from "@/components/ui";
import { api } from "@/lib/api";
import { date, number, pct, price, signedPct } from "@/lib/format";
import { useAction, useAlerts } from "@/lib/queries";
import type { Alert, AlertType } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALERT_KEYS = ["alerts", "alerts-evaluate"];
const ICONS: Record<AlertType, LucideIcon> = {
  price_above: TrendingUp,
  price_below: TrendingDown,
  pct_change: Activity,
  earnings: FileText,
  dividend: Coins,
};
/** Stock · rule · where it stands · price · controls. Collapses to two columns on phones. */
const ROW = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 sm:px-5 md:grid-cols-[9rem_minmax(0,1fr)_9.5rem_5.5rem_auto] xl:grid-cols-[13rem_minmax(0,1fr)_14rem_7rem_auto]";

type Permission = NotificationPermission | "unsupported";
const dayCount = (n: number) => (n === 0 ? "today" : n === 1 ? "in 1 day" : `in ${number(n)} days`);
const dateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/** Where an alert stands right now: how far the price is from the trigger, or what the watched figure currently is. */
function standing(a: Alert): ReactNode {
  switch (a.alert_type) {
    case "price_above":
    case "price_below": {
      if (a.price == null) return "No price available";
      const reached = a.alert_type === "price_above" ? a.price >= a.threshold : a.price <= a.threshold;
      return reached ? "At the trigger price" : `${pct(Math.abs(a.threshold / a.price - 1) * 100, 1)} away`;
    }
    case "pct_change":
      return a.change_pct == null ? "No price available" : (
        <>
          Today <Signed value={a.change_pct}>{signedPct(a.change_pct)}</Signed>
        </>
      );
    case "earnings":
      return a.current_value == null ? "No results date announced" : `Results ${dayCount(a.current_value)}`;
    case "dividend":
      return a.current_value == null ? "No ex-dividend date announced" : `Ex-dividend date ${dayCount(a.current_value)}`;
  }
}

/** What the watched figure was when the alert fired. */
function observed(a: Alert): string | null {
  if (a.last_value == null) return null;
  if (isPriceAlert(a.alert_type)) return `at ${price(a.last_value)}`;
  if (a.alert_type === "pct_change") return `on a ${signedPct(a.last_value)} move`;
  return a.last_value === 0 ? "on the day itself" : `with ${number(a.last_value)} day${a.last_value === 1 ? "" : "s"} to go`;
}

function PriceNow({ a, className }: { a: Alert; className?: string }) {
  return (
    <div className={cn("num", className)}>
      <span className="text-[13px] text-ink">{price(a.price)}</span>{" "}
      <Signed value={a.change_pct} className="text-xs max-md:ml-1 md:block">
        {signedPct(a.change_pct)}
      </Signed>
    </div>
  );
}

function AlertRow({ a, busy, onToggle, onDelete }: { a: Alert; busy: boolean; onToggle: (active: boolean) => void; onDelete: () => void }) {
  const Icon = ICONS[a.alert_type];
  const triggered = !!a.triggered_at;
  const status = triggered ? (
    <>
      <span className="text-ink">
        <span className="md:hidden">Triggered </span>
        {dateTime(a.triggered_at!)}
      </span>
      {observed(a) && <span className="text-muted max-md:ml-1 md:block">{observed(a)}</span>}
    </>
  ) : (
    <span className={a.is_active ? "text-ink" : "text-muted"}>{standing(a)}</span>
  );
  return (
    <li className={cn(ROW, "py-3.5")}>
      <div className="min-w-0">
        <SymbolCell symbol={a.symbol} name={a.name} />
      </div>

      <div className="min-w-0 max-md:order-last max-md:col-span-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-medium text-ink">
          <Icon className="size-4 shrink-0 text-muted" aria-hidden />
          {alertRule(a.alert_type, a.threshold)}
          {!triggered && !a.is_active && <Badge>Paused</Badge>}
        </div>
        {a.note && <p className="mt-0.5 text-xs leading-relaxed text-muted">{a.note}</p>}
        <p className="mt-0.5 text-xs text-muted">Created {date(a.created_at)}</p>
        {/* On phones the standing and price sit under the rule instead of in their own columns. */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs md:hidden">
          <span>{status}</span>
          <PriceNow a={a} />
        </div>
      </div>

      <div className="text-[13px] max-md:hidden">{status}</div>
      <PriceNow a={a} className="text-right max-md:hidden" />

      <div className="flex items-center justify-end gap-1.5">
        <Tooltip content={triggered ? "Switch on to watch for this again" : a.is_active ? "Switch off to pause this alert" : "Switch on to resume this alert"}>
          <span className="inline-flex">
            <Switch
              checked={a.is_active}
              onChange={onToggle}
              disabled={busy}
              label={`${triggered ? "Re-arm" : a.is_active ? "Pause" : "Resume"} the ${a.symbol} alert: ${alertRule(a.alert_type, a.threshold)}`}
            />
          </span>
        </Tooltip>
        <IconButton label={`Delete the ${a.symbol} alert`} disabled={busy} onClick={onDelete}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    </li>
  );
}

function Section({
  title,
  description,
  statusLabel,
  alerts,
  empty,
  busyId,
  onToggle,
  onDelete,
}: {
  title: string;
  description: string;
  statusLabel: string;
  alerts: Alert[];
  empty: string;
  busyId: string | null;
  onToggle: (a: Alert, active: boolean) => void;
  onDelete: (a: Alert) => void;
}) {
  return (
    <Card title={title} description={description} flush>
      {alerts.length === 0 ? (
        <p className="px-5 pb-8 pt-4 text-center text-[13px] text-muted">{empty}</p>
      ) : (
        <>
          <div className={cn(ROW, "border-b border-line pb-2 text-xs font-medium text-muted max-md:hidden")} aria-hidden>
            <span>Stock</span>
            <span>Alert</span>
            <span>{statusLabel}</span>
            <span className="text-right">Price</span>
            <span className="w-[4.625rem]" />
          </div>
          <ul className="divide-y divide-line">
            {alerts.map((a) => (
              <AlertRow key={a.id} a={a} busy={busyId === a.id} onToggle={(active) => onToggle(a, active)} onDelete={() => onDelete(a)} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

export function AlertsPage() {
  const alerts = useAlerts();
  const [creating, setCreating] = useState(false);
  const [permission, setPermission] = useState<Permission>(() => ("Notification" in window ? Notification.permission : "unsupported"));

  const toggle = useAction((input: { alert: Alert; active: boolean }) => api.updateAlert(input.alert.id, { is_active: input.active }), {
    invalidate: ALERT_KEYS,
    success: (_, input) =>
      input.active ? `Watching ${input.alert.symbol} again` : `${input.alert.symbol} alert paused`,
  });
  const remove = useAction((alert: Alert) => api.deleteAlert(alert.id), {
    invalidate: ALERT_KEYS,
    success: (_, alert) => `${alert.symbol} alert deleted`,
  });
  const busyId = toggle.isPending ? (toggle.variables?.alert.id ?? null) : remove.isPending ? (remove.variables?.id ?? null) : null;

  const enableNotifications = async () => {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") toast.success("Browser notifications are on");
  };

  const data = alerts.data;
  const watching = (data ?? []).filter((a) => !a.triggered_at);
  const triggered = (data ?? []).filter((a) => a.triggered_at).sort((a, b) => (b.triggered_at ?? "").localeCompare(a.triggered_at ?? ""));
  const paused = watching.filter((a) => !a.is_active).length;
  const armed = watching.length - paused;

  const newAlert = (
    <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
      New alert
    </Button>
  );
  const notice: Record<Exclude<Permission, "default">, { icon: LucideIcon; text: string }> = {
    granted: { icon: BellRing, text: "Browser notifications are on for this device. Triggered alerts also appear under the bell at the top of the page." },
    denied: {
      icon: BellOff,
      text: "Browser notifications are blocked for this site, so triggered alerts appear only inside WealthOS. Allow notifications in your browser's site settings to change this.",
    },
    unsupported: { icon: BellOff, text: "This browser does not support notifications, so triggered alerts appear only inside WealthOS." },
  };
  const status = permission === "default" ? null : notice[permission];

  return (
    <Page
      title="Alerts"
      description="Watch a price level, a large one-day move, or an approaching results or ex-dividend date. Alerts are checked about once a minute while WealthOS is open, and each one fires once."
      actions={
        <>
          {permission === "default" && (
            <Button icon={<BellRing className="size-4" />} onClick={() => void enableNotifications()}>
              Enable browser notifications
            </Button>
          )}
          {newAlert}
        </>
      }
    >
      {status && (
        <p className="mb-4 flex items-start gap-2 text-xs leading-relaxed text-muted">
          <status.icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {status.text}
        </p>
      )}

      {!data ? (
        alerts.isError ? (
          <Card>
            <ErrorState error={alerts.error} onRetry={() => alerts.refetch()} />
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            <CardSkeleton height={220} />
            <CardSkeleton height={120} />
          </div>
        )
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            className="py-16"
            icon={<Bell />}
            title="No alerts yet"
            description="An alert can watch for a price rising or falling to a level you set, a move of a set size in a single day, or a results or ex-dividend date coming within a number of days. When it fires you see a message here and, if you allow it, a browser notification."
            action={newAlert}
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <Section
            title="Active"
            description={`${number(armed)} watching${paused ? ` · ${number(paused)} paused` : ""}`}
            statusLabel="Now"
            alerts={watching}
            empty="No alerts are watching right now. Re-arm a triggered alert below, or create a new one."
            busyId={busyId}
            onToggle={(alert, active) => toggle.mutate({ alert, active })}
            onDelete={(alert) => remove.mutate(alert)}
          />
          <Section
            title="Triggered"
            description="Alerts that have fired. Switch one back on to watch for the same thing again."
            statusLabel="Triggered"
            alerts={triggered}
            empty="Nothing has triggered yet."
            busyId={busyId}
            onToggle={(alert, active) => toggle.mutate({ alert, active })}
            onDelete={(alert) => remove.mutate(alert)}
          />
        </div>
      )}

      <AlertDialog open={creating} onOpenChange={setCreating} />
    </Page>
  );
}
