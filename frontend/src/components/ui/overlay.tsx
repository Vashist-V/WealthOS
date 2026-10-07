import { X } from "lucide-react";
import { Dialog as RDialog, DropdownMenu as RMenu, Popover as RPopover, Tooltip as RTooltip } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./controls";

const WIDTHS = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" } as const;

// The hands-on guide's card floats outside any dialog, and pressing it is not clicking away from one.
// On a touch screen a dialog only asks at the click, by which time the button pressed may have left
// the page, so the press itself is remembered.
let guidePressedAt = -Infinity;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target instanceof Element && e.target.closest("[data-tour-ui]")) guidePressedAt = performance.now();
    },
    true,
  );
}
const pressedGuide = (): boolean => performance.now() - guidePressedAt < 1000;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: keyof typeof WIDTHS;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <RDialog.Content
          aria-describedby={description ? undefined : undefined}
          onInteractOutside={(e) => pressedGuide() && e.preventDefault()}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[min(90dvh,820px)] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-2xl border border-line-strong bg-surface shadow-pop outline-none data-[state=open]:animate-pop",
            WIDTHS[size],
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <RDialog.Title className="text-base font-semibold tracking-tight text-ink">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-0.5 text-[13px] text-muted">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close className="-mr-1.5 -mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <X className="size-4" />
            </RDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">{footer}</footer>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-ink-2">{description}</p>
    </Dialog>
  );
}

const POP = "z-50 rounded-xl border border-line-strong bg-surface p-1 shadow-pop outline-none data-[state=open]:animate-pop";

export function Menu({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content align={align} sideOffset={6} className={cn(POP, "min-w-48", className)}>
          {children}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  disabled,
  trailing,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <RMenu.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] outline-none transition-colors",
        "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-surface-2",
        danger ? "text-loss" : "text-ink",
        "[&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted",
        danger && "[&>svg]:text-loss",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {trailing}
    </RMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">{children}</RMenu.Label>;
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px bg-line" />;
}

export function Popover({
  trigger,
  children,
  align = "start",
  className,
  open,
  onOpenChange,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <RPopover.Root open={open} onOpenChange={onOpenChange}>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content align={align} sideOffset={6} className={cn(POP, "p-0", className)}>
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export const TooltipProvider = RTooltip.Provider;

/** Hover help for a term or icon. Keep the content to a sentence or two. */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-64 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-xs leading-relaxed text-ink-2 shadow-pop data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
