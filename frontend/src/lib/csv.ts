/**
 * CSV import and export for the transaction ledger and holdings.
 * Everything here is a pure function: no DOM, no network, no clock unless
 * `today` is left out. That keeps the parsing rules testable on their own.
 */
import Papa from "papaparse";
import { todayIso } from "./format";
import type { Holding, Transaction, TransactionInput, TxType } from "./types";

/** A field of a transaction that a CSV column can supply. */
export type CsvField = "date" | "symbol" | "type" | "quantity" | "price" | "fees" | "notes";
/** Columns the parser can use beyond the transaction fields themselves. */
export type MappedField = CsvField | "value" | "status";
/** Field → header text, exactly as it appears in `ParsedCsv.headers`. */
export type ColumnMapping = Partial<Record<MappedField, string>>;
export type CsvFormat = "zerodha" | "groww" | "generic";

export const REQUIRED_FIELDS: readonly CsvField[] = ["date", "symbol", "type", "quantity", "price"];
export const OPTIONAL_FIELDS: readonly CsvField[] = ["fees", "notes"];
export const FIELD_LABELS: Record<CsvField, string> = {
  date: "Date",
  symbol: "Symbol",
  type: "Buy or sell",
  quantity: "Quantity",
  price: "Price per share",
  fees: "Fees and charges",
  notes: "Notes",
};
export const FORMAT_NAMES: Record<CsvFormat, string> = {
  zerodha: "Zerodha tradebook",
  groww: "Groww order history",
  generic: "Generic CSV",
};

/** The API accepts at most this many rows in one import. */
export const MAX_IMPORT_ROWS = 5000;
const MAX_NOTES = 500;

export const TRANSACTIONS_TEMPLATE = [
  "date,symbol,type,quantity,price,fees,notes",
  "2025-04-07,RELIANCE,BUY,10,1265.50,12.40,First purchase",
  "2025-09-15,RELIANCE,SELL,4,1402.00,9.80,Partial exit",
  "",
].join("\r\n");

export interface ParseOptions {
  /** Overrides for the detected columns. An empty string clears a field. */
  mapping?: ColumnMapping;
  /** Applied to every row when the file has no buy/sell column. */
  defaultType?: TxType | null;
  /** Today as YYYY-MM-DD; rows dated after it are rejected. Defaults to the local date. */
  today?: string;
}

export interface ParsedRow {
  /** Line in the file, counting the first line as 1. */
  line: number;
  /** Cell text as read, for showing rows that could not be used. */
  raw: Record<CsvField, string>;
  /** The normalised transaction, or null when the row is excluded. */
  input: TransactionInput | null;
  /** Why the row is excluded. */
  error: string | null;
}

export interface ParsedCsv {
  format: CsvFormat;
  formatName: string;
  /** Column headers, made unique and non-empty so they can be used as keys. */
  headers: string[];
  mapping: ColumnMapping;
  defaultType: TxType | null;
  /** Required fields with no column. Non-empty means the user has to map columns before rows can be read. */
  missing: CsvField[];
  rows: ParsedRow[];
  /** The rows that passed validation, ready for the API. */
  valid: TransactionInput[];
  skipped: number;
  /** First data row keyed by header: example values for the mapping step. */
  sample: Record<string, string>;
  /** A problem with the file as a whole. */
  error: string | null;
}

// ---------------------------------------------------------------- cells
const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** "₹1,23,456.50", "(120.00)", "Rs. 45" → number. Null when the text is not a number. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const negative = /^\(.*\)$/.test(trimmed) || /^[-−]/.test(trimmed);
  const body = trimmed
    .replace(/₹|inr|rs\.?/gi, "")
    .replace(/[,\s]/g, "")
    .replace(/^[-−+(]+/, "")
    .replace(/\)$/, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(body)) return null;
  const value = Number(body);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * Reads YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY, DD MMM YYYY and ISO datetimes
 * (any trailing time is ignored). Numeric dates are day-first, the Indian
 * convention. Returns YYYY-MM-DD, or null when the text is not a real date.
 */
export function parseDate(text: string): string | null {
  const s = text.trim();
  let year: number, month: number, day: number;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s,].*)?$/.exec(s))) {
    [year, month, day] = [+m[1], +m[2], +m[3]];
  } else if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s,].*)?$/.exec(s))) {
    [day, month, year] = [+m[1], +m[2], +m[3]];
  } else if ((m = /^(\d{1,2})[-/\s]([A-Za-z]{3,9})\.?[-/\s,]+(\d{4})(?:[T\s,].*)?$/.exec(s))) {
    [day, month, year] = [+m[1], MONTHS[m[2].slice(0, 3).toLowerCase()] ?? 0, +m[3]];
  } else {
    return null;
  }
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return null;
  if (day > new Date(year, month, 0).getDate()) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Canonical app symbol: trimmed, upper-case, exchange prefix and NSE suffixes dropped. */
