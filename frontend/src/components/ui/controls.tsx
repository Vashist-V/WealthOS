import { Loader2 } from "lucide-react";
import { Switch as RSwitch } from "radix-ui";
import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:text-ink hover:bg-surface-2",
  danger: "bg-loss-soft text-loss hover:bg-loss hover:text-white",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-sm gap-2 rounded-[10px]",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-xl",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium transition-colors duration-150",
        "disabled:opacity-50",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(
  function IconButton({ label, active, className, children, type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-2 transition-colors",
          "hover:bg-surface-2 hover:text-ink disabled:opacity-40",
          active && "bg-surface-2 text-ink",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

/** Label, control and optional hint or error, wired together for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
  tour,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
  className?: string;
  /** Name the hands-on guide points at this field by. */
  tour?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  return (
    <div data-tour={tour} className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": hint || error ? noteId : undefined })}
      {(error || hint) && (
        <p id={noteId} className={cn("text-xs", error ? "text-loss" : "text-muted")}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  "w-full rounded-[10px] border border-line-strong bg-surface text-ink placeholder:text-muted transition-colors " +
  "hover:border-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-soft " +
  "disabled:opacity-50 aria-[invalid=true]:border-loss";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  prefix?: string;
  suffix?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ prefix, suffix, className, ...rest }, ref) {
  if (!prefix && !suffix) return <input ref={ref} className={cn(CONTROL, "h-9 px-3 text-sm", className)} {...rest} />;
  return (
    <div className="relative">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">{prefix}</span>}
      <input ref={ref} className={cn(CONTROL, "h-9 text-sm num", prefix ? "pl-7" : "pl-3", suffix ? "pr-9" : "pr-3", className)} {...rest} />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted">{suffix}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 3, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(CONTROL, "resize-y px-3 py-2 text-sm leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        CONTROL,
        "h-9 appearance-none bg-no-repeat pl-3 pr-8 text-sm",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%237d8493%22 stroke-width=%222.5%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[position:right_0.7rem_center]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});

export function Switch({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-5 w-9 shrink-0 rounded-full bg-surface-3 outline-none ring-1 ring-inset ring-line-strong transition-colors disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=checked]:ring-transparent"
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[18px]" />
    </RSwitch.Root>
  );
}

/** A compact set of mutually exclusive options: ranges, modes, views. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  size = "md",
  label,
  className,
  tour,
}: {
  options: readonly (V | { value: V; label: ReactNode })[];
  value: V;
  onChange: (value: V) => void;
  size?: "sm" | "md";
  label?: string;
  className?: string;
  /** Name the hands-on guide points at this control by. */
  tour?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-tour={tour} className={cn("inline-flex rounded-[10px] bg-surface-2 p-0.5 ring-1 ring-inset ring-line", className)}>
      {options.map((option) => {
        const opt = typeof option === "string" ? { value: option, label: option } : option;
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "rounded-lg font-medium transition-colors",
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-[13px]",
              selected ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
