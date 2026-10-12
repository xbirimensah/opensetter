"use client";

/**
 * Small controls shared by the flow editor and list. They use the app's
 * tokens (surface, border, accent, ...) so they read as native OpenSetter.
 *
 * Motion: press feedback is instant on pointer-down (active:scale), every
 * other transition is a short, critically damped ease with no overshoot,
 * and globals.css collapses it all under prefers-reduced-motion.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";

/** The app's shared text field (app/globals.css .field): 16px on phones stops iOS zoom. */
export const FIELD_CLASS = "field min-w-0";

/** Critically damped curve (no overshoot) used for every non-press transition. */
export const EASE = "ease-[cubic-bezier(0.25,1,0.5,1)]";

/** Pointer-down feedback, applied to anything pressable. */
export const PRESS =
  "transition-[background-color,border-color,color,opacity,scale] duration-150 ease-out active:scale-[0.97] active:duration-75 motion-reduce:active:scale-100";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

/** Variants map onto the shared capsule buttons in app/globals.css (.btn-*). */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-quiet",
  danger: "btn-danger",
  success: "border-success/30 text-success hover:bg-success/10",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type={type}
      className={`btn shrink-0 ${size === "sm" ? "btn-sm" : ""} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className = "",
  tone = "default",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: "default" | "danger" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted disabled:pointer-events-none disabled:opacity-40 sm:min-h-8 sm:min-w-8 ${
        tone === "danger" ? "hover:bg-error/10 hover:text-error" : "hover:bg-surface-hover hover:text-foreground"
      } ${PRESS} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/** Small uppercase label, positive tracking because it is tiny. */
export function FieldLabel({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[11px] font-semibold uppercase tracking-wide text-faint">
        {children}
      </label>
      {hint}
    </div>
  );
}

export function Counter({ used, max }: { used: number; max: number }) {
  const tone = used > max ? "text-error" : used > max * 0.9 ? "text-warning" : "text-faint";
  return (
    <span className={`text-[11px] tabular-nums ${tone}`} aria-live="polite">
      {used}/{max}
    </span>
  );
}

interface TextFieldProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  /** Shows a live counter against this limit (does not truncate). */
  max?: number;
  /** Hard cap the browser enforces. */
  hardMax?: number;
  multiline?: boolean;
  rows?: number;
  /** Tokens offered by the insert-variable menu. */
  variables?: string[];
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
  mono?: boolean;
  invalid?: boolean;
  className?: string;
  onBlur?: () => void;
  autoFocus?: boolean;
  /** Autocomplete options (single-line only). */
  suggestions?: string[];
}

/** Text input or textarea with an optional counter and variable inserter. */
export function TextField({
  value,
  onChange,
  label,
  placeholder,
  max,
  hardMax,
  multiline,
  rows = 3,
  variables,
  inputMode,
  type = "text",
  mono,
  invalid,
  className = "",
  onBlur,
  autoFocus,
  suggestions,
}: TextFieldProps) {
  const id = useId();
  const listId = `${id}-options`;
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function insert(token: string) {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    setMenuOpen(false);
    // Put the caret after the token once React has written the new value.
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const caret = token.endsWith(".}}") ? start + token.length - 2 : start + token.length;
      el.setSelectionRange(caret, caret);
    });
  }

  const classes = `${FIELD_CLASS} ${mono ? "font-mono text-sm sm:text-xs" : ""} ${
    invalid ? "border-error/50" : ""
  } ${multiline ? "resize-y" : ""}`;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {(label || max !== undefined || variables) && (
        <div className="flex items-center justify-between gap-2">
          {label ? (
            <label htmlFor={id} className="text-[11px] font-semibold uppercase tracking-wide text-faint">
              {label}
            </label>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-1">
            {variables && variables.length > 0 && (
              <Popover
                open={menuOpen}
                onOpenChange={setMenuOpen}
                align="right"
                trigger={(props) => (
                  <button
                    type="button"
                    {...props}
                    aria-label="Insert a variable"
                    title="Insert a variable"
                    className={`inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted hover:bg-surface-hover hover:text-foreground ${PRESS}`}
                  >
                    <Icon.braces className="h-3.5 w-3.5" />
                    Variable
                  </button>
                )}
              >
                <div className="max-h-64 w-56 overflow-y-auto py-1">
                  {variables.map((token) => (
                    <button
                      key={token}
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => insert(token)}
                      className="block w-full px-3 py-2 text-left font-mono text-xs text-foreground hover:bg-surface-hover"
                    >
                      {token}
                    </button>
                  ))}
                </div>
              </Popover>
            )}
            {max !== undefined && <Counter used={value.length} max={max} />}
          </div>
        </div>
      )}
      {multiline ? (
        <textarea
          id={id}
          ref={ref}
          value={value}
          rows={rows}
          placeholder={placeholder}
          maxLength={hardMax}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          className={classes}
        />
      ) : (
        <input
          id={id}
          ref={ref}
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={hardMax}
          inputMode={inputMode}
          list={suggestions && suggestions.length > 0 ? listId : undefined}
          autoCapitalize={inputMode === "url" ? "none" : undefined}
          autoCorrect={inputMode === "url" ? "off" : undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
          className={classes}
        />
      )}
      {!multiline && suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      )}
    </div>
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
  className = "",
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  suffix?: string;
  className?: string;
}) {
  const id = useId();
  // While the field is being retyped it may be empty; keep that locally so
  // the graph never holds NaN, and snap back to the stored value on blur.
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="block text-[11px] font-semibold uppercase tracking-wide text-faint">
          {label}
        </label>
      )}
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={draft ?? (Number.isFinite(value) ? String(value) : "")}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            setDraft(e.target.value);
            const next = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(next)) onChange(next);
          }}
          onBlur={() => setDraft(null)}
          className={`${FIELD_CLASS} tabular-nums`}
        />
        {suffix && <span className="shrink-0 text-sm text-muted">{suffix}</span>}
      </div>
    </div>
  );
}

export function Select({
  value,
  onChange,
  children,
  label,
  className = "",
  ariaLabel,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  label?: string;
  className?: string;
  ariaLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`min-w-0 space-y-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="block text-[11px] font-semibold uppercase tracking-wide text-faint">
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className={`${FIELD_CLASS} cursor-pointer pr-8`}
      >
        {children}
      </select>
    </div>
  );
}

