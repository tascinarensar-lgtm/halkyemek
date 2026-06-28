import { ReactNode } from "react";

import { Container } from "@/components/ui/Container";
import { cn } from "@/lib/utils/cn";

export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return <Container className={cn("py-6 sm:py-8", className)}>{children}</Container>;
}
