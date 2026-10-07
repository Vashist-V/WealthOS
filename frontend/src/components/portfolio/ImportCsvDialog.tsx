import { AlertTriangle, ArrowLeft, Check, FileSpreadsheet, Upload } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Dialog, Field, Segmented, Select, Skeleton, Switch, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import {
  FIELD_LABELS, findDuplicateLines, MAX_IMPORT_ROWS, OPTIONAL_FIELDS, parseTransactionsCsv, REQUIRED_FIELDS, TRANSACTIONS_TEMPLATE,
  type ColumnMapping, type CsvField, type ParsedCsv, type ParsedRow,
} from "@/lib/csv";
import { date, number, price, quantity } from "@/lib/format";
import { usePortfolio } from "@/lib/portfolio";
import { errorMessage, useAction, useTransactions } from "@/lib/queries";
import type { TransactionInput, TxType } from "@/lib/types";
import { cn, downloadFile } from "@/lib/utils";
import { plural, TypeBadge } from "./shared";

type Step = "source" | "map" | "preview";
type RowState = "ready" | "invalid" | "duplicate";
type View = "all" | "ready" | "skipped";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PREVIEW_ROWS = 200;
/** Select value meaning "the file has no buy/sell column; treat every row as a buy". */
const ALL_BUYS = "::every-row-is-a-buy::";

const DESCRIPTIONS: Record<Step, string> = {
  source: "Bring in past trades from a broker export or your own spreadsheet.",
  map: "Match the columns in your file to the fields a transaction needs.",
  preview: "Check the rows before they are added to the ledger.",
};

