import { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-2xl border border-zinc-200 bg-white shadow-sm", className)}>{children}</div>;
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}
