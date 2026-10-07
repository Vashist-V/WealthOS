/** The backtest strategy as the builder edits it, and its translation to and from the API's config. */
import { number, pct } from "@/lib/format";
import type { Comparator, Operand, OperandType, Rule, RuleGroup, StrategyConfig } from "@/lib/types";

export const MAX_RULES = 8;

const WITH_PERIOD: ReadonlySet<OperandType> = new Set<OperandType>(["SMA", "EMA", "RSI", "HIGH", "LOW", "VOLUME_SMA", "BB_UPPER", "BB_LOWER"]);
const WITH_MULT: ReadonlySet<OperandType> = new Set<OperandType>(["BB_UPPER", "BB_LOWER"]);
const DEFAULT_PERIOD: Partial<Record<OperandType, string>> = {
  SMA: "20", EMA: "20", RSI: "14", HIGH: "55", LOW: "20", VOLUME_SMA: "20", BB_UPPER: "20", BB_LOWER: "20",
};

export const needsPeriod = (type: OperandType) => WITH_PERIOD.has(type);
export const needsMult = (type: OperandType) => WITH_MULT.has(type);
export const needsValue = (type: OperandType) => type === "VALUE";

export const COMPARATOR_LABEL: Record<Comparator, string> = {
  crosses_above: "crosses above",
  crosses_below: "crosses below",
  greater_than: "is greater than",
  less_than: "is less than",
};

/** Form fields are strings so a half-typed number never snaps to something else. */
export interface OperandDraft {
  type: OperandType;
  period: string;
  value: string;
  mult: string;
}

export interface RuleDraft {
  key: string;
  left: OperandDraft;
  cmp: Comparator;
  right: OperandDraft;
}

export interface GroupDraft {
  op: "AND" | "OR";
  rules: RuleDraft[];
}

export interface StrategyDraft {
  entry: GroupDraft;
  exit: GroupDraft;
  stopLoss: string;
  takeProfit: string;
  trailingStop: string;
  positionPct: string;
  feePct: string;
}

/** The proposal's example: buy when the 20-day average crosses above the 50-day, sell on the cross back. */
export const DEFAULT_PRESET = "golden_cross";
export const DEFAULT_NAME = "20 / 50 DMA crossover";
export const DEFAULT_CONFIG: StrategyConfig = {
  entry: { op: "AND", rules: [{ left: { type: "SMA", period: 20 }, cmp: "crosses_above", right: { type: "SMA", period: 50 } }] },
  exit: { op: "OR", rules: [{ left: { type: "SMA", period: 20 }, cmp: "crosses_below", right: { type: "SMA", period: 50 } }] },
};

let sequence = 0;
const nextKey = () => `rule-${++sequence}`;
const text = (v: number | null | undefined) => (v == null ? "" : String(v));

function operandDraft(operand: Operand): OperandDraft {
  return {
    type: operand.type,
    period: operand.period != null ? String(operand.period) : (DEFAULT_PERIOD[operand.type] ?? "20"),
    value: operand.value != null ? String(operand.value) : "30",
    mult: operand.mult != null ? String(operand.mult) : "2",
  };
}

/** Switch an operand to another indicator, giving it that indicator's usual period. */
export function withType(operand: OperandDraft, type: OperandType): OperandDraft {
  return { ...operand, type, period: DEFAULT_PERIOD[type] ?? operand.period };
}

export function newRule(): RuleDraft {
  return { key: nextKey(), left: operandDraft({ type: "PRICE" }), cmp: "crosses_above", right: operandDraft({ type: "SMA", period: 50 }) };
}

function groupDraft(group: RuleGroup | undefined, fallback: "AND" | "OR"): GroupDraft {
  return {
    op: group?.op === "AND" || group?.op === "OR" ? group.op : fallback,
    rules: (group?.rules ?? []).map((r) => ({ key: nextKey(), left: operandDraft(r.left), cmp: r.cmp, right: operandDraft(r.right) })),
  };
}

export function toDraft(config: StrategyConfig): StrategyDraft {
  return {
    entry: groupDraft(config.entry, "AND"),
    exit: groupDraft(config.exit, "OR"),
    stopLoss: text(config.stop_loss_pct),
    takeProfit: text(config.take_profit_pct),
    trailingStop: text(config.trailing_stop_pct),
    positionPct: text(config.position_pct ?? 100),
    feePct: text(config.fee_pct ?? 0),
  };
}

const parse = (s: string): number | null => {
  if (s.trim() === "") return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
};

function toOperand(draft: OperandDraft, problems: Set<string>): Operand {
  const operand: Operand = { type: draft.type };
  if (needsPeriod(draft.type)) {
    const period = parse(draft.period);
    if (period === null || !Number.isInteger(period) || period < 1 || period > 400) problems.add("Indicator periods must be whole numbers from 1 to 400.");
    operand.period = period ?? NaN;
  }
  if (needsMult(draft.type)) {
    const mult = parse(draft.mult);
    if (mult === null || mult <= 0 || mult > 10) problems.add("Bollinger band widths must be above 0 and at most 10 standard deviations.");
    operand.mult = mult ?? NaN;
  }
  if (needsValue(draft.type)) {
    const value = parse(draft.value);
    if (value === null) problems.add("Enter a number for each fixed value.");
    operand.value = value ?? NaN;
  }
  return operand;
}

const sameOperand = (a: Operand, b: Operand) => a.type === b.type && a.period === b.period && a.mult === b.mult && a.value === b.value;

