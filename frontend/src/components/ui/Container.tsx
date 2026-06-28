import type { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

export function Container({
  children,
  size = "default",
  className,
}: {
  children: ReactNode;
  size?: "default" | "wide" | "narrow";
  className?: string;
}) {
  const sizes = {
    default: "max-w-6xl",
    wide: "max-w-7xl",
    narrow: "max-w-4xl",
  } as const;

  return <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-8", sizes[size], className)}>{children}</div>;
}
