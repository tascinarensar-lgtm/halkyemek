import Link from "next/link";
import { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

const base = "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition";

export function ButtonLink({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary" | "ghost"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        base,
        variant === "primary" && "bg-zinc-950 text-white hover:bg-zinc-800",
        variant === "secondary" && "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
        variant === "ghost" && "bg-transparent text-zinc-700 hover:bg-zinc-100",
        className,
      )}
    >
      {children}
    </Link>
  );
}
