/**
 * Whether the server is answering.
 *
 * On a free host the server is switched off after a quiet spell, and the next
 * visit waits about a minute while it starts again and fetches prices. A page
 * can do nothing about the wait, but it can say what is happening instead of
 * sitting blank. So the app asks the server "are you there?" when it opens, and
 * again when the user comes back to it after a while, and anything that shows
 * data can read the answer from here.
 */
import { useSyncExternalStore } from "react";
import { API_URL } from "./api";

/**
 * - `unknown`: asked, no answer yet, and not long enough to worry.
 * - `awake`: it answered.
 * - `starting`: slow to answer, which is what a server being started looks like.
 * - `unreachable`: no answer after several minutes, or the device is offline.
 */
export type ServerState = "unknown" | "awake" | "starting" | "unreachable";

export interface Server {
  state: ServerState;
  /** When the wait began, for showing how long it has been. */
  since: number;
}

// An awake server answers well inside this, even on a slow phone connection.
const SLOW = 4_000;
// Seen this recently, the server is taken to be up without asking again.
const FRESH = 10 * 60_000;
// While the app is open and in view, a visit this often keeps the host from switching the server off mid-session.
const KEEP_AWAKE = 5 * 60_000;
// How long one attempt may hang, and how many attempts before giving up.
const ATTEMPT = 100_000;
const ATTEMPTS = 6;

let server: Server = { state: "unknown", since: Date.now() };
let lastSeen = 0;
let asking = false;
const listeners = new Set<() => void>();

function set(state: ServerState): void {
  if (server.state === state) return;
  // The clock runs from when the wait began, not from each change within it.
  const waiting = (s: ServerState) => s === "starting" || s === "unreachable";
  server = { state, since: waiting(state) && waiting(server.state) ? server.since : Date.now() };
  listeners.forEach((notify) => notify());
}

const pause = (ms: number) => new Promise<void>((done) => window.setTimeout(done, ms));

async function answers(): Promise<boolean> {
  const control = new AbortController();
  const limit = window.setTimeout(() => control.abort(), ATTEMPT);
  try {
    return (await fetch(`${API_URL}/api/health`, { cache: "no-store", signal: control.signal })).ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(limit);
  }
}

/** Ask the server whether it is there, and keep asking for a few minutes if it is not. */
export async function ask(): Promise<void> {
  if (asking) return;
  asking = true;
  const slow = window.setTimeout(() => set("starting"), SLOW);
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      if (await answers()) {
        lastSeen = Date.now();
        set("awake");
        return;
      }
      // A refusal rather than a wait: the host is between switching the server on and it listening, or the device is offline.
      set(navigator.onLine === false ? "unreachable" : "starting");
      await pause(4_000);
    }
    set("unreachable");
  } finally {
    window.clearTimeout(slow);
    asking = false;
  }
}

if (typeof window !== "undefined") {
  void ask();
  document.addEventListener("visibilitychange", () => {
    // Coming back to an app left open: the server may have been switched off in the meantime.
    if (document.visibilityState === "visible" && Date.now() - lastSeen > FRESH) void ask();
  });
  window.addEventListener("online", () => void ask());
  window.setInterval(() => {
    if (document.visibilityState === "visible") void ask();
  }, KEEP_AWAKE);
}

export function useServer(): Server {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    () => server,
  );
}
