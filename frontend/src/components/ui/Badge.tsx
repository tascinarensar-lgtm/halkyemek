import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export type BadgeTone = "success" | "warning" | "error" | "neutral" | "primary" | "secondary";

const tones: Record<BadgeTone, string> = {
  success: "bg-[var(--hy-color-success-50)] text-[var(--hy-color-success-700)] ring-[var(--hy-color-success-100)]",
  warning: "bg-[var(--hy-color-warning-50)] text-[var(--hy-color-warning-700)] ring-[var(--hy-color-warning-100)]",
  error: "bg-[var(--hy-color-danger-50)] text-[var(--hy-color-danger-700)] ring-[var(--hy-color-danger-100)]",
  neutral: "bg-[var(--hy-color-neutral-100)] text-[var(--hy-color-neutral-700)] ring-[var(--hy-color-neutral-200)]",
  primary: "bg-[var(--hy-color-primary-50)] text-[var(--hy-color-primary-700)] ring-[var(--hy-color-primary-100)]",
  secondary: "bg-[var(--hy-color-secondary-50)] text-[var(--hy-color-secondary-700)] ring-[var(--hy-color-secondary-100)]",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
