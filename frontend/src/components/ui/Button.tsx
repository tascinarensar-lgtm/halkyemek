import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "hy-focus-safe inline-flex max-w-full items-center justify-center gap-2 rounded-[var(--hy-radius-sm)] text-center font-semibold leading-tight transition active:scale-[0.99] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--hy-color-primary-600)] text-white shadow-[var(--hy-shadow-soft)] hover:bg-[var(--hy-color-primary-700)]",
  secondary:
    "border border-[var(--hy-color-neutral-200)] bg-white text-[var(--hy-color-neutral-950)] shadow-sm hover:border-[var(--hy-color-primary-100)] hover:bg-[var(--hy-color-primary-50)]",
  ghost:
    "bg-transparent text-[var(--hy-color-neutral-700)] hover:bg-[var(--hy-color-neutral-100)] hover:text-[var(--hy-color-neutral-950)]",
  danger:
    "bg-[var(--hy-color-danger-700)] text-white shadow-[var(--hy-shadow-soft)] hover:bg-red-800",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 py-2 text-sm",
  md: "min-h-11 px-4 py-2.5 text-sm",
  lg: "min-h-12 px-5 py-3 text-base",
};

export function buttonClassName({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}) {
  return cn(base, variants[variant], sizes[size], fullWidth && "w-full", className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingText?: ReactNode;
  fullWidth?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  loadingText = "İşleniyor...",
  fullWidth = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, fullWidth, className })}
    >
      {loading ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          {loadingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}
