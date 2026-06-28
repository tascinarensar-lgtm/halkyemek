"use client";

import { X } from "lucide-react";

import { CartCtaSection } from "@/components/cart/cart-cta-section";
import { CartItemsList } from "@/components/cart/cart-items-list";
import { CartTotalsCard } from "@/components/cart/cart-totals-card";
import type { CartDetail, CartItemSnapshot } from "@/features/cart/types";

type MobileCartSheetProps = {
  isOpen: boolean;
  cart: CartDetail;
  isPending: boolean;
  clearPending: boolean;
  onClose: () => void;
  onSelectQuantity: (item: CartItemSnapshot, quantity: number) => void;
  onDecrease: (item: CartItemSnapshot) => void;
  onIncrease: (item: CartItemSnapshot) => void;
  onRemove: (item: CartItemSnapshot) => void;
  onClear: () => void;
  onSelectItem?: (item: CartItemSnapshot) => void;
};

export function MobileCartSheet({
  isOpen,
  cart,
  isPending,
  clearPending,
  onClose,
  onSelectQuantity,
  onDecrease,
  onIncrease,
  onRemove,
  onClear,
  onSelectItem,
}: MobileCartSheetProps) {
  if (!isOpen) {
    return null;
  }

  const totalPayableAmount = cart.pricing?.total_payable_amount ?? cart.total_amount;

  return (
    <div className="fixed inset-0 z-40 lg:hidden" aria-modal="true" role="dialog">
      <button type="button" aria-label="Sepeti kapat" className="absolute inset-0 bg-zinc-950/45" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-hidden rounded-t-[28px] bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Sepetim</h2>
            <p className="text-sm text-zinc-500">Ürünlerini kontrol et, ödemeye geç.</p>
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 text-zinc-700"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(90dvh-80px)] space-y-4 overflow-y-auto overscroll-contain p-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
          <CartItemsList
            cart={cart}
            isPending={isPending}
            onSelectQuantity={onSelectQuantity}
            onDecrease={onDecrease}
            onIncrease={onIncrease}
            onRemove={onRemove}
            onSelectItem={onSelectItem}
          />
          <CartTotalsCard
            itemCount={cart.item_count}
            totalPayableAmount={totalPayableAmount}
            currency={cart.currency}
          />
          <CartCtaSection checkoutHref="/checkout" clearPending={clearPending} onClear={onClear} />
        </div>
      </div>
    </div>
  );
}
