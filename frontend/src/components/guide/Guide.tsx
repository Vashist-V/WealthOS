/**
 * The guide: hands-on lessons, and the per-page guide behind the ? button.
 *
 * A lesson points at one control at a time, says what it is for and, where
 * the step has a task, waits for the user to do it (see `Coach`). The page
 * guide is a card docked at the corner that explains the page the user is on.
 */
import { ArrowRight, BookOpen, Check, ChevronUp, CircleCheck, Compass, Minus, PartyPopper, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { GUIDE, guideFor, type GuideSection } from "@/lib/guide";
import { A_STOCK, lessonById, lessonFor, LESSONS, type Lesson, type LessonStep } from "@/lib/lessons";
import { usePortfolio } from "@/lib/portfolio";
import { useOverview } from "@/lib/queries";
import { symbolPath } from "@/lib/utils";
import { Button, Dialog, IconButton } from "../ui";
import { Coach, locate, type StepStatus } from "./Coach";

interface GuideState {
  /** Explain the page the user is on. */
  openPageGuide: () => void;
  /** Show the list of hands-on lessons. */
  openLessons: () => void;
  startLesson: (id: string) => void;
  /** True while the page guide is open. */
  active: boolean;
}

const GuideContext = createContext<GuideState | null>(null);
const SEEN = "wealthos.tour.seen";
const DONE = "wealthos.lessons.done";

export function useGuide(): GuideState {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuide must be used inside GuideProvider");
  return ctx;
}

function readDone(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DONE) ?? "[]");
    return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