function toGroup(draft: GroupDraft, problems: Set<string>): RuleGroup {
  const rules: Rule[] = draft.rules.map((r) => {
    const rule = { left: toOperand(r.left, problems), cmp: r.cmp, right: toOperand(r.right, problems) };
    if (sameOperand(rule.left, rule.right)) problems.add("A rule compares an indicator with itself, so it can never trigger. Change one side.");
    return rule;
  });
  return { op: draft.op, rules };
}

function percent(textValue: string, label: string, max: number, problems: Set<string>): number | null {
  if (textValue.trim() === "") return null;
  const v = parse(textValue);
  if (v === null || v < 0 || v > max) {
    problems.add(`${label} must be between 0% and ${max}%, or blank.`);
    return null;
  }
  return v === 0 ? null : v;
}

/** The API config for a draft, plus everything that would stop it from running. */
export function toConfig(draft: StrategyDraft): { config: StrategyConfig; problems: string[] } {
  const problems = new Set<string>();
  if (!draft.entry.rules.length) problems.add("Add at least one buy rule.");
  const entry = toGroup(draft.entry, problems);
  const exit = toGroup(draft.exit, problems);
  const stop = percent(draft.stopLoss, "Stop loss", 100, problems);
  const take = percent(draft.takeProfit, "Take profit", 1000, problems);
  const trail = percent(draft.trailingStop, "Trailing stop", 100, problems);
  if (!exit.rules.length && !stop && !take && !trail) problems.add("Add a sell rule or a stop, so positions can close.");
  const position = parse(draft.positionPct);
  if (position === null || position < 1 || position > 100) problems.add("Position size must be between 1% and 100% of capital.");
  const fee = draft.feePct.trim() === "" ? 0 : parse(draft.feePct);
  if (fee === null || fee < 0 || fee > 5) problems.add("Fee must be between 0% and 5% per trade.");
  return {
    config: {
      entry,
      exit,
      stop_loss_pct: stop,
      take_profit_pct: take,
      trailing_stop_pct: trail,
      position_pct: position ?? 100,
      fee_pct: fee ?? 0,
    },
    problems: [...problems],
  };
}

const whole = (v: number | undefined) => (v == null || Number.isNaN(v) ? "?" : number(v, Number.isInteger(v) ? 0 : 2));
/** 10%, 5.5%, 0.25%: up to two decimals, none that aren't needed. */
const share = (v: number) => {
  const rounded = Number(v.toFixed(2));
  return pct(rounded, Math.min(2, (String(rounded).split(".")[1] ?? "").length));
};

/** How an operand reads inside a sentence. */
export function operandText(o: Operand): string {
  switch (o.type) {
    case "PRICE": return "the close";
    case "SMA": return `SMA ${whole(o.period)}`;
    case "EMA": return `EMA ${whole(o.period)}`;
    case "RSI": return `RSI ${whole(o.period)}`;
    case "MACD": return "MACD";
    case "MACD_SIGNAL": return "the MACD signal line";
    case "BB_UPPER": return `the upper Bollinger band (${whole(o.period)}, ${whole(o.mult)})`;
    case "BB_LOWER": return `the lower Bollinger band (${whole(o.period)}, ${whole(o.mult)})`;
    case "HIGH": return `the ${whole(o.period)}-day high`;
    case "LOW": return `the ${whole(o.period)}-day low`;
    case "VOLUME": return "volume";
    case "VOLUME_SMA": return `the ${whole(o.period)}-day average volume`;
    case "VALUE": return whole(o.value);
  }
}

function groupText(group: RuleGroup): string {
  return group.rules.map((r) => `${operandText(r.left)} ${COMPARATOR_LABEL[r.cmp]} ${operandText(r.right)}`).join(group.op === "AND" ? " and " : " or ");
}

/** "Buy when SMA 20 crosses above SMA 50. Sell when SMA 20 crosses below SMA 50." */
export function describeStrategy(config: StrategyConfig): string {
  const sentences: string[] = [];
  sentences.push(config.entry.rules.length ? `Buy when ${groupText(config.entry)}.` : "No buy rule yet.");
  const stops = [
    config.stop_loss_pct ? `a stop loss of ${share(config.stop_loss_pct)}` : null,
    config.take_profit_pct ? `a take profit of ${share(config.take_profit_pct)}` : null,
    config.trailing_stop_pct ? `a trailing stop of ${share(config.trailing_stop_pct)}` : null,
  ].filter((s): s is string => s !== null);
  const stopText = stops.length > 1 ? `${stops.slice(0, -1).join(", ")} or ${stops[stops.length - 1]}` : stops[0];
  if (config.exit.rules.length) {
    sentences.push(`Sell when ${groupText(config.exit)}.`);
    if (stops.length) sentences.push(`Also sell on ${stopText}.`);
  } else if (stops.length) {
    sentences.push(`Sell only on ${stopText}.`);
  } else {
    sentences.push("No sell rule yet.");
  }
  const position = config.position_pct ?? 100;
  const fee = config.fee_pct ?? 0;
  if (position < 100 || fee > 0) {
    const sizing = position < 100 ? `Each buy uses ${share(position)} of available cash` : "Each buy uses all available cash";
    sentences.push(fee > 0 ? `${sizing}, with a fee of ${share(fee)} on every buy and sell.` : `${sizing}.`);
  }
  return sentences.join(" ");
}
