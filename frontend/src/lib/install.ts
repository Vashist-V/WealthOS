/**
 * Installing WealthOS as an app.
 *
 * WealthOS is a web app that a browser can install: it gets its own icon and
 * opens in its own window, with no app store involved. How that happens
 * depends on the device:
 *
 * - Chrome and Edge, on Android and on computers, hand the page an "install"
 *   prompt it can show when the user asks.
 * - iPhone and iPad never offer that. The user adds the app from the browser's
 *   Share menu, so all the page can do is show the steps.
 * - Other browsers have a menu item for it, or cannot do it at all.
 *
 * The browser offers its prompt once, early, often before any button that
 * could use it is on screen. So it is caught here, when the app starts, and
 * kept until asked for.
 *
 * Saying yes to the prompt is not the same as being installed. On a computer
 * the browser confirms with an `appinstalled` event. On Android that event
 * fires the moment the user says yes, while the phone is still building the
 * app in the background (and may yet fail to), so there the page asks the
 * browser whether the app is really present. Nothing here reports "installed"
 * on the user's word alone.
 */
import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type Device = "ios" | "android" | "computer";

export interface InstallState {
  /** Running inside the installed app. */
  installed: boolean;
  /** Installed on this device, though this is an ordinary browser tab. */
  onDevice: boolean;
  /** The browser has offered its own install prompt, so one tap starts it. */
  ready: boolean;
  /** The user has said yes and the device has not confirmed yet. */
  installing: boolean;
}

/**
 * - `installed`: the device confirms the app is there.
 * - `unconfirmed`: the user said yes, and the device never confirmed it.
 * - `unknown`: the user said yes, and this browser has no way to check.
 * - `dismissed`: the user said no.
 * - `unavailable`: this browser has not offered a prompt; the app is added from its menu.
 */
export type InstallOutcome = "installed" | "unconfirmed" | "unknown" | "dismissed" | "unavailable";

// Remembered so that a reload does not offer to install what is already there.
const MARK = "wealthos.installed";
// How long to wait for the device to confirm. A phone builds the app in the background, which takes a while.
const PHONE_WAIT = 60_000;
const COMPUTER_WAIT = 15_000;
const POLL = 2_500;

let prompt: InstallPrompt | null = null;
let onDevice = false;
let installing = false;
let state: InstallState = { installed: false, onDevice: false, ready: false, installing: false };
const listeners = new Set<() => void>();
const confirmations = new Set<() => void>();

/** The kind of device this is, to show the right steps first. */
export function device(): Device {
  const ua = navigator.userAgent;
  // An iPad reports itself as a Mac, but only an iPad has a touch screen.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "computer";
}

/** Opened inside another app (a link tapped in Instagram, Facebook and the like), where nothing can be installed. */
export function inAppBrowser(): boolean {
  return /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|LinkedInApp|Twitter/i.test(navigator.userAgent);
}

/** True inside the installed app, as against a browser tab. */
function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (navigator as { standalone?: boolean }).standalone === true // Safari on iOS
  );
}

function remember(value: boolean): void {
  onDevice = value;
  try {
    if (value) localStorage.setItem(MARK, "1");
    else localStorage.removeItem(MARK);
  } catch {
    // Private windows may refuse storage; the answer then lasts for this visit only.
  }
}

function refresh(): void {
  state = { installed: standalone(), onDevice, ready: prompt !== null, installing };
  listeners.forEach((notify) => notify());
}

/**
 * Ask the browser whether the app is on this device. It answers for the app
 * named in the manifest's `related_applications`.
 * `null` means it cannot say: the question is not supported, or (on a computer)
 * an empty answer does not rule the app out.
 */
async function present(): Promise<boolean | null> {
  const ask = (navigator as { getInstalledRelatedApps?: () => Promise<unknown[]> }).getInstalledRelatedApps;
  if (!ask) return null;
  try {
    const apps = await ask.call(navigator);
    if (apps.length > 0) return true;
    return device() === "android" ? false : null;
  } catch {
    return null;
  }
}

const pause = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

/** Wait for the device to confirm an install the user has just agreed to. */
async function confirmed(): Promise<boolean | null> {
  if (device() !== "android") {
    // A computer's browser says so itself when it has finished, sometimes before this is even asked.
    if (onDevice) return true;
    return new Promise<boolean>((done) => {
      const yes = () => {
        window.clearTimeout(timer);
        confirmations.delete(yes);
        done(true);
      };
      const timer = window.setTimeout(() => {
        confirmations.delete(yes);
        done(false);
      }, COMPUTER_WAIT);
      confirmations.add(yes);
    });
  }
  if ((await present()) === null) return null;
  for (let waited = 0; waited < PHONE_WAIT; waited += POLL) {
    await pause(POLL);
    if (await present()) return true;
  }
  return false;
}

if (typeof window !== "undefined") {
  try {
    onDevice = localStorage.getItem(MARK) === "1";
  } catch {
    onDevice = false;
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the browser's own banner back; the app shows its button instead
    prompt = e as InstallPrompt;
    // A browser only offers to install what is not installed, so anything remembered is out of date.
    remember(false);
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    // On Android this fires when the user agrees, not when the app exists, so it proves nothing there.
    if (device() !== "android") {
      remember(true);
      confirmations.forEach((yes) => yes());
    }
    refresh();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", refresh);
  refresh();
  // Whatever was remembered, the browser's own answer is better.
  void present().then((answer) => {
    if (answer === null || answer === onDevice) return;
    remember(answer);
    refresh();
  });
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => state,
  );
}

/**
 * Show the browser's install prompt and, if the user agrees, wait until the device confirms the app is there.
 * `onAccepted` is called when the user agrees, so the page can say it is working on it.
 */
export async function promptInstall(onAccepted?: () => void): Promise<InstallOutcome> {
  const offered = prompt;
  if (!offered) return "unavailable";
  // A prompt can be shown once. If it is turned down the browser may offer another later.
  prompt = null;
  refresh();
  let outcome: "accepted" | "dismissed";
  try {
    await offered.prompt();
    outcome = (await offered.userChoice).outcome;
  } catch {
    return "unavailable";
  }
  if (outcome !== "accepted") return "dismissed";

  installing = true;
  refresh();
  onAccepted?.();
  const answer = await confirmed();
  installing = false;
  if (answer) remember(true);
  refresh();
  return answer === null ? "unknown" : answer ? "installed" : "unconfirmed";
}
