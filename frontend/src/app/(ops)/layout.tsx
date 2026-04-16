import { OpsShell } from "@/components/layout/ops-shell";

export default function OpsAreaLayout({ children }: { children: React.ReactNode }) {
  return <OpsShell>{children}</OpsShell>;
}
