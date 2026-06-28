"use client";

import { ShoppingBag } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Button } from "@/components/ui/Button";

type MobileCartBarProps = {
  itemCount: number;
  totalAmount: number;
  currency: string;
  onOpen: () => void;
};

export function MobileCartBar({ itemCount, totalAmount, currency, onOpen }: MobileCartBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_30px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-500">Sepetinde {itemCount} ürün var</p>
          <p className="text-sm font-semibold text-zinc-950">
            <AmountText amount={totalAmount} currency={currency} />
          </p>
        </div>
        <Button fullWidth className="max-w-[160px] shrink-0 sm:max-w-[180px]" onClick={onOpen}>
          <ShoppingBag className="h-4 w-4" />
          Sepeti aç
        </Button>
      </div>
    </div>
  );
}
