import { ReactNode } from "react";

export function SectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-zinc-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-2 text-sm text-zinc-600">{description}</p> : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </div>
  );
}
