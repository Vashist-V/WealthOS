/**
 * Import trades from screenshots of Groww's order screens.
 *
 * The user adds screenshots (choose, drop or paste), AI reads every order in
 * them, and the trades come back as editable rows: fix anything, delete or add
 * rows, choose the portfolio, save. Saving goes through the same import as a
 * CSV file. The pictures are only read: the server keeps none of them.
 */
import { ArrowLeft, Camera, ImagePlus, Info, Loader2, Lock, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Dialog, Field, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { findDuplicateLines } from "@/lib/csv";
import { date, price, quantity } from "@/lib/format";
import { MAX_FILE_BYTES, prepareScreenshot, type ScreenshotPart } from "@/lib/images";
import { usePortfolio } from "@/lib/portfolio";
import { errorMessage, useAction, useMe, useTransactions } from "@/lib/queries";
import type { TradeReading } from "@/lib/types";
import { cn } from "@/lib/utils";
import { plural } from "../portfolio/shared";
import { blankRow, inOrder, problems, toInput, toRow, TradeRows, type TradeRow } from "./TradeRows";

type Step = "pick" | "reading" | "review";
interface Shot {
  id: number;
  file: File;
  url: string;
}

/** The server reads at most this many pictures at once (a long screenshot can make several). */
const MAX_PARTS = 10;
const MAX_SHOTS = 8;

function Privacy() {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>Screenshots are read once to find your trades and then thrown away. WealthOS never stores them. Only the trades you save are kept.</span>
    </p>
  );
}