// --------------------------------------------------------------- page guide
function PageGuide({
  section,
  lesson,
  minimized,
  onMinimize,
  onClose,
  onLessons,
  onLesson,
}: {
  section: GuideSection;
  /** The hands-on lesson about this page, when there is one. */
  lesson: Lesson | null;
  minimized: boolean;
  onMinimize: (minimized: boolean) => void;
  onClose: () => void;
  onLessons: () => void;
  onLesson: (id: string) => void;
}) {
  if (minimized)
    return (
      <button
        onClick={() => onMinimize(false)}
        className="fixed bottom-[76px] right-4 z-40 flex h-10 items-center gap-2 rounded-full border border-accent/30 bg-surface pl-3 pr-3.5 text-[13px] font-medium text-ink shadow-pop transition-colors hover:bg-surface-2 lg:bottom-5 lg:right-5 print:hidden"
      >
        <Compass className="size-4 text-accent" />
        Guide · {section.title}
        <ChevronUp className="size-4 text-muted" />
      </button>
    );

  return (
    <aside
      aria-label="Page guide"
      className="fixed inset-x-3 bottom-[72px] z-40 flex max-h-[min(70dvh,640px)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-pop animate-rise sm:left-auto sm:w-[400px] lg:bottom-5 lg:right-5 print:hidden"
    >
      <header className="flex items-center gap-2 px-4 pt-3.5">
        <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-accent">{section.group}</span>
        <span className="flex-1" />
        <IconButton label="Minimise" className="size-7" onClick={() => onMinimize(true)}>
          <Minus className="size-4" />
        </IconButton>
        <IconButton label="Close the guide" className="size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </header>

      {/* Keyed by section so moving to another page animates the new entry in. */}
      <div key={section.id} className="min-h-0 flex-1 animate-fade-in overflow-y-auto px-4 pb-3 pt-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent ring-1 ring-inset ring-accent/15">
            <section.icon className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight tracking-tight text-ink">{section.title}</h2>
            <p className="mt-0.5 text-[13px] text-accent">“{section.question}”</p>
          </div>
        </div>

        <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wider text-muted">What it is</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{section.what}</p>

        <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wider text-muted">How to use it</h3>
        <ol className="mt-1.5 flex flex-col gap-2">
          {section.how.map((line, i) => (
            <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink-2">
              <span className="num mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-medium text-ink">{i + 1}</span>
              {line}
            </li>
          ))}
        </ol>

        {section.terms && (
          <>
            <h3 className="mt-4 text-[11px] font-medium uppercase tracking-wider text-muted">Reading the numbers</h3>
            <dl className="mt-1.5 flex flex-col gap-2 rounded-xl bg-surface-2 p-3 ring-1 ring-line">
              {section.terms.map((t) => (
                <div key={t.term} className="text-[13px] leading-relaxed">
                  <dt className="inline font-medium text-ink">{t.term}. </dt>
                  <dd className="inline text-ink-2">{t.meaning}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>

      <footer className="flex items-center gap-2 border-t border-line px-4 py-3">
        {lesson ? (
          <Button variant="ghost" size="sm" icon={<Compass className="size-3.5" />} onClick={() => onLesson(lesson.id)}>
            Walk me through it
          </Button>
        ) : (
          <Button variant="ghost" size="sm" icon={<Compass className="size-3.5" />} onClick={onLessons}>
            Hands-on lessons
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" onClick={onClose}>
          Got it
        </Button>
      </footer>
    </aside>
  );
}

// ------------------------------------------------------------------ lessons
function LessonList({ done, onStart }: { done: string[]; onStart: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-2">
      {LESSONS.map((lesson, i) => {
        const finished = done.includes(lesson.id);
        return (
          <li key={lesson.id}>
            <button
              onClick={() => onStart(lesson.id)}
              className="group flex w-full items-center gap-3 rounded-xl border border-line-strong bg-surface p-3 text-left transition-colors hover:border-accent/50 hover:bg-surface-2"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <lesson.icon className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-medium text-ink">
                  {i + 1}. {lesson.title}
                  {finished && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-gain-soft px-1.5 py-0.5 text-[11px] font-medium text-gain">
                      <Check className="size-3" strokeWidth={2.6} aria-hidden /> Done
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                  {lesson.summary} {lesson.steps.length} steps, about {lesson.minutes} min.
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Shown when a lesson ends: what was covered, and the next one to take. */
function Finished({ lesson, next, onStart, onLessons, onClose }: { lesson: Lesson; next: Lesson | null; onStart: (id: string) => void; onLessons: () => void; onClose: () => void }) {
  return (
    <aside
      data-tour-ui
      aria-label="Lesson finished"
      className="fixed inset-x-3 bottom-[72px] z-[70] flex flex-col rounded-2xl border border-line-strong bg-surface p-4 shadow-pop animate-rise sm:left-auto sm:w-[380px] lg:bottom-5 lg:right-5 print:hidden"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-gain-soft text-gain">
          <PartyPopper className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-snug tracking-tight text-ink">Lesson done: {lesson.title}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
            {next ? <>Next up is <span className="font-medium text-ink">{next.title}</span>. {next.summary}</> : "That was the last one. You have been through every lesson."}
          </p>
        </div>
        <IconButton label="Close" className="-mr-1.5 -mt-1 size-7" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="mt-3.5 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onLessons}>
          All lessons
        </Button>
        {next ? (
          <Button variant="primary" size="sm" onClick={() => onStart(next.id)}>
            Start it <ArrowRight className="size-3.5" />
          </Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </aside>
  );
}

// ----------------------------------------------------------------- provider
interface Run {
  lesson: Lesson;
  index: number;
  /** The user was stepping backwards, so a step that has to be passed over is passed over that way. */
  back?: boolean;
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { id: portfolioId } = usePortfolio();
  const { data: overview } = useOverview(portfolioId);
  const [pageGuide, setPageGuide] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [list, setList] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [watched, setWatched] = useState<{ step: LessonStep | null; status: StepStatus }>({ step: null, status: "reading" });
  const [finished, setFinished] = useState<Lesson | null>(null);
  const [done, setDone] = useState<string[]>(readDone);

  /** A step's page; the stock lesson opens a stock the user actually holds when there is one. */
  const resolve = useCallback((path: string) => (path === A_STOCK ? symbolPath(overview?.holdings[0]?.symbol ?? "RELIANCE") : path), [overview]);

  const startLesson = useCallback((id: string) => {
    const lesson = lessonById(id);
    if (!lesson) return;
    localStorage.setItem(SEEN, "1");
    setWelcome(false);
    setList(false);
    setPageGuide(false);
    setFinished(null);
    setRun({ lesson, index: 0 });
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (!run) return;
      const index = run.index + delta;
      if (index < run.lesson.steps.length) return setRun({ lesson: run.lesson, index: Math.max(index, 0), back: delta < 0 && index > 0 });
      const next = [...new Set([...done, run.lesson.id])];
      localStorage.setItem(DONE, JSON.stringify(next));
      setDone(next);
      setRun(null);
      setFinished(run.lesson);
    },
    [run, done],
  );

  /** Back to the last step that names a page, for when the user has wandered off the lesson. */
  const recover = useCallback(() => {
    if (!run) return;
    let index = run.index;
    while (index > 0 && !run.lesson.steps[index].path) index -= 1;
    const path = run.lesson.steps[index].path;
    if (path) navigate(resolve(path));
    setRun({ lesson: run.lesson, index });
  }, [run, navigate, resolve]);

  const step = run ? run.lesson.steps[run.index] : null;
  // A status belongs to the step it was worked out for; a step that has only just begun starts from its own.
  const status: StepStatus = watched.step === step ? watched.status : step?.until ? "waiting" : "reading";

  // Go to the step's page. Only when the step changes: a task may itself take the user somewhere else.
  useEffect(() => {
    if (!step?.path) return;
    const to = resolve(step.path);
    if (!(step.stay ? step.stay.test(pathname) : pathname === to)) navigate(to);
  }, [step]);

  // Watch the step: is its control on screen, and has the user done what it asks?
  useEffect(() => {
    if (!run || !step) return;
    const until = step.until;
    const start: StepStatus = until ? "waiting" : "reading";
    const setStatus = (next: StepStatus) => setWatched((w) => (w.step === step && w.status === next ? w : { step, status: next }));
    setStatus(start);
    let missingSince: number | null = null;
    let lost = false;
    let touched = false; // the user has used the page since the step began
    let already = false; // the task was done before the user touched anything
    let seen = false; // for `gone`: the control has been on screen
    let value = "";
    let changedAt = 0;
    let finishing = 0;
    let over = false;
    const finish = (delta: number, delay: number) => {
      over = true;
      finishing = window.setTimeout(() => move(delta), delay);
    };

    const met = (now: number): boolean => {
      if (!until || "click" in until) return false;
      if ("appears" in until) return locate(until.appears) !== null;
      if ("path" in until) return until.path.test(window.location.pathname);
      if ("gone" in until) {
        const here = locate(until.gone) !== null;
        seen ||= here;
        return seen && !here;
      }
      const field = locate(until.filled === true ? step.target : until.filled);
      const input = field?.matches("input, textarea, select") ? (field as HTMLInputElement) : field?.querySelector<HTMLInputElement>("input, textarea, select");
      const text = input?.value.trim() ?? "";
      if (text !== value) {
        value = text;
        changedAt = now;
      }
      // Wait for a pause in typing, so "3" on the way to "30" doesn't count.
      return text !== "" && Number(text) !== 0 && (!touched || now - changedAt > 900);
    };

    const watch = window.setInterval(() => {
      if (over) return;
      const now = performance.now();
      if (!step.target || locate(step.target)) {
        missingSince = null;
        if (lost) {
          lost = false;
          setStatus(already ? "already" : start);
        }
      } else {
        missingSince ??= now;
        if (step.optional && now - missingSince > 700) return finish(run.back ? -1 : 1, 0);
        if (!step.optional && now - missingSince > 1600 && !lost) {
          lost = true;
          setStatus("lost");
        }
      }
      if (already || !met(now)) return;
      // Done before the user touched anything: it was already so. Say that, and let them move on themselves.
      if (touched) return finish(1, 350);
      already = true;
      if (!lost) setStatus("already");
    }, 150);

    const touch = () => {
      touched = true;
    };
    const click = (e: MouseEvent) => {
      if (over || !until || !("click" in until)) return;
      const target = locate(step.target);
      if (target && e.target instanceof Node && target.contains(e.target)) finish(1, 350);
    };
    document.addEventListener("pointerdown", touch, true);
    document.addEventListener("keydown", touch, true);
    document.addEventListener("click", click, true);
    return () => {
      window.clearInterval(watch);
      window.clearTimeout(finishing);
      document.removeEventListener("pointerdown", touch, true);
      document.removeEventListener("keydown", touch, true);
      document.removeEventListener("click", click, true);
    };
  }, [run]);

  // The first visit offers the guide; a link such as /?guide=trade-check starts a lesson straight away.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = params.get("guide");
    if (asked === null) {
      if (!localStorage.getItem(SEEN)) setWelcome(true);
      return;
    }
    localStorage.setItem(SEEN, "1");
    params.delete("guide");
    navigate({ pathname: window.location.pathname, search: params.toString() }, { replace: true });
    if (lessonById(asked)) startLesson(asked);
    else setList(true);
  }, []);

  const dismissWelcome = useCallback(() => {
    localStorage.setItem(SEEN, "1");
    setWelcome(false);
  }, []);
  const openPageGuide = useCallback(() => {
    setMinimized(false);
    setPageGuide(true);
  }, []);
  const openLessons = useCallback(() => {
    setPageGuide(false);
    setFinished(null);
    setList(true);
  }, []);

  const value = useMemo<GuideState>(() => ({ openPageGuide, openLessons, startLesson, active: pageGuide }), [openPageGuide, openLessons, startLesson, pageGuide]);
  const upNext = finished ? (LESSONS.slice(LESSONS.indexOf(finished) + 1).find((l) => !done.includes(l.id)) ?? null) : null;

  return (
    <GuideContext.Provider value={value}>
      {children}
      {run && <Coach lesson={run.lesson} index={run.index} status={status} onBack={() => move(-1)} onNext={() => move(1)} onRecover={recover} onClose={() => setRun(null)} />}
      {finished && !run && <Finished lesson={finished} next={upNext} onStart={startLesson} onLessons={openLessons} onClose={() => setFinished(null)} />}
      {pageGuide && !run && (
        <PageGuide
          section={guideFor(pathname) ?? GUIDE[0]}
          lesson={lessonFor(pathname)}
          minimized={minimized}
          onMinimize={setMinimized}
          onClose={() => setPageGuide(false)}
          onLessons={openLessons}
          onLesson={startLesson}
        />
      )}

      <Dialog
        open={list}
        onOpenChange={setList}
        title="Hands-on lessons"
        description="Each one points at the real controls, says what they do and has you try them. Take them in order, or pick what you need."
        footer={
          <>
            <Link to="/docs" className="mr-auto inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
              <BookOpen className="size-4" aria-hidden /> Read the docs
            </Link>
            <Button variant="ghost" onClick={() => setList(false)}>
              Close
            </Button>
          </>
        }
      >
        <LessonList done={done} onStart={startLesson} />
        <p className="mt-3.5 flex items-start gap-2 text-xs leading-relaxed text-muted">
          <CircleCheck className="mt-px size-3.5 shrink-0" aria-hidden />
          Nothing in a lesson places a real trade. On any page, the ? button at the top explains that page.
        </p>
      </Dialog>

      <Dialog
        open={welcome}
        onOpenChange={(open) => !open && dismissWelcome()}
        title="Welcome to WealthOS"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={dismissWelcome}>
              I'll explore on my own
            </Button>
            <Button variant="primary" icon={<Compass className="size-4" />} onClick={() => startLesson("basics")}>
              Show me around
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">
          WealthOS shows what your investments are doing and why, and lets you test a trade before you make it. It never places one for you.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-2">
          New here? The guide takes about two minutes. It points at one button at a time, tells you what it does and has you try it, so you learn the app by using it. You can stop at any step, and
          <span className="mx-1 inline-flex size-5 items-center justify-center rounded-md bg-surface-3 align-middle text-xs font-semibold text-ink">?</span>
          at the top explains whichever page you are on.
        </p>
      </Dialog>
    </GuideContext.Provider>
  );
}
