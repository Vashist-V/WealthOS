/**
 * Installing WealthOS as an app.
 *
 * WealthOS is a web app that a browser can install: it gets its own icon and
 * opens in its own window, with no app store involved. How that happens
 * depends on the device:
 *
 * - Chrome and Edge, on Android and on computers, hand the page an "install"
 *   prompt it can show when the user asks. One tap and it is installed.
 * - iPhone and iPad never offer that. The user adds the app from the browser's
 *   Share menu, so all the page can do is show the steps.
 * - Other browsers have a menu item for it, or cannot do it at all.
 *
 * The browser offers its prompt once, early, often before any button that
 * could use it is on screen. So it is caught here, when the app starts, and
 * kept until asked for.
 */
import { useSyncExternalStore } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type Device = "ios" | "android" | "computer";

export interface InstallState {
  /** Running as the installed app, or installed a moment ago from this page. */
  installed: boolean;
  /** The browser has offered its own install prompt, so one tap will do it. */
  ready: boolean;
}

let prompt: InstallPrompt | null = null;
let justInstalled = false;
let state: InstallState = { installed: false, ready: false };
const listeners = new Set<() => void>();

/** True inside the installed app, as against a browser tab. */
function standalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: window-controls-overlay)").matches ||
    (navigator as { standalone?: boolean }).standalone === true // Safari on iOS
  );
}

function refresh(): void {
  state = { installed: justInstalled || standalone(), ready: prompt !== null };
  listeners.forEach((notify) => notify());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // keep the browser's own banner back; the app shows its button instead
    prompt = e as InstallPrompt;
    refresh();
  });
  window.addEventListener("appinstalled", () => {
    prompt = null;
    justInstalled = true;
    refresh();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener?.("change", refresh);
  refresh();
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
 * Show the browser's install prompt.
 * "unavailable" means this browser has not offered one: the user has to add the app from its menu.
 */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const offered = prompt;
  if (!offered) return "unavailable";
  // A prompt can be shown once. If it is turned down the browser may offer another later.
  prompt = null;
  refresh();
  try {
    await offered.prompt();
    const { outcome } = await offered.userChoice;
    if (outcome === "accepted") {
      justInstalled = true;
      refresh();
    }
    return outcome;
  } catch {
    return "unavailable";
  }
}

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