function Notes({ reading }: { reading: TradeReading }) {
  const lines = [...(reading.skipped ?? []).map((line) => `Left out. ${line}`), ...(reading.notes ?? [])];
  if (!lines.length) return null;
  return (
    <div className="rounded-xl bg-surface-2 px-3.5 py-2.5 ring-1 ring-line">
      <ul className="flex flex-col gap-1 text-xs leading-relaxed text-ink-2">
        {lines.map((line) => (
          <li key={line} className="flex items-start gap-1.5">
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ScreenshotImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const me = useMe();
  const { id: activeId, investment } = usePortfolio();
  const [step, setStep] = useState<Step>("pick");
  const [shots, setShots] = useState<Shot[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [reading, setReading] = useState<TradeReading | null>(null);
  const [rows, setRows] = useState<TradeRow[]>([]);
  const [portfolioId, setPortfolioId] = useState("");
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [showErrors, setShowErrors] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<{ cancelled: boolean } | null>(null);
  const nextId = useRef(1);

  const fallback = investment.find((p) => p.id === activeId)?.id ?? investment[0]?.id ?? "";
  const allowance = me.data?.ai_usage?.screenshots;
  const canRead = me.data?.screenshots !== false;

  useEffect(() => {
    if (!open) return;
    setStep("pick");
    setShots((old) => {
      old.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
    setProblem(null);
    setReading(null);
    setRows([]);
    setKeep(new Set());
    setShowErrors(false);
    setPortfolioId(fallback);
    // Only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Let go of the previews when the dialog closes.
  useEffect(() => {
    if (open) return;
    if (cancel.current) cancel.current.cancelled = true;
  }, [open]);

  const add = (files: FileList | File[]) => {
    const pictures = Array.from(files).filter((f) => f.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|gif)$/i.test(f.name));
    if (!pictures.length) {
      setProblem("Those aren't pictures. Add screenshots (PNG or JPEG).");
      return;
    }
    const big = pictures.find((f) => f.size > MAX_FILE_BYTES);
    if (big) {
      setProblem(`${big.name} is larger than 25 MB.`);
      return;
    }
    setProblem(null);
    setShots((list) => {
      const room = MAX_SHOTS - list.length;
      if (pictures.length > room) setProblem(`Up to ${MAX_SHOTS} screenshots at a time. Read these first, then add the rest.`);
      return [...list, ...pictures.slice(0, Math.max(0, room)).map((file) => ({ id: nextId.current++, file, url: URL.createObjectURL(file) }))];
    });
  };

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    if (!open || step !== "pick") return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  const read = async () => {
    if (!shots.length) return;
    const token = { cancelled: false };
    cancel.current = token;
    setProblem(null);
    setStep("reading");
    try {
      const parts: ScreenshotPart[] = [];
      for (const [index, shot] of shots.entries()) parts.push(...(await prepareScreenshot(shot.file, index + 1)));
      if (parts.length > MAX_PARTS) throw new Error("These screenshots are too long to read at once. Remove one or two and try again.");
      const result = await api.readScreenshots(parts, activeId && activeId !== "all" ? activeId : null);
      if (token.cancelled) return;
      void me.refetch();
      // A part of a long screenshot is named by the screenshot it came from.
      const owner = (n: number | null) => (n && parts[n - 1] ? parts[n - 1].group : n);
      const target = investment.some((p) => p.id === result.portfolio_id) ? result.portfolio_id! : fallback;
      setReading(result);
      setPortfolioId(target);
      setRows(result.trades.map((t) => toRow(t, owner(t.screenshot), target)));
      setKeep(new Set());
      setShowErrors(false);
      setStep("review");
    } catch (error) {
      if (token.cancelled) return;
      setProblem(errorMessage(error));
      setStep("pick");
    }
  };

  // Rows already in the chosen portfolio (same date, stock, side, shares and price) are left out unless kept.
  const existing = useTransactions(open && step === "review" && portfolioId ? portfolioId : null);
  const duplicates = useMemo(() => {
    if (!existing.data) return new Set<string>();
    // The CSV import's own matching, given the rows in the shape it reads.
    const found = findDuplicateLines(
      rows.map((row, line) => ({ line, raw: {} as never, input: row.symbol && Number(row.quantity) > 0 ? toInput(row) : null, error: null })),
      existing.data.transactions,
    );
    return new Set(rows.filter((_, line) => found.has(line)).map((row) => row.key));
  }, [rows, existing.data]);
  const chosen = rows.filter((r) => !duplicates.has(r.key) || keep.has(r.key));
  const broken = chosen.filter((r) => Object.keys(problems({ ...r, portfolioId: portfolioId })).length > 0);
  const flagged = chosen.reduce((n, r) => n + Object.keys(r.check).length, 0);
  const target = investment.find((p) => p.id === portfolioId);

  const save = useAction(
    (list: TradeRow[]) => api.importTransactions(portfolioId, inOrder(list).map(toInput)),
    {
      invalidate: "portfolio",
      quietErrors: true,
      onSuccess: (out) => {
        toast.success(`Saved ${plural(out.imported, "trade")} to ${target?.name ?? "your portfolio"}`, {
          description: "Holdings now show their live value and today's change.",
          action: { label: "See holdings", onClick: () => navigate("/holdings") },
        });
        onOpenChange(false);
      },
    },
  );

  const submit = () => {
    setShowErrors(true);
    if (!chosen.length || broken.length || !target) return;
    save.mutate(chosen);
  };
  const failure = save.error;

  const footer =
    step === "review" ? (
      <>
        <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("pick")} disabled={save.isPending}>
          <span className="max-sm:hidden">Other screenshots</span>
          <span className="sm:hidden">Back</span>
        </Button>
        <Button variant="primary" onClick={submit} loading={save.isPending} disabled={!chosen.length || !target || existing.isLoading}>
          {chosen.length ? `Save ${plural(chosen.length, "trade")}` : "Nothing to save"}
        </Button>
      </>
    ) : step === "reading" ? (
      <Button
        variant="ghost"
        onClick={() => {
          if (cancel.current) cancel.current.cancelled = true;
          setStep("pick");
        }}
      >
        Cancel
      </Button>
    ) : (
      <>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void read()} disabled={!shots.length || !canRead || !investment.length}>
          {shots.length ? `Read ${plural(shots.length, "screenshot")}` : "Read screenshots"}
        </Button>
      </>
    );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Import from Groww screenshots"
      description={
        step === "review"
          ? "Check what was read. Change anything that's wrong, then save."
          : "Add screenshots of your Groww orders. AI reads each trade for you to check before saving."
      }
      size={step === "review" ? "xl" : "lg"}
      footer={footer}
    >
      {step === "pick" && (
        <div className="flex flex-col gap-4">
          {!canRead && (
            <p role="alert" className="rounded-xl bg-warn-soft px-3.5 py-3 text-[13px] text-ink-2">
              Reading screenshots needs AI, which isn't set up on this server yet. You can still add trades by hand or import a CSV.
            </p>
          )}
          {!investment.length && (
            <p role="alert" className="rounded-xl bg-warn-soft px-3.5 py-3 text-[13px] text-ink-2">Create an investment portfolio first, then import into it.</p>
          )}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center rounded-xl border border-dashed px-5 py-7 text-center transition-colors",
              dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2",
            )}
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-surface text-accent ring-1 ring-line">
              <Camera className="size-5" aria-hidden />
            </div>
            <p className="mt-3 text-sm font-medium text-ink">{dragging ? "Drop to add them" : "Add your Groww screenshots"}</p>
            <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">Choose them, drop them here, or paste one. You can add several at once.</p>
            <Button className="mt-4" variant="primary" icon={<ImagePlus className="size-4" />} onClick={() => input.current?.click()} disabled={shots.length >= MAX_SHOTS}>
              Choose screenshots
            </Button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) add(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {shots.length > 0 && (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6" aria-label="Screenshots to read">
              {shots.map((shot, i) => (
                <li key={shot.id} className="group relative aspect-[9/16] overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line">
                  <img src={shot.url} alt={`Screenshot ${i + 1}`} className="size-full object-cover object-top" />
                  <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 text-[11px] font-medium text-white">{i + 1}</span>
                  <button
                    type="button"
                    aria-label={`Remove screenshot ${i + 1}`}
                    onClick={() =>
                      setShots((list) => {
                        URL.revokeObjectURL(shot.url);
                        return list.filter((s) => s.id !== shot.id);
                      })
                    }
                    className="absolute right-1 top-1 inline-flex size-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {problem && (
            <p role="alert" className="rounded-xl bg-loss-soft px-3.5 py-3 text-[13px] text-loss">{problem}</p>
          )}

          <div className="rounded-xl px-4 py-3 ring-1 ring-line">
            <p className="text-[13px] font-medium text-ink">Which screens to use</p>
            <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[13px] leading-relaxed text-ink-2">
              <li>In Groww, open <span className="font-medium">Stocks → Orders</span> (or your order history).</li>
              <li>Screenshot the list. Scroll and take more for older orders, or open one order for its full details.</li>
              <li>Add them here. Each trade is read for you to check; nothing is saved until you press Save.</li>
            </ol>
          </div>

          <Privacy />
          {allowance?.limit != null && (
            <p className="-mt-2 text-xs text-muted">
              {allowance.left ?? 0} of {allowance.limit} screenshots left today.
            </p>
          )}
        </div>
      )}

      {step === "reading" && (
        <div className="flex flex-col items-center py-10 text-center" role="status">
          <Loader2 className="size-7 animate-spin text-accent" aria-hidden />
          <p className="mt-4 text-sm font-medium text-ink">Reading {plural(shots.length, "screenshot")}…</p>
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">
            AI is finding each trade and checking it against that day's prices. This usually takes 10 to 40 seconds.
          </p>
          <div className="mt-5 flex gap-1.5">
            {shots.slice(0, 6).map((shot) => (
              <img key={shot.id} src={shot.url} alt="" className="h-16 w-9 rounded object-cover object-top opacity-70 ring-1 ring-line" />
            ))}
          </div>
        </div>
      )}

      {step === "review" && reading && (
        <div className="flex flex-col gap-4">
          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field label="Save into" error={!target ? "Create an investment portfolio first." : null}>
              {(props) => (
                <Select
                  {...props}
                  value={portfolioId}
                  disabled={save.isPending}
                  onChange={(e) => {
                    setPortfolioId(e.target.value);
                    save.reset();
                  }}
                >
                  {investment.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-line" role="status">
              <div className="text-[13px] text-muted">
                Found in {plural(shots.length, "screenshot")}
                {reading.read_by && reading.read_by !== "WealthOS" ? ` by ${reading.read_by}` : ""}
              </div>
              <div className="num mt-0.5 text-base font-semibold tracking-tight text-ink">
                {plural(rows.length, "trade")}
                {flagged > 0 && <span className="ml-2 text-[13px] font-medium text-warn">{plural(flagged, "thing")} to check</span>}
              </div>
            </div>
          </div>

          <Notes reading={reading} />

          {rows.length === 0 ? (
            <div className="rounded-xl border border-line px-4 py-8 text-center text-[13px] text-muted">
              {reading.message} You can add a trade by hand below.
            </div>
          ) : (
            <TradeRows rows={rows} onChange={setRows} />
          )}

          {duplicates.size > 0 && (
            <div className="rounded-xl bg-warn-soft/50 px-3.5 py-3 text-[13px] text-ink-2 ring-1 ring-warn/30">
              <p className="font-medium text-ink">
                {plural(duplicates.size, "trade")} {duplicates.size === 1 ? "is" : "are"} already in {target?.name ?? "this portfolio"}, so{" "}
                {duplicates.size === 1 ? "it won't" : "they won't"} be saved twice.
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {rows
                  .filter((r) => duplicates.has(r.key))
                  .map((r) => (
                    <li key={r.key} className="flex flex-wrap items-center gap-x-2">
                      <span>
                        {r.type === "BUY" ? "Buy" : "Sell"} {quantity(Number(r.quantity))} {r.symbol} at {price(Number(r.price))} on {date(r.date)}
                      </span>
                      <button
                        type="button"
                        className="text-xs font-medium text-accent hover:underline"
                        onClick={() =>
                          setKeep((set) => {
                            const next = new Set(set);
                            if (next.has(r.key)) next.delete(r.key);
                            else next.add(r.key);
                            return next;
                          })
                        }
                      >
                        {keep.has(r.key) ? "Don't save it again" : "It's a separate trade: save it"}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div>
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setRows((list) => [...list, blankRow(portfolioId, "Added while importing Groww screenshots")])}>
              Add a missing trade
            </Button>
          </div>

          {showErrors && broken.length > 0 && (
            <p role="alert" className="rounded-xl bg-loss-soft px-3.5 py-3 text-[13px] text-loss">
              {plural(broken.length, "trade")} still {broken.length === 1 ? "needs" : "need"} a stock, number of shares, price or date. Fill {broken.length === 1 ? "it" : "them"} in, or remove {broken.length === 1 ? "it" : "them"}.
            </p>
          )}
          {failure && (
            <p role="alert" className="rounded-xl bg-loss-soft px-3.5 py-3 text-[13px] text-loss">
              {errorMessage(failure)}{" "}
              {failure instanceof ApiError && /sell more/i.test(failure.message)
                ? "Nothing was saved. A sale needs the shares to be bought first: add the buy, or choose the portfolio that holds them."
                : "Nothing was saved."}
            </p>
          )}
          <Privacy />
        </div>
      )}
    </Dialog>
  );
}

/** Shown where the app offers ways to add trades. */
export function ScreenshotButton({ onClick, className, variant = "secondary" }: { onClick: () => void; className?: string; variant?: "primary" | "secondary" }) {
  return (
    <Button variant={variant} icon={<Camera className="size-4" />} onClick={onClick} className={className}>
      From Groww screenshots
    </Button>
  );
}