export function normaliseSymbol(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/^(NSE|BSE)\s*:\s*/, "")
    .replace(/\.NS$/, "")
    .replace(/-EQ$/, "");
}

const TYPE_WORDS: Record<string, TxType> = {
  buy: "BUY", b: "BUY", bought: "BUY", purchase: "BUY", purchased: "BUY",
  sell: "SELL", s: "SELL", sold: "SELL", sale: "SELL",
  dividend: "DIVIDEND", dividends: "DIVIDEND", div: "DIVIDEND",
};

export function parseType(text: string): TxType | null {
  return TYPE_WORDS[text.toLowerCase().replace(/[^a-z]+/g, "")] ?? null;
}

// ------------------------------------------------------------- detection
/** Header names (lower-case, punctuation removed) in order of preference. */
const SYNONYMS: Record<MappedField, string[]> = {
  date: ["date", "tradedate", "transactiondate", "txndate", "orderdate", "executiondate", "executiondateandtime", "orderexecutiontime", "tradedon", "executedon", "datetime"],
  symbol: ["symbol", "ticker", "scrip", "stock", "tradingsymbol", "stocksymbol", "scripsymbol", "instrument", "security"],
  type: ["type", "side", "action", "buysell", "tradetype", "transactiontype", "txntype", "buyorsell", "bs"],
  quantity: ["quantity", "qty", "shares", "units", "noofshares", "numberofshares", "filledqty", "filledquantity", "tradedqty", "tradequantity"],
  price: ["price", "rate", "avgprice", "averageprice", "tradeprice", "executionprice", "unitprice", "pricepershare"],
  fees: ["fees", "fee", "charges", "brokerage", "commission", "totalcharges"],
  notes: ["notes", "note", "remarks", "remark", "comment", "comments", "narration"],
  value: ["value", "amount", "tradevalue", "totalvalue", "netamount"],
  status: ["orderstatus"],
};

const ZERODHA: ColumnMapping = { date: "tradedate", symbol: "symbol", type: "tradetype", quantity: "quantity", price: "price" };
const GROWW: ColumnMapping = { date: "executiondateandtime", symbol: "symbol", type: "type", quantity: "quantity", value: "value", status: "orderstatus" };

function detectFormat(keys: string[]): CsvFormat {
  const has = (...names: string[]) => names.every((n) => keys.includes(n));
  if (has("tradedate", "tradetype", "symbol", "quantity", "price")) return "zerodha";
  if (has("symbol", "type", "quantity", "value") && (keys.includes("executiondateandtime") || keys.includes("orderstatus"))) return "groww";
  return "generic";
}

/** Field → column index for one header row. */
function autoMap(keys: string[], format: CsvFormat): Partial<Record<MappedField, number>> {
  const out: Partial<Record<MappedField, number>> = {};
  const fixed = format === "zerodha" ? ZERODHA : format === "groww" ? GROWW : null;
  (Object.keys(SYNONYMS) as MappedField[]).forEach((field) => {
    const names = fixed ? (fixed[field] ? [fixed[field]!] : []) : SYNONYMS[field];
    for (const name of names) {
      const index = keys.indexOf(name);
      if (index >= 0) {
        out[field] = index;
        return;
      }
    }
  });
  return out;
}

/** Broker exports often open with account details; the header is the first row that names enough fields. */
function findHeaderRow(rows: string[][]): number {
  const limit = Math.min(rows.length, 50);
  for (let i = 0; i < limit; i++) {
    const keys = rows[i].map(squash);
    const cols = autoMap(keys, detectFormat(keys));
    const hits = REQUIRED_FIELDS.filter((f) => cols[f] !== undefined || (f === "price" && cols.value !== undefined)).length;
    if (hits >= 3) return i;
  }
  return 0;
}