function Notice({ tone, title, children }: { tone: "loss" | "warn"; title: string; children?: React.ReactNode }) {
  return (
    <div role="alert" className={cn("flex gap-2.5 rounded-xl px-3.5 py-3 text-[13px]", tone === "loss" ? "bg-loss-soft" : "bg-warn-soft")}>
      <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", tone === "loss" ? "text-loss" : "text-warn")} aria-hidden />
      <div className="min-w-0">
        <div className={cn("font-medium", tone === "loss" ? "text-loss" : "text-warn")}>{title}</div>
        {children && <div className="mt-0.5 leading-relaxed text-ink-2">{children}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ step 1: source
function SourceStep({ error, onText }: { error: string | null; onText: (text: string, name: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState("");
  const [readError, setReadError] = useState<string | null>(null);

  const readFile = async (file: File) => {
    setReadError(null);
    if (/\.(xlsx?|xlsm|ods|numbers)$/i.test(file.name)) {
      setReadError(`${file.name} is a spreadsheet workbook. Open it, save it as CSV, then import that file.`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setReadError(`${file.name} is larger than 5 MB. Split it into smaller files and import them one at a time.`);
      return;
    }
    try {
      onText(await file.text(), file.name);
    } catch {
      setReadError(`${file.name} couldn't be read. Choose the file again.`);
    }
  };

  const problem = readError ?? error;
  return (
    <div className="flex flex-col gap-4">
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
          const file = e.dataTransfer.files[0];
          if (file) void readFile(file);
        }}
        className={cn(
          "flex flex-col items-center rounded-xl border border-dashed px-5 py-8 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2",
        )}
      >
        <div className="flex size-11 items-center justify-center rounded-xl bg-surface text-muted ring-1 ring-line">
          <Upload className="size-5" aria-hidden />
        </div>
        <p className="mt-3 text-sm font-medium text-ink">{dragging ? "Drop the file to read it" : "Drop a CSV file here"}</p>
        <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">
          A Zerodha tradebook and a Groww order history are read as they are. Any other CSV needs a date, symbol, buy or sell, quantity and price.
        </p>
        <Button className="mt-4" icon={<FileSpreadsheet className="size-4" />} onClick={() => input.current?.click()}>
          Choose file
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void readFile(file);
          }}
        />
      </div>

      {problem && <Notice tone="loss" title="This file can't be imported">{problem}</Notice>}

      <Field label="Or paste rows" hint="Copy the rows from a spreadsheet, header row included, and paste them here.">
        {(props) => (
          <Textarea
            {...props}
            rows={4}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"date,symbol,type,quantity,price,fees,notes\n2025-04-07,RELIANCE,BUY,10,1265.50,12.40,First purchase"}
            spellCheck={false}
            className="num whitespace-pre text-[13px]"
          />
        )}
      </Field>
      <div>
        <Button
          size="sm"
          disabled={!pasted.trim()}
          onClick={() => {
            setReadError(null);
            onText(pasted, null);
          }}
        >
          Preview pasted rows
        </Button>
      </div>

      <dl className="grid gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px] sm:grid-cols-3">
        {[
          ["Zerodha", "Console → Reports → Tradebook, downloaded as CSV."],
          ["Groww", "Stocks order history. If it downloads as Excel, save it as CSV first."],
          ["Your own file", "One trade per row. Dates as 2025-04-07, 07-04-2025 or 7 Apr 2025."],
        ].map(([term, detail]) => (
          <div key={term}>
            <dt className="font-medium text-ink">{term}</dt>
            <dd className="mt-0.5 leading-relaxed text-muted">{detail}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ----------------------------------------------------------- step 2: columns
function MapStep({
  parsed,
  mapping,
  defaultType,
  onChange,
}: {
  parsed: ParsedCsv;
  mapping: ColumnMapping;
  defaultType: TxType | null;
  onChange: (mapping: ColumnMapping, defaultType: TxType | null) => void;
}) {
  const set = (field: CsvField, value: string) => {
    if (field === "type" && value === ALL_BUYS) onChange({ ...mapping, type: "" }, "BUY");
    else onChange({ ...mapping, [field]: value }, field === "type" ? null : defaultType);
  };
  const select = (field: CsvField, required: boolean) => {
    const chosen = field === "type" && defaultType ? ALL_BUYS : (mapping[field] ?? "");
    const derived = field === "price" && !mapping.price && mapping.value;
    const example = chosen && chosen !== ALL_BUYS ? parsed.sample[chosen] : "";
    return (
      <Field
        key={field}
        label={required ? FIELD_LABELS[field] : `${FIELD_LABELS[field]} (optional)`}
        hint={derived ? `Not chosen: worked out as “${mapping.value}” ÷ quantity.` : example ? `First row: ${example}` : undefined}
      >
        {(props) => (
          <Select {...props} value={chosen} onChange={(e) => set(field, e.target.value)}>
            <option value="">{required ? "Choose a column" : "Not in this file"}</option>
            {parsed.headers.map((header) => (
              <option key={header} value={header}>{header}</option>
            ))}
            {field === "type" && <option value={ALL_BUYS}>No such column: every row is a buy</option>}
          </Select>
        )}
      </Field>
    );
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        {parsed.missing.length
          ? "Some columns couldn't be matched by name. Choose which column in the file holds each field."
          : "These columns were matched by name. Change any that point at the wrong column."}{" "}
        The file has {plural(parsed.headers.length, "column")}:{" "}
        <span className="text-muted">{parsed.headers.join(", ")}</span>.
      </p>
      <div className="grid gap-x-3 gap-y-4 sm:grid-cols-2">
        {REQUIRED_FIELDS.map((field) => select(field, true))}
        {OPTIONAL_FIELDS.map((field) => select(field, false))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- step 3: preview
const CELL = "px-2.5 py-2 first:pl-3.5 last:pr-3.5";

function PreviewTable({ rows }: { rows: { row: ParsedRow; state: RowState }[] }) {
  const head = cn(CELL, "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-surface-2 text-xs font-medium text-muted");
  return (
    <div className="max-h-[min(42dvh,340px)] overflow-auto rounded-xl border border-line">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th scope="col" className={cn(head, "text-right max-sm:hidden")}>Line</th>
            <th scope="col" className={cn(head, "text-left")}>Date</th>
            <th scope="col" className={cn(head, "text-left")}>Symbol</th>
            <th scope="col" className={cn(head, "text-left")}>Type</th>
            <th scope="col" className={cn(head, "text-right")}>Quantity</th>
            <th scope="col" className={cn(head, "text-right")}>Price</th>
            <th scope="col" className={cn(head, "text-right max-sm:hidden")}>Fees</th>
            <th scope="col" className={cn(head, "text-left max-md:hidden")}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ row, state }) => {
            const t = row.input;
            const tint = state === "invalid" ? "bg-loss-soft" : state === "duplicate" ? "bg-warn-soft" : "";
            const cell = cn(CELL, "align-middle text-ink-2", state === "ready" && "border-b border-line", tint);
            const right = cn(cell, "num whitespace-nowrap text-right");
            return (
              <Fragment key={row.line}>
                <tr>
                  <td className={cn(right, "text-muted max-sm:hidden")}>{row.line}</td>
                  <td className={cn(cell, "num whitespace-nowrap")}>{t ? date(t.transaction_date) : row.raw.date || "—"}</td>
                  <td className={cn(cell, "max-w-40 truncate font-medium text-ink")}>{t ? t.symbol : row.raw.symbol || "—"}</td>
                  <td className={cell}>{t ? <TypeBadge type={t.transaction_type} /> : row.raw.type || "—"}</td>
                  <td className={right}>{t ? quantity(t.quantity) : row.raw.quantity || "—"}</td>
                  <td className={right}>{t ? price(t.price) : row.raw.price || "—"}</td>
                  <td className={cn(right, "max-sm:hidden")}>{t ? (t.fees ? price(t.fees) : "—") : row.raw.fees || "—"}</td>
                  <td className={cn(cell, "max-w-48 truncate max-md:hidden")} title={(t ? t.notes : row.raw.notes) || undefined}>{(t ? t.notes : row.raw.notes) || "—"}</td>
                </tr>
                {state !== "ready" && (
                  <tr>
                    <td colSpan={8} className={cn(CELL, "border-b border-line pb-2.5 pt-0 text-xs", tint)}>
                      <span className={cn("inline-flex items-start gap-1.5 font-medium", state === "invalid" ? "text-loss" : "text-warn")}>
                        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                        <span>
                          <span className="sm:hidden">Line {row.line}: </span>
                          Skipped. {state === "invalid" ? row.error : "Already in this portfolio with the same date, type, quantity and price"}.
                        </span>
                      </span>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Import transactions from a CSV: choose or paste a file, map columns if the
 * headers aren't recognised, review every row, then add the valid ones to an
 * investment portfolio in one request.
 */
export function ImportCsvDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { id: activeId, investment, paper, portfolios } = usePortfolio();
  const [step, setStep] = useState<Step>("source");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [defaultType, setDefaultType] = useState<TxType | null>(null);
  const [portfolioId, setPortfolioId] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [view, setView] = useState<View>("all");

  const importer = useAction(({ target, rows }: { target: string; rows: TransactionInput[] }) => api.importTransactions(target, rows), {
    invalidate: "portfolio",
    success: (out, input) => `Imported ${plural(out.imported, "transaction")} into ${portfolios.find((p) => p.id === input.target)?.name ?? "the portfolio"}`,
    onSuccess: () => onOpenChange(false),
    quietErrors: true,
  });
  const resetImporter = importer.reset;

  useEffect(() => {
    if (!open) return;
    setStep("source");
    setText("");
    setFileName(null);
    setFileError(null);
    setParsed(null);
    setMapping({});
    setDefaultType(null);
    setSkipDuplicates(true);
    setView("all");
    setPortfolioId(investment.find((p) => p.id === activeId)?.id ?? investment[0]?.id ?? "");
    resetImporter();
    // Only when the dialog opens: later portfolio refetches must not wipe a file in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const existing = useTransactions(open && step === "preview" && portfolioId ? portfolioId : null);
  const duplicates = useMemo(
    () => (parsed && existing.data ? findDuplicateLines(parsed.rows, existing.data.transactions) : new Set<number>()),
    [parsed, existing.data],
  );
  const rows = useMemo(
    () =>
      (parsed?.rows ?? []).map((row) => ({
        row,
        state: (row.error ? "invalid" : skipDuplicates && duplicates.has(row.line) ? "duplicate" : "ready") as RowState,
      })),
    [parsed, duplicates, skipDuplicates],
  );
  const ready = useMemo(() => rows.filter((r) => r.state === "ready"), [rows]);
  const skipped = rows.length - ready.length;
  const shown = view === "all" ? rows : view === "ready" ? ready : rows.filter((r) => r.state !== "ready");
  const tooMany = ready.length > MAX_IMPORT_ROWS;
  const target = investment.find((p) => p.id === portfolioId);

  const load = (csv: string, name: string | null) => {
    const result = parseTransactionsCsv(csv);
    if (result.error) {
      setFileError(result.error);
      return;
    }
    setFileError(null);
    setText(csv);
    setFileName(name);
    setParsed(result);
    setMapping(result.mapping);
    setDefaultType(null);
    setView("all");
    resetImporter();
    setStep(result.missing.length ? "map" : "preview");
  };

  const mapped = {
    date: !!mapping.date,
    symbol: !!mapping.symbol,
    type: !!mapping.type || !!defaultType,
    quantity: !!mapping.quantity,
    price: !!mapping.price || !!mapping.value,
  };
  const applyMapping = () => {
    // An empty string clears a field the parser would otherwise detect by name.
    const overrides: ColumnMapping = {};
    [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].forEach((field) => {
      overrides[field] = mapping[field] ?? "";
    });
    const result = parseTransactionsCsv(text, { mapping: overrides, defaultType });
    setParsed(result);
    setView("all");
    resetImporter();
    if (!result.missing.length) setStep("preview");
  };

  const submit = () => {
    if (!target || !ready.length || tooMany) return;
    importer.mutate({ target: target.id, rows: ready.flatMap((r) => (r.row.input ? [r.row.input] : [])) });
  };

  const failure = importer.error;
  const rejected = failure instanceof ApiError && failure.status >= 400 && failure.status < 500;
  // The API names a bad row by its position in the request; point at the line in the file instead.
  const failureTitle = (() => {
    if (!failure) return "";
    const position = /^transactions (\d+) \w+: (.+)$/.exec(failure.message);
    const row = position ? ready[Number(position[1])]?.row : undefined;
    return position && row ? `Line ${row.line}${row.input ? ` (${row.input.symbol})` : ""}: ${position[2]}` : errorMessage(failure);
  })();

  const footer =
    step === "source" ? (
      <>
        <button
          type="button"
          onClick={() => downloadFile("wealthos-transactions-template.csv", TRANSACTIONS_TEMPLATE)}
          className="mr-auto text-[13px] font-medium text-accent hover:underline"
        >
          Download template
        </button>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
      </>
    ) : step === "map" ? (
      <>
        <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("source")}>
          Choose another file
        </Button>
        <Button variant="primary" disabled={!Object.values(mapped).every(Boolean)} onClick={applyMapping}>
          Preview rows
        </Button>
      </>
    ) : (
      <>
        <Button variant="ghost" className="mr-auto" icon={<ArrowLeft className="size-4" />} onClick={() => setStep("source")} disabled={importer.isPending}>
          <span className="max-sm:hidden">Choose another file</span>
          <span className="sm:hidden">Back</span>
        </Button>
        <Button variant="primary" onClick={submit} loading={importer.isPending} disabled={!target || !ready.length || tooMany || existing.isLoading}>
          {ready.length ? `Import ${plural(ready.length, "transaction")}` : "Nothing to import"}
        </Button>
      </>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Import transactions from CSV" description={DESCRIPTIONS[step]} size={step === "preview" ? "xl" : "lg"} footer={footer}>
      {step === "source" && <SourceStep error={fileError} onText={load} />}

      {step === "map" && parsed && (
        <MapStep
          parsed={parsed}
          mapping={mapping}
          defaultType={defaultType}
          onChange={(nextMapping, nextType) => {
            setMapping(nextMapping);
            setDefaultType(nextType);
          }}
        />
      )}

      {step === "preview" && parsed && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
              <FileSpreadsheet className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="truncate">{fileName ?? "Pasted rows"}</span>
            </span>
            <Badge tone="accent">{parsed.formatName}</Badge>
            <button type="button" onClick={() => setStep("map")} className="ml-auto text-xs font-medium text-accent hover:underline">
              Change columns
            </button>
          </div>

          <div className="grid items-start gap-3 sm:grid-cols-2">
            <Field
              label="Import into"
              hint={paper.length ? "Investment portfolios only. Paper trading portfolios take simulated orders instead." : undefined}
              error={!target ? "Create an investment portfolio first, then import into it." : null}
            >
              {(props) => (
                <Select
                  {...props}
                  value={portfolioId}
                  disabled={importer.isPending || !investment.length}
                  onChange={(e) => {
                    setPortfolioId(e.target.value);
                    resetImporter();
                  }}
                >
                  {investment.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="rounded-xl bg-surface-2 px-4 py-3 ring-1 ring-line" role="status">
              <div className="text-[13px] text-muted">Rows in this file</div>
              <div className="num mt-0.5 text-base font-semibold tracking-tight text-ink">
                {existing.isLoading ? <Skeleton className="h-6 w-44" /> : `${plural(ready.length, "row")} ready, ${number(skipped)} skipped`}
              </div>
            </div>
          </div>

          {duplicates.size > 0 && (
            <div className="flex items-center justify-between gap-4 rounded-xl px-4 py-3 ring-1 ring-line">
              <label htmlFor="import-skip-duplicates" className="min-w-0 text-[13px]">
                <span className="font-medium text-ink">Skip {plural(duplicates.size, "row")} already in {target?.name ?? "this portfolio"}</span>
                <span className="mt-0.5 block leading-relaxed text-muted">
                  They match an existing transaction on date, symbol, type, quantity and price. Turn this off if they are separate trades.
                </span>
              </label>
              <Switch
                id="import-skip-duplicates"
                label="Skip rows already in this portfolio"
                checked={skipDuplicates}
                onChange={(value) => {
                  setSkipDuplicates(value);
                  resetImporter();
                }}
              />
            </div>
          )}

          {tooMany && (
            <Notice tone="warn" title={`${number(ready.length)} rows is more than one import can take`}>
              Up to {number(MAX_IMPORT_ROWS)} rows can be imported at a time. Split the file, for example by year, and import the parts in date order.
            </Notice>
          )}

          {failure && (
            <Notice tone="loss" title={failureTitle}>
              {rejected
                ? /sell more/i.test(failure.message)
                  ? "Nothing was imported. A sell needs buys of the same stock dated on or before it, either in this file or already in the portfolio."
                  : "Nothing was imported. Fix the file or choose another portfolio, then import again."
                : "The import may not have gone through. Check the ledger before importing again."}
            </Notice>
          )}

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <Segmented<View>
                label="Rows to show"
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: "all", label: `All ${number(rows.length)}` },
                  { value: "ready", label: `Ready ${number(ready.length)}` },
                  { value: "skipped", label: `Skipped ${number(skipped)}` },
                ]}
              />
              {shown.length > PREVIEW_ROWS && (
                <span className="text-xs text-muted">Showing the first {PREVIEW_ROWS} of {number(shown.length)}</span>
              )}
            </div>
            {shown.length ? (
              <PreviewTable rows={shown.slice(0, PREVIEW_ROWS)} />
            ) : (
              <div className="flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-8 text-[13px] text-muted">
                {view === "skipped" ? (
                  <>
                    <Check className="size-4 text-gain" aria-hidden /> Every row passed the checks.
                  </>
                ) : (
                  "No rows in this file can be imported."
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
