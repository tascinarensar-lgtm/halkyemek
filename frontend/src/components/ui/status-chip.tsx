import { Badge, type BadgeTone } from "@/components/ui/Badge";

export function StatusChip({ label, tone = "default" }: { label: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneMap: Record<"default" | "success" | "warning" | "danger", BadgeTone> = {
    default: "neutral",
    success: "success",
    warning: "warning",
    danger: "error",
  };

  return <Badge tone={toneMap[tone]}>{label}</Badge>;
}
