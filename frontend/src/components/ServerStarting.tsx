/**
 * A note shown while the server is being started, so a wait never looks like a broken page.
 * It appears only when the server has actually been slow to answer, and stays until the
 * first pages have their data.
 */
import { useIsFetching } from "@tanstack/react-query";
import { Loader2, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { ask, useServer } from "@/lib/server";
import { cn } from "@/lib/utils";

// A wait longer than this was the server being started, not just a slow connection.
const REAL_START = 8_000;

/** "0:42" since the given moment, ticking each second. */
function useElapsed(since: number, running: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [running, since]);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function ServerStarting({ className }: { className?: string }) {
  const server = useServer();
  const { state, since } = server;
  const loading = useIsFetching();
  // The server answers before it has fetched prices, so the first pages are still slow for a little
  // while after a real start. (A wait of a few seconds was only a slow connection, and needs no more said.)
  const [catchingUp, setCatchingUp] = useState(false);
  const previous = useRef(server);
  useEffect(() => {
    const before = previous.current;
    if (before.state === "starting" && state === "awake" && Date.now() - before.since > REAL_START) setCatchingUp(true);
    previous.current = server;
  }, [server, state]);
  useEffect(() => {
    if (!catchingUp) return;
    // Done when nothing has been loading for a moment; a ceiling in case some page keeps polling.
    const done = window.setTimeout(() => setCatchingUp(false), loading === 0 ? 800 : 90_000);
    return () => window.clearTimeout(done);
  }, [catchingUp, loading]);

  const waiting = state === "starting";
  const elapsed = useElapsed(since, waiting);
  if (state === "unreachable") {
    return (
      <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] leading-relaxed text-ink", className)}>
        <WifiOff className="size-4 shrink-0 text-warn" aria-hidden />
        <p className="min-w-0 flex-1 basis-56">
          <span className="font-medium">Can't reach the WealthOS server.</span> Check your internet connection, then try again.
        </p>
        <Button size="sm" onClick={() => void ask()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!waiting && !catchingUp) return null;
  return (
    <div role="status" className={cn("overflow-hidden rounded-xl border border-accent/25 bg-accent-soft text-[13px] leading-relaxed text-ink", className)}>
      <div className="flex items-start gap-3 px-4 py-3">
        <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-accent" aria-hidden />
        <p className="min-w-0 flex-1">
          {waiting ? (
            <>
              <span className="font-medium">Starting the server.</span>{" "}
              <span className="text-ink-2">It is switched off when nobody has used WealthOS for a while, and takes about a minute to come back. This page fills in by itself, and your data is safe.</span>
            </>
          ) : (
            <>
              <span className="font-medium">The server is up.</span> <span className="text-ink-2">Fetching the latest prices, which takes a few more seconds.</span>
            </>
          )}
        </p>
        {waiting && <span className="num shrink-0 text-xs text-muted">{elapsed}</span>}
      </div>
      <div className="h-0.5 w-full animate-shimmer bg-[linear-gradient(90deg,transparent,var(--accent),transparent)] bg-[length:200%_100%]" aria-hidden />
    </div>
  );
}
