import { ReactNode } from "react";

import { ProtectedPageShell } from "@/components/layout/protected-page-shell";

export function BusinessShell({ children }: { children: ReactNode }) {
  return <ProtectedPageShell requireBusiness>{children}</ProtectedPageShell>;
}