export function Toggle({ on, onToggle, label, disabled }: { on: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  // The before: element pads the hit area to about 44px on touch screens.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 before:absolute before:-inset-y-2.5 before:-inset-x-1 disabled:opacity-50 sm:before:hidden ${
        on ? "bg-accent" : "bg-border-hover"
      }`}
    >
      <span
        className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${EASE} ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export function ToggleRow({
  on,
  onToggle,
  label,
  description,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{label}</p>
        {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
      </div>
      <Toggle on={on} onToggle={onToggle} label={label} />
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex max-w-full flex-wrap rounded-lg bg-fill p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={`min-h-11 rounded-md px-3 text-xs font-medium sm:min-h-7 ${PRESS} ${
            value === option.value ? "bg-segment text-foreground shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type FlowStatusPillValue = "DRAFT" | "ACTIVE" | "PAUSED";

const STATUS_STYLE: Record<FlowStatusPillValue, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-muted/15 text-muted" },
  ACTIVE: { label: "Active", className: "bg-success/10 text-success" },
  PAUSED: { label: "Paused", className: "bg-warning/10 text-warning" },
};

export function StatusPill({ status }: { status: FlowStatusPillValue }) {
  const style = STATUS_STYLE[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${style.className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {style.label}
    </span>
  );
}

/** Errors (red) and warnings (amber) shown under the element they are about. */
export function IssueList({ errors = [], warnings = [] }: { errors?: string[]; warnings?: string[] }) {
  if (errors.length === 0 && warnings.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-live="polite">
      {errors.map((message, i) => (
        <li key={`e${i}`} className="flex gap-2 rounded-lg bg-error/10 px-3 py-2 text-xs leading-relaxed text-error">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          <span className="min-w-0 break-words">{message}</span>
        </li>
      ))}
      {warnings.map((message, i) => (
        <li key={`w${i}`} className="flex gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
          <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
          <span className="min-w-0 break-words">{message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Anchored popover. It grows out of its trigger (transform-origin at the
 * trigger edge) and closes on outside press or Escape.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  children,
  align = "left",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      {trigger({ onClick: () => onOpenChange(!open), "aria-expanded": open, "aria-haspopup": "menu" })}
      {open && (
        <div
          role="menu"
          className={`absolute top-full z-40 mt-1 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-xl transition-[opacity,scale] duration-150 ${EASE} starting:scale-95 starting:opacity-0 ${
            align === "right" ? "right-0 origin-top-right" : "left-0 origin-top-left"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  icon?: React.ReactNode;
  hint?: string;
  disabled?: boolean;
  muted?: boolean;
  tone?: "default" | "danger";
}

/** Popover with a list of actions. */
export function Menu({
  items,
  trigger,
  align = "left",
  width = "w-56",
}: {
  items: MenuItem[];
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "menu" }) => React.ReactNode;
  align?: "left" | "right";
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} align={align}>
      <div className={`${width} max-w-[80vw] py-1`}>
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
            className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm disabled:pointer-events-none disabled:opacity-40 sm:py-2 ${
              item.tone === "danger" ? "text-error hover:bg-error/10" : "text-foreground hover:bg-surface-hover"
            } ${item.muted ? "opacity-60" : ""}`}
          >
            {item.icon && <span className="mt-0.5 shrink-0 text-muted">{item.icon}</span>}
            <span className="min-w-0">
              <span className="block">{item.label}</span>
              {item.hint && <span className="mt-0.5 block text-xs leading-snug text-muted">{item.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

/**
 * Expands and collapses its children with a damped height transition. The
 * clip is lifted once fully open so popovers inside are not cut off.
 */
export function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [settledOpen, setSettledOpen] = useState(open);
  const clip = !(open && settledOpen);
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-300 ${EASE} ${
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === "grid-template-rows") {
          setSettledOpen(open);
        }
      }}
      aria-hidden={!open}
      inert={!open}
    >
      <div className={`min-h-0 ${clip ? "overflow-hidden" : ""}`}>{children}</div>
    </div>
  );
}
