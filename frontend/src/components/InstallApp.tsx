/**
 * "Get the app": installing WealthOS on whatever the visitor is using.
 *
 * Where the browser can install it (Chrome and Edge, on Android and on
 * computers) the button starts that, then waits for the device to confirm the
 * app is really there before saying so. Where it cannot (iPhone, iPad and a
 * few browsers) the button opens the steps to follow instead. The same steps
 * are printed in the docs, from the same list.
 */
import { Check, Copy, Download, EllipsisVertical, Info, MonitorDown, Share, SquarePlus, TriangleAlert, type LucideIcon } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Dialog, Segmented, type ButtonProps } from "@/components/ui";
import { device, inAppBrowser, promptInstall, useInstallState, type Device } from "@/lib/install";
import { cn } from "@/lib/utils";

interface Step {
  icon: LucideIcon;
  title: string;
  text: string;
}

export const INSTALL_GUIDES: Record<Device, { tab: string; heading: string; steps: Step[]; note: string }> = {
  ios: {
    tab: "iPhone",
    heading: "On an iPhone or iPad",
    steps: [
      { icon: Share, title: "Tap the Share button", text: "The square with an arrow pointing up. In Safari it is at the bottom of the screen, sometimes behind the ••• button. In Chrome it is at the top right." },
      { icon: SquarePlus, title: "Choose Add to Home Screen", text: "Scroll down the list if you do not see it straight away." },
      { icon: Check, title: "Tap Add", text: "WealthOS appears on your home screen and opens full screen, like any other app." },
    ],
    note: "Apple does not let a website install itself, which is why there is no single button for this on an iPhone.",
  },
  android: {
    tab: "Android",
    heading: "On an Android phone or tablet",
    steps: [
      { icon: EllipsisVertical, title: "Open the browser's menu", text: "The three dots at the top right in Chrome. Samsung Internet keeps its menu, three lines, at the bottom right." },
      { icon: SquarePlus, title: "Tap Add to Home screen", text: "Then choose Install. Some browsers call the whole thing Install app." },
      { icon: Check, title: "Tap Install", text: "The phone builds the app in the background, which can take a minute. It then appears in your list of apps and, on most phones, on the home screen." },
    ],
    note: "Chrome normally starts this from the Get the app button. If you were shown these steps instead, WealthOS may already be installed: look for it in your list of apps.",
  },
  computer: {
    tab: "Computer",
    heading: "On a Windows PC, Mac or Chromebook",
    steps: [
      { icon: MonitorDown, title: "Click the install icon in the address bar", text: "In Chrome and Edge it is at the right-hand end of the address bar: a screen with a down arrow. It is also in the ⋮ menu, as Install WealthOS." },
      { icon: Check, title: "Click Install", text: "WealthOS opens in its own window and is added to your Start menu, taskbar or Dock." },
    ],
    note: "On a Mac with Safari, choose File, then Add to Dock. Firefox cannot install web apps on most computers, so use Chrome or Edge for this.",
  },
};

/** Where an installed copy is found, by device. */
export const INSTALLED_WHERE: Record<Device, string> = {
  ios: "Open it from your home screen.",
  android: "Open it from your list of apps or your home screen.",
  computer: "Open it from your apps list, Start menu or Dock.",
};

/** What to check when the browser agreed to install and nothing turned up. */
const TROUBLE: Record<Device, { lead: string; checks: string[] }> = {
  android: {
    lead: "Your phone accepted, but WealthOS has not shown up on it.",
    checks: [
      "Look in your list of apps as well as on the home screen. Many phones put a new app only in the list.",
      "On Xiaomi, Redmi, POCO, Vivo, Oppo and Realme phones the browser needs permission to add to the home screen: Settings, Apps, Chrome, Permissions, Home screen shortcuts. Allow it, then try again.",
      "Use Chrome. Other browsers may add only a bookmark, or nothing at all.",
      "Then add it from the browser's own menu, with the steps below.",
    ],
  },
  computer: {
    lead: "Your browser accepted, but has not confirmed that WealthOS was installed.",
    checks: ["Look for WealthOS in your apps list or Start menu: it may already be there.", "If it is not, install it from the address bar, with the steps below."],
  },
  ios: { lead: "WealthOS has not shown up on this device.", checks: ["Add it from the Share menu, with the steps below."] },
};

const ORDER: Device[] = ["ios", "android", "computer"];

