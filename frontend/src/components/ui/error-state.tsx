import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function ErrorState({
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
        "rounded-[var(--hy-radius-md)] border border-[var(--hy-color-danger-100)] bg-[var(--hy-color-danger-50)] p-5 sm:p-6 shadow-sm",
        className,
      )}
      role="alert"
    >
      <h2 className="text-base font-bold text-[var(--hy-color-danger-700)]">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-red-700/80">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
