import { cn } from "@/lib/utils/cn";

export function LoadingSkeleton({
  className,
  lines = 3,
}: {
  className?: string;
  lines?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-white p-5 shadow-[var(--hy-shadow-soft)]",
        className,
      )}
      aria-busy="true"
      aria-label="İçerik yükleniyor"
    >
      <div className="h-4 w-28 animate-pulse rounded-full bg-[var(--hy-color-neutral-200)]" />
      <div className="mt-5 space-y-3">
        {Array.from({ length: lines }).map((_, index) => (
          <div
            key={index}
            className={cn(
              "h-3 animate-pulse rounded-full bg-[var(--hy-color-neutral-200)]",
              index === lines - 1 ? "w-2/3" : "w-full",
            )}
          />
        ))}
      </div>
    </div>
  );
}