export function InstallSteps({ kind, className }: { kind: Device; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-3.5", className)}>
      {INSTALL_GUIDES[kind].steps.map((step, i) => (
        <li key={step.title} className="flex gap-3">
          <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">{i + 1}</span>
          <div className="min-w-0 pt-[3px]">
            <div className="flex items-center gap-1.5 text-sm font-medium text-ink">
              {step.title}
              <step.icon className="size-4 shrink-0 text-ink-2" aria-hidden />
            </div>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

interface Installer {
  /** Running as the installed app. */
  installed: boolean;
  /** Installed on this device, though this is an ordinary browser tab. */
  onDevice: boolean;
  /** This browser can start the install itself. */
  ready: boolean;
  /** The user has agreed and the device has not confirmed yet. */
  installing: boolean;
  /** Install now if the browser allows it; otherwise show the steps for this device. */
  start: () => void;
  /** Show the steps, opening on the given device's. */
  showSteps: (kind?: Device) => void;
}

const InstallContext = createContext<Installer | null>(null);

export function useInstaller(): Installer {
  const value = useContext(InstallContext);
  if (!value) throw new Error("useInstaller must be used inside <InstallProvider>");
  return value;
}

/** Holds the one "how to install" dialog, so a button anywhere can open it, even one inside a menu that then closes. */
export function InstallProvider({ children }: { children: ReactNode }) {
  const { installed, onDevice, ready, installing } = useInstallState();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Device>("computer");
  // Set when the browser agreed to install and the device never confirmed it.
  const [trouble, setTrouble] = useState(false);
  const here = useMemo(device, []);

  const showSteps = useCallback((which?: Device) => {
    setKind(which ?? device());
    setOpen(true);
  }, []);

  const install = useCallback(async () => {
    setTrouble(false);
    let working: string | number | undefined;
    const outcome = await promptInstall(() => {
      setOpen(false);
      working = toast.loading("Installing WealthOS…", {
        description: device() === "android" ? "Your phone is building the app. This can take up to a minute, so keep this page open." : "Waiting for your browser to finish.",
      });
    });
    if (working !== undefined) toast.dismiss(working);
    if (outcome === "installed") {
      toast.success("WealthOS is installed", { description: INSTALLED_WHERE[device()], duration: 10_000 });
    } else if (outcome === "unknown") {
      // This browser cannot be asked whether it worked, so say what to look for rather than claim it did.
      toast.message("Your browser is adding WealthOS", {
        description: "Give it a minute, then look in your list of apps and on your home screen. If it is not there, press Get the app again for another way.",
        duration: 15_000,
      });
    } else if (outcome === "unconfirmed") {
      setTrouble(true);
      showSteps();
    }
    return outcome;
  }, [showSteps]);

  const start = useCallback(() => {
    // "dismissed" needs nothing more: the visitor saw the browser's prompt and said no.
    void install().then((outcome) => outcome === "unavailable" && showSteps());
  }, [install, showSteps]);

  const value = useMemo(() => ({ installed, onDevice, ready, installing, start, showSteps }), [installed, onDevice, ready, installing, start, showSteps]);
  const guide = INSTALL_GUIDES[kind];
  const otherDevice = kind !== here;
  const present = installed || onDevice;

  return (
    <InstallContext.Provider value={value}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTrouble(false);
        }}
        size="sm"
        title="Get the WealthOS app"
        description="The same WealthOS, with its own icon and its own window. Free, and not in any app store: it installs from this site."
      >
        {present ? (
          <p className="mb-4 flex items-start gap-2 rounded-xl bg-gain-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
            <Check className="mt-px size-4 shrink-0 text-gain" aria-hidden />
            <span>
              WealthOS is installed on this device. {!installed && INSTALLED_WHERE[here]} The steps below are for your other devices.
            </span>
          </p>
        ) : trouble ? (
          <div className="mb-4 rounded-xl bg-warn-soft px-3.5 py-3 text-[13px] leading-relaxed text-ink">
            <p className="flex items-start gap-2 font-medium">
              <TriangleAlert className="mt-px size-4 shrink-0 text-warn" aria-hidden />
              {TROUBLE[here].lead}
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-9 text-ink-2">
              {TROUBLE[here].checks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
          </div>
        ) : (
          ready && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent-soft px-3.5 py-3 ring-1 ring-inset ring-accent/20">
              <span className="text-[13px] leading-relaxed text-ink">This browser can install it for you.</span>
              <Button variant="primary" size="sm" icon={<Download className="size-4" />} loading={installing} onClick={() => void install()}>
                Install on this device
              </Button>
            </div>
          )
        )}

        <Segmented<Device>
          label="Device"
          className="w-full [&>button]:flex-1"
          value={kind}
          onChange={setKind}
          options={ORDER.map((d) => ({ value: d, label: INSTALL_GUIDES[d].tab }))}
        />

        <h3 className="mt-5 text-sm font-semibold tracking-tight text-ink">{guide.heading}</h3>

        {otherDevice && (
          <div className="mt-3 flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-2.5 ring-1 ring-line">
            <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-2">
              First open <span className="break-all font-medium text-ink">{window.location.host}</span> in that device's browser.
            </p>
            <Button
              size="sm"
              icon={<Copy className="size-3.5" />}
              onClick={() => {
                navigator.clipboard?.writeText(window.location.origin).then(
                  () => toast.success("Link copied", { description: "Send it to yourself and open it on the other device." }),
                  () => toast.error("Could not copy the link. Type the address in instead."),
                );
              }}
            >
              Copy link
            </Button>
          </div>
        )}
        {!otherDevice && kind !== "computer" && inAppBrowser() && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-ink">
            <Info className="mt-px size-4 shrink-0 text-warn" aria-hidden />
            This page is open inside another app, which cannot install anything. Use that app's menu to open the page in {kind === "ios" ? "Safari" : "Chrome"} first.
          </p>
        )}

        <InstallSteps kind={kind} className="mt-4" />
        <p className="mt-4 border-t border-line pt-3.5 text-xs leading-relaxed text-muted">{guide.note}</p>
      </Dialog>
    </InstallContext.Provider>
  );
}

/** The button. It shows nothing where WealthOS is already installed, since there is nothing left to do. */
export function InstallButton({ children = "Get the app", ...rest }: ButtonProps) {
  const { installed, onDevice, installing, start } = useInstaller();
  if (installed || onDevice) return null;
  return (
    <Button icon={<Download className="size-4" />} loading={installing} onClick={start} {...rest}>
      {installing ? "Installing…" : children}
    </Button>
  );
}
