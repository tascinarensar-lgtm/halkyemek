import { ReactNode } from "react";

import { SectionTitle } from "@/components/ui/Section";

export function SectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <SectionTitle
      title={title}
      description={description}
      actions={actions}
      className="border-b border-[var(--hy-color-neutral-200)] pb-5"
    />
  );
}
