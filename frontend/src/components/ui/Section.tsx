import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function Section({
  children,
  className,
  spacing = "md",
}: {
  children: ReactNode;
  className?: string;
  spacing?: "sm" | "md" | "lg";
}) {
  const spacingClass = {
    sm: "py-4 sm:py-5",
    md: "py-6 sm:py-7",
    lg: "py-8 sm:py-10",
  } as const;

  return <section className={cn(spacingClass[spacing], className)}>{children}</section>;
}

export function SectionTitle({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="max-w-2xl">
        {eyebrow ? <p className="mb-2 text-xs font-bold uppercase tracking-[0.18em] text-[var(--hy-color-primary-700)]">{eyebrow}</p> : null}
        <h2 className="text-2xl font-bold tracking-tight text-[var(--hy-color-neutral-950)]">{title}</h2>
        {description ? <p className="mt-2 text-sm leading-6 text-[var(--hy-color-neutral-500)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
