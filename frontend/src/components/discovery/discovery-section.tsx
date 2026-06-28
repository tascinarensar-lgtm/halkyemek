import { ReactNode } from "react";

import { ButtonLink } from "@/components/ui/button-link";

export function DiscoverySection({ title, description, actionHref, actionLabel, children }: { title: string; description?: string; actionHref?: string; actionLabel?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-950">{title}</h2>
          {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
        </div>
        {actionHref && actionLabel ? <ButtonLink href={actionHref} variant="ghost">{actionLabel}</ButtonLink> : null}
      </div>
      {children}
    </section>
  );
}
