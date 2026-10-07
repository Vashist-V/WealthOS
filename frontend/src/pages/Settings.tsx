import { useQuery } from "@tanstack/react-query";
import { BellRing, CheckCircle2, CircleAlert, Compass, Download, FlaskConical, LogOut, Moon, RotateCcw, Sparkles, Sun, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useGuide } from "@/components/guide/Guide";
import { useInstaller } from "@/components/InstallApp";
import { useRemoveSampleData } from "@/components/SampleData";
import { Badge, Button, Card, ConfirmDialog, Field, Input, Page, Segmented } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ratioPct } from "@/lib/format";
import { useAction, useMe } from "@/lib/queries";
import { useTheme, type ThemeName } from "@/lib/theme";

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-72">
        <div className="text-sm font-medium text-ink">{title}</div>
        {description && <div className="mt-0.5 max-w-xl text-[13px] leading-relaxed text-muted">{description}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function Account() {
  const { status, email, displayName, updateName, signOut, accountsEnabled } = useAuth();
  const [name, setName] = useState(displayName ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => setName(displayName ?? ""), [displayName]);
  const reset = useAction(api.resetDemo, { invalidate: "portfolio", success: "Demo workspace reset to the sample data", onSuccess: () => setConfirmReset(false) });
  const sample = useAction(api.loadSampleData, { invalidate: "portfolio", success: "Sample portfolios added to your account" });
  const removal = useRemoveSampleData();
  const me = useMe();
  const hasSamples = !!me.data?.has_sample_data;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateName(name.trim());
      toast.success("Name updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update your name.");
    } finally {
      setSaving(false);
    }
  };

  if (status === "demo")
    return (
      <Card title="Demo workspace" description="You're exploring WealthOS with sample portfolios priced from the live market.">
        <div className="divide-y divide-line">
          <Row
            title="Keep your own portfolios"
            description={
              accountsEnabled
                ? "Create an account to track real holdings. The demo stays on this device and is separate from your account."
                : "Accounts aren't configured on this install. Add the Supabase URL and key to the env files to turn on sign-in."
            }
          >
            {accountsEnabled && (
              <Button variant="primary" onClick={() => void signOut()}>
                Sign in or create account
              </Button>
            )}
          </Row>
          <Row
            title="Remove sample data"
            description={
              hasSamples
                ? "Clear out the sample portfolios, watchlists, journal entries and alerts so you can try WealthOS with your own entries. Anything you added stays."
                : "The sample data has been removed. Reset demo brings it back."
            }
          >
            <Button icon={<Trash2 className="size-4" />} onClick={removal.ask} disabled={!hasSamples}>
              Remove sample data
            </Button>
          </Row>
          <Row title="Reset demo data" description="Replace everything in the demo with fresh sample portfolios, watchlists, alerts and journal entries.">
            <Button icon={<RotateCcw className="size-4" />} onClick={() => setConfirmReset(true)}>
              Reset demo
            </Button>
          </Row>
          <Row title="Leave the demo" description="Your demo data is kept on this device for next time.">
            <Button icon={<LogOut className="size-4" />} onClick={() => void signOut()}>
              Leave demo
            </Button>
          </Row>
        </div>
        <ConfirmDialog
          open={confirmReset}
          onOpenChange={setConfirmReset}
          title="Reset the demo workspace?"
          description="Everything you added or changed in the demo is replaced with fresh sample data."
          confirmLabel="Reset demo"
          onConfirm={() => reset.mutate(undefined)}
          loading={reset.isPending}
        />
        {removal.dialog}
      </Card>
    );

  return (
    <Card title="Account">
      <div className="divide-y divide-line">
        <form onSubmit={save} className="grid gap-4 pb-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Name">{(props) => <Input {...props} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Your name" />}</Field>
          <Field label="Email">{(props) => <Input {...props} value={email ?? ""} readOnly disabled />}</Field>
          <Button type="submit" variant="primary" loading={saving} disabled={name.trim() === (displayName ?? "")}>
            Save
          </Button>
        </form>
        <Row
          title="Sample data"
          description={
            hasSamples
              ? "Your account has sample portfolios in it. Remove them, with their watchlists, journal entries and alerts, whenever you're ready. Anything you added yourself stays."
              : "Add four sample portfolios, two watchlists, alerts and journal entries to see every page with data. You can remove them again here."
          }
        >
          {hasSamples ? (
            <Button icon={<Trash2 className="size-4" />} onClick={removal.ask}>
              Remove sample data
            </Button>
          ) : (
            <Button icon={<Sparkles className="size-4" />} loading={sample.isPending} onClick={() => sample.mutate(undefined)}>
              Load sample data
            </Button>
          )}
        </Row>
        <Row title="Sign out" description="You'll need your password to sign back in.">
          <Button icon={<LogOut className="size-4" />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </Row>
      </div>
      {removal.dialog}
    </Card>
  );
}

function Notifications() {
  const supported = "Notification" in window;
  const [permission, setPermission] = useState<NotificationPermission>(supported ? Notification.permission : "denied");
  const request = async () => {
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") new Notification("WealthOS alerts are on", { body: "You'll be notified here when an alert triggers.", icon: "/pwa-192.png" });
  };
  return (
    <Row
      title="Alert notifications"
      description={
        !supported
          ? "This browser doesn't support notifications. Triggered alerts still appear in the bell menu."
          : permission === "granted"
            ? "On. Alerts are checked every minute while WealthOS is open."
            : permission === "denied"
              ? "Blocked in your browser. Allow notifications for this site in the browser's site settings to turn them on."
              : "Get a system notification when a price, results or dividend alert triggers while WealthOS is open."
      }
    >
      {supported && permission === "default" && (
        <Button icon={<BellRing className="size-4" />} onClick={() => void request()}>
          Turn on
        </Button>
      )}
      {permission === "granted" && <Badge tone="gain"><CheckCircle2 className="size-3" /> On</Badge>}
      {supported && permission === "denied" && <Badge tone="warn">Blocked</Badge>}
    </Row>
  );
}

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { status, accountsEnabled } = useAuth();
  const me = useMe();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 30_000 });
  const installer = useInstaller();
  const guide = useGuide();

  return (
    <Page title="Settings" description="Your account, how WealthOS looks, and what it's connected to." className="max-w-4xl">
      <div className="flex flex-col gap-4">
        <Account />

        <Card title="Preferences">
          <div className="divide-y divide-line">
            <Row title="Hands-on lessons" description="Short lessons that point at each control, say what it does and have you try it. Each page also has its own guide under the ? button at the top.">
              <Button icon={<Compass className="size-4" />} onClick={guide.openLessons}>
                Open the lessons
              </Button>
            </Row>
            <Row title="Theme" description="Charts and tables adapt to the theme you choose.">
              <Segmented<ThemeName>
                label="Theme"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="size-3.5" /> Dark</span> },
                  { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="size-3.5" /> Light</span> },
                ]}
              />
            </Row>
            <Notifications />
            <Row
              title="Get the app"
              description={
                installer.installed
                  ? "You are using the installed app. You can add it to your other devices too."
                  : installer.onDevice
                    ? "WealthOS is installed on this device: open it from your list of apps or home screen. You can add it to your other devices too."
                    : installer.ready
                      ? "Add WealthOS to your home screen or desktop. It opens in its own window and loads instantly."
                      : "WealthOS installs from this site onto a phone, tablet or computer: no app store needed. The steps depend on the device."
              }
            >
              {(installer.installed || installer.onDevice) && <Badge tone="gain"><CheckCircle2 className="size-3" /> Installed</Badge>}
              {installer.installed || installer.onDevice || !installer.ready ? (
                <Button onClick={() => installer.showSteps()}>{installer.installed || installer.onDevice ? "Other devices" : "Show me how"}</Button>
              ) : (
                <Button icon={<Download className="size-4" />} loading={installer.installing} onClick={installer.start}>
                  {installer.installing ? "Installing…" : "Install"}
                </Button>
              )}
            </Row>
            <Row title="Import and export" description="Bring in transactions from a CSV or a broker tradebook, or export your ledger.">
              <Link to="/transactions">
                <Button>Open transactions</Button>
              </Link>
            </Row>
          </div>
        </Card>

        <Card title="About this install">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {[
              {
                label: "Server",
                value: health.isError ? (
                  <span className="inline-flex items-center gap-1.5 text-loss"><CircleAlert className="size-4" /> Not reachable</span>
                ) : health.data ? (
                  <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="size-4 text-gain" /> Connected</span>
                ) : "Checking…",
              },
              { label: "Workspace", value: status === "demo" ? <span className="inline-flex items-center gap-1.5"><FlaskConical className="size-4 text-accent" /> Demo, stored on this device</span> : "Your account, stored in Supabase" },
              { label: "Accounts", value: accountsEnabled ? "Enabled (Supabase Auth)" : "Not configured" },
              { label: "Market", value: me.data ? `NSE ${me.data.market.label.toLowerCase()} · ${me.data.market.detail}` : "—" },
              { label: "Risk-free rate", value: me.data ? `${ratioPct(me.data.risk_free_rate, 2)} a year, used for Sharpe and alpha` : "—" },
              {
                label: "Stock assistant",
                value: !me.data
                  ? "—"
                  : me.data.assistant_provider === "gemini"
                    ? "AI answers on (Google Gemini)"
                    : me.data.assistant_provider === "anthropic"
                      ? "AI answers on (Anthropic Claude)"
                      : me.data.assistant_provider === "compatible"
                        ? "AI answers on (Groq or a compatible service)"
                        : "Data answers only. Add a Gemini, Groq or Anthropic key to the server's settings for AI answers",
              },
              { label: "Market data", value: "Yahoo Finance, delayed by a few minutes" },
            ].map((item) => (
              <div key={item.label}>
                <dt className="text-xs text-muted">{item.label}</dt>
                <dd className="mt-0.5 text-sm text-ink">{item.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-muted">
            WealthOS is for tracking, analysis and learning. It never places trades and doesn't connect to a broker. Nothing here is investment advice; simulations and backtests describe scenarios, not predictions.
          </p>
        </Card>
      </div>
    </Page>
  );
}