function uniqueHeaders(cells: string[]): string[] {
  const seen = new Map<string, number>();
  return cells.map((cell, i) => {
    const base = cell.trim() || `Column ${i + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

// ---------------------------------------------------------------- import
const EXECUTED = /^(executed|complete|completed|success|successful|filled|traded)$/i;
const SYMBOL = /^[A-Z0-9^][A-Z0-9&._-]{0,23}$/;

function empty(format: CsvFormat, error: string | null): ParsedCsv {
  return { format, formatName: FORMAT_NAMES[format], headers: [], mapping: {}, defaultType: null, missing: [], rows: [], valid: [], skipped: 0, sample: {}, error };
}

/**
 * Reads a transactions CSV. Recognises a Zerodha tradebook and a Groww order
 * history by their headers; any other file is matched column by column on
 * common header names. When a required column can't be found, `missing` lists
 * it and `rows` stays empty until the caller supplies a `mapping`.
 */
export function parseTransactionsCsv(text: string, options: ParseOptions = {}): ParsedCsv {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.trim()) return empty("generic", "The file is empty.");
  if (source.startsWith("PK\u0003\u0004")) return empty("generic", "This is an Excel workbook, not a CSV. Open it in Excel or Google Sheets, save it as CSV, then import that file.");

  const parsed = Papa.parse<string[]>(source, { header: false, skipEmptyLines: "greedy" });
  const table = parsed.data.filter((row) => Array.isArray(row));
  if (!table.length) return empty("generic", "No rows were found in the file.");

  const headerIndex = findHeaderRow(table);
  const keys = table[headerIndex].map(squash);
  const format = detectFormat(keys);
  const headers = uniqueHeaders(table[headerIndex]);
  const body = table.slice(headerIndex + 1);
  if (!body.length) return { ...empty(format, "The file has a header row but no transactions under it."), headers };

  // Papa drops blank lines, so recover each row's true line number for messages.
  const lines = lineNumbers(source, parsed.data.length);

  const cols = autoMap(keys, format);
  for (const [field, header] of Object.entries(options.mapping ?? {}) as [MappedField, string | undefined][]) {
    if (header === undefined) continue;
    const index = headers.indexOf(header);
    if (index >= 0) cols[field] = index;
    else delete cols[field];
  }
  const mapping: ColumnMapping = {};
  (Object.keys(cols) as MappedField[]).forEach((field) => {
    mapping[field] = headers[cols[field]!];
  });

  const defaultType = cols.type === undefined ? (options.defaultType ?? null) : null;
  const missing = REQUIRED_FIELDS.filter((field) => {
    if (cols[field] !== undefined) return false;
    if (field === "price" && cols.value !== undefined) return false;
    if (field === "type" && defaultType) return false;
    return true;
  });
  const sample = Object.fromEntries(headers.map((h, i) => [h, (body[0][i] ?? "").trim()]));
  const base = { format, formatName: FORMAT_NAMES[format], headers, mapping, defaultType, missing, sample, error: null };
  if (missing.length) return { ...base, rows: [], valid: [], skipped: 0 };

  const today = options.today ?? todayIso();
  const segment = format === "zerodha" ? keys.indexOf("segment") : -1;
  const rows = body.map((cells, i): ParsedRow => {
    const cell = (field: MappedField) => (cols[field] === undefined ? "" : (cells[cols[field]!] ?? "").trim());
    const raw: Record<CsvField, string> = {
      date: cell("date"), symbol: cell("symbol"), type: cell("type") || (defaultType ?? ""),
      quantity: cell("quantity"), price: cell("price"), fees: cell("fees"), notes: cell("notes"),
    };
    const line = lines[headerIndex + 1 + i] ?? headerIndex + 2 + i;
    const fail = (error: string): ParsedRow => ({ line, raw, input: null, error });

    const status = cell("status");
    if (format === "groww" && status && !EXECUTED.test(status)) return fail(`Order was not executed (${status.toLowerCase()})`);
    const seg = segment >= 0 ? (cells[segment] ?? "").trim().toUpperCase() : "";
    if (seg && seg !== "EQ") return fail(`Not an equity trade (segment ${seg})`);

    if (!raw.symbol) return fail("No symbol");
    const symbol = normaliseSymbol(raw.symbol);
    if (!SYMBOL.test(symbol)) return fail(`“${raw.symbol}” is not an exchange symbol`);

    const type = cols.type === undefined ? defaultType : parseType(raw.type);
    if (!type) return fail(raw.type ? `Type “${raw.type}” is not buy, sell or dividend` : "No buy or sell type");

    if (!raw.date) return fail("No date");
    const date = parseDate(raw.date);
    if (!date) return fail(`Date “${raw.date}” is not a recognised date`);
    if (date > today) return fail("Date is in the future");

    const qty = parseNumber(raw.quantity);
    if (qty === null) return fail(raw.quantity ? `Quantity “${raw.quantity}” is not a number` : "No quantity");
    // Some exports sign sells negative; the type already says which way the trade went.
    const quantity = type === "SELL" ? Math.abs(qty) : qty;
    if (!(quantity > 0)) return fail("Quantity must be above zero");

    let price: number | null;
    if (cols.price !== undefined) {
      price = parseNumber(raw.price);
      if (price === null) return fail(raw.price ? `Price “${raw.price}” is not a number` : "No price");
    } else {
      const value = parseNumber(cell("value"));
      if (value === null) return fail("No trade value to work the price out from");
      price = Math.round((Math.abs(value) / quantity) * 10000) / 10000;
      raw.price = String(price);
    }
    if (price < 0) return fail("Price can't be negative");

    let fees = 0;
    if (raw.fees) {
      const parsedFees = parseNumber(raw.fees);
      if (parsedFees === null) return fail(`Fees “${raw.fees}” is not a number`);
      fees = Math.abs(parsedFees);
    }

    // Undo the apostrophe a spreadsheet-safe export puts before a leading =, +, - or @.
    const notes = raw.notes.replace(/^'(?=[=+\-@])/, "").slice(0, MAX_NOTES);
    return { line, raw, error: null, input: { symbol, transaction_type: type, quantity, price, fees, transaction_date: date, notes } };
  });

  const valid = rows.flatMap((r) => (r.input ? [r.input] : []));
  return { ...base, rows, valid, skipped: rows.length - valid.length };
}

/** Line number (1-based) of each non-blank record, so row messages point at the real line in the file. */
function lineNumbers(source: string, count: number): number[] {
  const out: number[] = [];
  const physical = source.split(/\r\n|\n|\r/);
  let quoted = false;
  let start = 1;
  let content = false;
  physical.forEach((text, i) => {
    if (!quoted) {
      start = i + 1;
      content = false;
    }
    if (text.replace(/[\s,;|\t"]/g, "")) content = true;
    // An odd number of quotes means a quoted cell runs on to the next line.
    if ((text.match(/"/g)?.length ?? 0) % 2 === 1) quoted = !quoted;
    if (!quoted && content) out.push(start);
  });
  // If the count disagrees (unusual delimiters or quoting), fall back to simple numbering.
  return out.length === count ? out : [];
}

const key = (t: { transaction_date: string; symbol: string; transaction_type: TxType; quantity: number; price: number }) =>
  `${t.transaction_date}|${t.symbol}|${t.transaction_type}|${t.quantity.toFixed(4)}|${t.price.toFixed(4)}`;

/**
 * Lines of valid rows that match a transaction already in the ledger (same
 * date, symbol, type, quantity and price). Matching is by count, so three
 * identical fills in the file against one in the ledger flags only one.
 */
export function findDuplicateLines(rows: ParsedRow[], existing: Pick<Transaction, "transaction_date" | "symbol" | "transaction_type" | "quantity" | "price">[]): Set<number> {
  const available = new Map<string, number>();
  existing.forEach((t) => {
    const k = key({ ...t, transaction_date: t.transaction_date.slice(0, 10) });
    available.set(k, (available.get(k) ?? 0) + 1);
  });
  const out = new Set<number>();
  rows.forEach((row) => {
    if (!row.input) return;
    const k = key(row.input);
    const left = available.get(k) ?? 0;
    if (left > 0) {
      available.set(k, left - 1);
      out.add(row.line);
    }
  });
  return out;
}

// ---------------------------------------------------------------- export
const round = (value: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

const UNPARSE = { newline: "\r\n", escapeFormulae: true } as const;

/**
 * The ledger as CSV, oldest first. Quantity and price are the figures as
 * entered (before any split restatement), so the file imports back unchanged.
 */
export function transactionsToCsv(transactions: Transaction[], options: { portfolio?: boolean } = {}): string {
  const fields = ["date", "symbol", "name", "type", "quantity", "price", "fees", "amount", "notes", ...(options.portfolio ? ["portfolio"] : [])];
  const ordered = [...transactions].sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.created_at.localeCompare(b.created_at));
  const data = ordered.map((t) => [
    t.transaction_date.slice(0, 10), t.symbol, t.name, t.transaction_type, t.quantity, t.price, t.fees, t.amount, t.notes ?? "",
    ...(options.portfolio ? [t.portfolio_name ?? ""] : []),
  ]);
  return `${Papa.unparse({ fields, data }, UNPARSE)}\r\n`;
}

export function holdingsToCsv(holdings: Holding[]): string {
  const fields = [
    "symbol", "name", "asset_class", "sector", "industry", "quantity", "avg_cost", "invested", "price", "value",
    "unrealised_pnl", "unrealised_pnl_pct", "day_change_pct", "day_pnl", "weight_pct", "first_buy", "holding_days",
  ];
  const data = holdings.map((h) => [
    h.symbol, h.name, h.asset_class, h.sector, h.industry, round(h.quantity, 4), round(h.avg_cost), round(h.invested), round(h.price), round(h.value),
    round(h.pnl), round(h.pnl_pct), round(h.day_change_pct), round(h.day_pnl), round(h.weight), h.first_buy ?? "", Math.round(h.holding_days),
  ]);
  return `${Papa.unparse({ fields, data }, UNPARSE)}\r\n`;
}
