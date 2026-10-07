import { Plus, Trash2 } from "lucide-react";
import { Button, Field, IconButton, Input, Segmented, Select } from "@/components/ui";
import type { BacktestMeta, Comparator, OperandType } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  COMPARATOR_LABEL, MAX_RULES, needsMult, needsPeriod, needsValue, newRule, withType,
  type GroupDraft, type OperandDraft, type RuleDraft, type StrategyDraft,
} from "./strategy";

function OperandEditor({
  operand,
  onChange,
  operands,
  side,
  className,
}: {
  operand: OperandDraft;
  onChange: (next: OperandDraft) => void;
  operands: BacktestMeta["operands"];
  side: "Left" | "Right";
  className?: string;
}) {
  const field = (key: "period" | "value" | "mult") => ({
    type: "number" as const,
    value: operand[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...operand, [key]: e.target.value }),
  });
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>
      <Select
        aria-label={`${side} side of the rule`}
        value={operand.type}
        onChange={(e) => onChange(withType(operand, e.target.value as OperandType))}
        className="min-w-[9.5rem] flex-1"
      >
        {(Object.entries(operands) as [OperandType, string][]).map(([type, label]) => (
          <option key={type} value={type}>{label}</option>
        ))}
      </Select>
      {needsPeriod(operand.type) && (
        <div className="w-20 shrink-0">
          <Input {...field("period")} aria-label="Period in days" title="Period in days" inputMode="numeric" min="1" max="400" step="1" suffix="d" />
        </div>
      )}
      {needsMult(operand.type) && (
        <div className="w-[76px] shrink-0">
          <Input {...field("mult")} aria-label="Band width in standard deviations" title="Band width in standard deviations" inputMode="decimal" min="0" step="any" suffix="σ" />
        </div>
      )}
      {needsValue(operand.type) && (
        <div className="w-24 shrink-0">
          <Input {...field("value")} aria-label="Fixed value" title="Fixed value" inputMode="decimal" step="any" className="num" />
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onChange,
  onRemove,
  meta,
}: {
  rule: RuleDraft;
  onChange: (next: RuleDraft) => void;
  onRemove: () => void;
  meta: BacktestMeta;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-surface-2/60 p-2 ring-1 ring-inset ring-line @3xl:grid-cols-[minmax(0,1fr)_10.5rem_minmax(0,1fr)_auto]">
      <OperandEditor side="Left" operand={rule.left} operands={meta.operands} onChange={(left) => onChange({ ...rule, left })} />
      <IconButton label="Remove rule" className="@3xl:order-last" onClick={onRemove}>
        <Trash2 className="size-4" />
      </IconButton>
      <Select aria-label="Comparison" className="col-span-2 @3xl:col-span-1" value={rule.cmp} onChange={(e) => onChange({ ...rule, cmp: e.target.value as Comparator })}>
        {meta.comparators.map((cmp) => (
          <option key={cmp} value={cmp}>{COMPARATOR_LABEL[cmp] ?? cmp}</option>
        ))}
      </Select>
      <OperandEditor side="Right" className="col-span-2 @3xl:col-span-1" operand={rule.right} operands={meta.operands} onChange={(right) => onChange({ ...rule, right })} />
    </div>
  );
}

function GroupEditor({
  title,
  group,
  onChange,
  meta,
  empty,
}: {
  title: string;
  group: GroupDraft;
  onChange: (next: GroupDraft) => void;
  meta: BacktestMeta;
  empty: string;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        <Segmented<"AND" | "OR">
          size="sm"
          label={`${title}: how rules combine`}
          value={group.op}
          onChange={(op) => onChange({ ...group, op })}
          options={[{ value: "AND", label: "All" }, { value: "OR", label: "Any" }]}
        />
        <span className="text-xs text-muted">{group.op === "AND" ? "of these rules are true on the same day" : "of these rules is true"}</span>
      </div>
      <div className="@container flex flex-col gap-2">
        {group.rules.map((rule) => (
          <RuleRow
            key={rule.key}
            rule={rule}
            meta={meta}
            onChange={(next) => onChange({ ...group, rules: group.rules.map((r) => (r.key === rule.key ? next : r)) })}
            onRemove={() => onChange({ ...group, rules: group.rules.filter((r) => r.key !== rule.key) })}
          />
        ))}
        {!group.rules.length && <p className="rounded-xl border border-dashed border-line-strong px-3 py-3 text-xs leading-relaxed text-muted">{empty}</p>}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="-ml-1 mt-1.5"
        icon={<Plus className="size-3.5" />}
        disabled={group.rules.length >= MAX_RULES}
        onClick={() => onChange({ ...group, rules: [...group.rules, newRule()] })}
      >
        Add rule
      </Button>
    </section>
  );
}

/** Rule groups for buying and selling, plus the stops and sizing that apply to every trade. */
export function StrategyBuilder({ draft, onChange, meta }: { draft: StrategyDraft; onChange: (next: StrategyDraft) => void; meta: BacktestMeta }) {
  const percent = (key: "stopLoss" | "takeProfit" | "trailingStop" | "positionPct" | "feePct") => ({
    type: "number" as const,
    inputMode: "decimal" as const,
    min: "0",
    step: "any",
    suffix: "%",
    value: draft[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: e.target.value }),
  });
  return (
    <div className="flex flex-col gap-5">
      <GroupEditor title="Buy when" group={draft.entry} meta={meta} onChange={(entry) => onChange({ ...draft, entry })} empty="No buy rule yet. Add one: without it the strategy never enters a trade." />
      <GroupEditor
        title="Sell when"
        group={draft.exit}
        meta={meta}
        onChange={(exit) => onChange({ ...draft, exit })}
        empty="No sell rule. Positions will close only on a stop loss, take profit or trailing stop set below."
      />
      <section aria-label="Risk controls" className="border-t border-line pt-4">
        <h3 className="mb-3 text-sm font-semibold text-ink">Risk controls</h3>
        <div className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 xl:grid-cols-5">
          <Field label="Stop loss" hint="Sell when the close is this far below the entry price. Blank for none.">
            {(props) => <Input {...props} {...percent("stopLoss")} max="100" placeholder="None" />}
          </Field>
          <Field label="Take profit" hint="Sell when the close is this far above the entry price. Blank for none.">
            {(props) => <Input {...props} {...percent("takeProfit")} max="1000" placeholder="None" />}
          </Field>
          <Field label="Trailing stop" hint="Sell when the close is this far below its highest close since entry.">
            {(props) => <Input {...props} {...percent("trailingStop")} max="100" placeholder="None" />}
          </Field>
          <Field label="Position size" hint="Share of the available capital put into each buy.">
            {(props) => <Input {...props} {...percent("positionPct")} min="1" max="100" />}
          </Field>
          <Field label="Fee per trade" hint="Charged on the value of every buy and every sell.">
            {(props) => <Input {...props} {...percent("feePct")} max="5" placeholder="0" />}
          </Field>
        </div>
      </section>
    </div>
  );
}
