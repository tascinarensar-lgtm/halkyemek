import { formatCurrency } from "@/lib/utils/format";

export function AmountText({ amount, currency = "TRY" }: { amount: number; currency?: string }) {
  return <span className="font-medium">{formatCurrency(amount, currency)}</span>;
}
