/**
 * The coach: the highlight around the control a lesson step is about, and the
 * card beside it. The highlight is only paint and takes no clicks, so the page
 * underneath keeps working and the user can do what the step asks.
 */
import { ArrowLeft, ArrowRight, Check, MousePointerClick, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Lesson, LessonStep } from "@/lib/lessons";
import { cn } from "@/lib/utils";
import { Button, IconButton } from "../ui";

/** Windows that float over the page. A control inside one is ringed but the page is not dimmed again. */
const LAYERS = '[role="dialog"], [role="menu"]';
const GAP = 14;
const EDGE = 12;

/** Where a step stands: being read, waiting for the user's action, done before it began, or its control is not on screen. */
export type StepStatus = "reading" | "waiting" | "already" | "lost";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}
interface Spot {
  target: Rect;
  /** The floating window the control sits in, if any. */
  layer: Rect | null;
}

/** `data-tour` name, or a selector as written when it starts with "[". */
const selector = (name: string): string => (name.startsWith("[") ? name : `[data-tour="${name}"]`);

/** The first of the named controls that is on screen. One hidden at this screen width has no box and is passed over. */
export function locate(names: string | string[] | undefined): HTMLElement | null {
  for (const name of names === undefined ? [] : [names].flat()) {
    for (const el of document.querySelectorAll<HTMLElement>(selector(name))) {
      const box = el.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return el;
    }
  }
  return null;
}

const rect = (r: DOMRect): Rect => ({ top: r.top, left: r.left, width: r.width, height: r.height });

/** True for a control in the top bar or sidebar, which is on screen wherever the page is scrolled to. */
function pinned(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

function bringIntoView(el: HTMLElement, box: DOMRect, layered: boolean): void {
  if (layered) return el.scrollIntoView({ block: "nearest" });
  const height = window.innerHeight;
  if (pinned(el) || (box.top >= 72 && box.bottom <= height - 96)) return;
  // Something taller than the screen is shown from its top; anything else is centred.
  const top = box.height > height - 260 ? box.top - 96 : box.top - (height - box.height) / 2;
  window.scrollBy({ top, behavior: "smooth" });
}

/** Follows the step's control as the page scrolls, resizes and re-renders. */
function useSpot(step: LessonStep): Spot | null {
  const [spot, setSpot] = useState<Spot | null>(null);
  useEffect(() => {
    let last = "?";
    let shown = false;
    const look = () => {
      const el = locate(step.target);
      let next: Spot | null = null;
      if (el) {
        const box = el.getBoundingClientRect();
        const layer = el.closest<HTMLElement>(LAYERS);
        next = { target: rect(box), layer: layer ? rect(layer.getBoundingClientRect()) : null };
        if (!shown) {
          shown = true;
          bringIntoView(el, box, !!layer);
        }
      }
      const key = next ? [next.target.top, next.target.left, next.target.width, next.target.height, next.layer?.left ?? -1].map(Math.round).join() : "";
      if (key !== last) {
        last = key;
        setSpot(next);
      }
    };
    look();
    // Scrolling and resizing are followed as they happen; the timer catches everything else that moves a control.
    const timer = window.setInterval(look, 120);
    window.addEventListener("scroll", look, true);
    window.addEventListener("resize", look);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", look, true);
      window.removeEventListener("resize", look);
    };
  }, [step]);
  return spot;
}

/** Where the card goes: beside the control without covering it, or a corner when nothing fits. */
function place(spot: Spot | null, card: { width: number; height: number }): { top: number; left: number } {
  const width = window.innerWidth;
  // Phones and tablets have the tab bar along the bottom.
  const floor = window.innerHeight - (width < 1024 ? 72 : EDGE);
  const x = (v: number) => Math.min(Math.max(v, EDGE), width - card.width - EDGE);
  const y = (v: number) => Math.min(Math.max(v, EDGE), floor - card.height);
  if (!spot) return { top: y(window.innerHeight * 0.28), left: x((width - card.width) / 2) };

  const t = spot.target;
  if (spot.layer) {
    // Inside a dialog or menu the space under a field belongs to its list or to the next field, so go beside the whole window.
    const l = spot.layer;
    if (l.left + l.width + GAP + card.width <= width - EDGE) return { top: y(Math.max(t.top - 8, l.top)), left: l.left + l.width + GAP };
    if (l.left - GAP - card.width >= EDGE) return { top: y(Math.max(t.top - 8, l.top)), left: l.left - GAP - card.width };
    // No room beside it: take the half of the screen the control is not in.
    const upper = t.top + t.height / 2 < window.innerHeight / 2;
    return { top: upper ? floor - card.height : EDGE, left: x((width - card.width) / 2) };
  }
  const centred = x(t.left + t.width / 2 - card.width / 2);
  if (t.top + t.height + GAP + card.height <= floor) return { top: t.top + t.height + GAP, left: centred };
  if (t.top - GAP - card.height >= EDGE) return { top: t.top - GAP - card.height, left: centred };
  if (t.left + t.width + GAP + card.width <= width - EDGE) return { top: y(Math.max(t.top, 88)), left: t.left + t.width + GAP };
  if (t.left - GAP - card.width >= EDGE) return { top: y(Math.max(t.top, 88)), left: t.left - GAP - card.width };
  return { top: floor - card.height - 8, left: width - card.width - EDGE - 8 };
}

