import { ReactNode } from "react";

import { ProtectedPageShell } from "@/components/layout/protected-page-shell";

export function OpsShell({ children }: { children: ReactNode }) {
  return <ProtectedPageShell requireAdmin>{children}</ProtectedPageShell>;
}
