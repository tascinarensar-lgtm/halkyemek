import { BusinessShell } from "@/components/layout/business-shell";

export default function BusinessAreaLayout({ children }: { children: React.ReactNode }) {
  return <BusinessShell>{children}</BusinessShell>;
}