export function Coach({
  lesson,
  index,
  status,
  onBack,
  onNext,
  onRecover,
  onClose,
}: {
  lesson: Lesson;
  index: number;
  status: StepStatus;
  onBack: () => void;
  onNext: () => void;
  /** Take the user back to where the step can be done. */
  onRecover: () => void;
  onClose: () => void;
}) {
  const step = lesson.steps[index];
  const total = lesson.steps.length;
  const last = index === total - 1;
  const spot = useSpot(step);
  const card = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 360, height: 240 });
  useLayoutEffect(() => {
    const el = card.current;
    if (el && (el.offsetWidth !== size.width || el.offsetHeight !== size.height)) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  });

  const lost = status === "lost";
  const shown = lost ? null : spot;
  const at = place(shown, size);
  return (
    <>
      {shown && (
        <div
          aria-hidden
          className={cn("pointer-events-none fixed z-[55] rounded-xl outline outline-2 outline-accent", step.task && status === "waiting" && "animate-coach")}
          style={{
            top: shown.target.top - 6,
            left: shown.target.left - 6,
            width: shown.target.width + 12,
            height: shown.target.height + 12,
            // A dialog or menu already dims the page behind it.
            boxShadow: shown.layer ? "0 0 0 4px var(--accent-soft)" : "0 0 0 4px var(--accent-soft), 0 0 0 200vmax rgba(8, 10, 14, 0.5)",
          }}
        />
      )}
      <aside
        ref={card}
        data-tour-ui
        aria-label={`Guide: ${lesson.title}`}
        aria-live="polite"
        className="fixed z-[70] flex w-[min(360px,calc(100vw-1.5rem))] flex-col rounded-2xl border border-line-strong bg-surface shadow-pop print:hidden"
        // A dialog switches off clicks everywhere outside itself; the card has to stay usable.
        style={{ top: at.top, left: at.left, pointerEvents: "auto" }}
      >
        <header className="flex items-center gap-2 px-4 pt-3.5">
          <lesson.icon className="size-4 shrink-0 text-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-accent">{lesson.title}</span>
          <span className="num shrink-0 text-xs text-muted">{index + 1} of {total}</span>
          <IconButton label="End the lesson" className="-mr-1.5 size-7" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </header>
        <div className="mx-4 mt-2.5 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${((index + 1) / total) * 100}%` }} />
        </div>

        {/* Keyed by step so each one animates in. */}
        <div key={index} className="animate-fade-in px-4 pb-3.5 pt-3.5">
          <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-ink">{step.title}</h2>
          {lost ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
              The control this step is about isn't on screen. You may have moved to another page or closed a window it needs.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{step.body}</p>
              {step.task && (
                <p className={cn("mt-3 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] font-medium leading-snug ring-1 ring-inset", status === "already" ? "bg-gain-soft text-gain ring-transparent" : "bg-accent-soft text-ink ring-accent/20")}>
                  {status === "already" ? <Check className="mt-px size-4 shrink-0" aria-hidden /> : <MousePointerClick className="mt-px size-4 shrink-0 text-accent" aria-hidden />}
                  <span>{status === "already" ? "Already done. Carry on." : <><span className="text-accent">Your turn. </span>{step.task}</>}</span>
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-3.5" />} onClick={onBack} disabled={index === 0}>
            Back
          </Button>
          <span className="flex-1" />
          {lost ? (
            <>
              <Button variant="ghost" size="sm" onClick={onNext}>
                Skip step
              </Button>
              <Button variant="primary" size="sm" onClick={onRecover}>
                Take me back
              </Button>
            </>
          ) : status === "waiting" ? (
            <>
              <span className="text-xs text-muted max-[380px]:hidden">Moves on when you've done it</span>
              <Button variant="ghost" size="sm" onClick={onNext}>
                Skip
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={onNext}>
              {last ? "Finish" : "Next"}
              {!last && <ArrowRight className="size-3.5" />}
            </Button>
          )}
        </footer>
      </aside>
    </>
  );
}
