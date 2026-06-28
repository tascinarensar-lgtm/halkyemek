"use client";

import { Receipt } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";

type CartTotalsCardProps = {
  itemCount: number;
  totalPayableAmount: number;
  currency: string;
};

export function CartTotalsCard({
  itemCount,
  totalPayableAmount,
  currency,
}: CartTotalsCardProps) {
  return (
    <Card className="border-stone-200 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <Receipt className="h-4 w-4" /> Sipariş özeti
          </div>
          <p className="text-sm text-zinc-600">Ödeme öncesi toplam görünüm</p>
        </div>

        <div className="space-y-2.5 text-sm text-zinc-700">
          <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-3.5 py-2.5">
            <span>Ürün adedi</span>
            <span className="font-medium text-zinc-950">{itemCount}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-zinc-950 px-3.5 py-3 text-sm font-semibold text-white">
            <span>Ödenecek tutar</span>
            <AmountText amount={totalPayableAmount} currency={currency} />
          </div>
        </div>

        <div className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          Cüzdanla ödemeden sonra QR kodun oluşur ve kasada okutularak tüketim tamamlanır.
        </div>
      </CardContent>
    </Card>
  );
}
