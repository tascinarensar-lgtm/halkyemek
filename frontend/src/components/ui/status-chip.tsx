import { cn } from "@/lib/utils/cn";

export function StatusChip({ label, tone = "default" }: { label: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const styles = {
    default: "bg-zinc-100 text-zinc-700",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-700",
  } as const;

  return <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", styles[tone])}>{label}</span>;
}
