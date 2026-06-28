import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--hy-radius-md)] border border-dashed border-[var(--hy-color-neutral-200)] bg-white p-6 text-center shadow-[var(--hy-shadow-soft)] sm:p-8",
        className,
      )}
    >
      <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-[var(--hy-color-primary-50)] ring-8 ring-[var(--hy-color-primary-100)]" />
      <h2 className="text-lg font-bold text-[var(--hy-color-neutral-950)]">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--hy-color-neutral-500)]">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
