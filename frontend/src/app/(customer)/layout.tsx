import { ProtectedPageShell } from "@/components/layout/protected-page-shell";

export default function CustomerAreaLayout({ children }: { children: React.ReactNode }) {
  return <ProtectedPageShell>{children}</ProtectedPageShell>;
}
