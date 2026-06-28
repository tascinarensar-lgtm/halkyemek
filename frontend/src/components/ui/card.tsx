import { ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type CardVariant = "surface" | "soft" | "accent" | "flat";

export function Card({
  children,
  className,
  variant = "surface",
}: {
  children: ReactNode;
  className?: string;
  variant?: CardVariant;
}) {
  const variants: Record<CardVariant, string> = {
    surface: "hy-surface rounded-[var(--hy-radius-md)]",
    soft: "rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] shadow-sm",
    accent: "hy-food-gradient rounded-[var(--hy-radius-lg)] border border-[var(--hy-color-primary-100)] shadow-[var(--hy-shadow-soft)]",
    flat: "rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-white shadow-sm",
  };

  return <div className={cn(variants[variant], className)}>{children}</div>;
}

export function CardContent({
  children,
  className,
  padding = "md",
}: {
  children: ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg" | "none";
}) {
  const paddingClass = {
    none: "",
    sm: "p-4 sm:p-5",
    md: "p-5 sm:p-6",
    lg: "p-6 sm:p-8",
  } as const;

  return <div className={cn(paddingClass[padding], className)}>{children}</div>;
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("border-b border-[var(--hy-color-neutral-200)] px-5 py-4", className)}>{children}</div>;
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("text-lg font-bold tracking-tight text-[var(--hy-color-neutral-950)]", className)}>{children}</h2>;
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-1 text-sm leading-6 text-[var(--hy-color-neutral-500)]", className)}>{children}</p>;
}
