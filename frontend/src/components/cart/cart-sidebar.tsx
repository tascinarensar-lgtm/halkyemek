"use client";

import Link from "next/link";

import { CartCtaSection } from "@/components/cart/cart-cta-section";
import { CartItemsList } from "@/components/cart/cart-items-list";
import { CartTotalsCard } from "@/components/cart/cart-totals-card";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import type { CartDetail, CartItemSnapshot } from "@/features/cart/types";

type CartSidebarProps = {
  cart?: CartDetail;
  businessId: number;
  isAuthenticated: boolean;
  isPending: boolean;
  onSelectQuantity: (item: CartItemSnapshot, quantity: number) => void;
  onDecrease: (item: CartItemSnapshot) => void;
  onIncrease: (item: CartItemSnapshot) => void;
  onRemove: (item: CartItemSnapshot) => void;
  onClear: () => void;
  clearPending: boolean;
  onSelectItem?: (item: CartItemSnapshot) => void;
};

export function CartSidebar({
  cart,
  businessId,
  isAuthenticated,
  isPending,
  onSelectQuantity,
  onDecrease,
  onIncrease,
  onRemove,
  onClear,
  clearPending,
  onSelectItem,
}: CartSidebarProps) {
  const isSameBusiness = cart?.business === businessId;
  const hasOtherBusinessCart = Boolean(cart && cart.item_count > 0 && cart.business !== businessId);

  if (!isAuthenticated) {
    return (
      <div className="hidden lg:block lg:sticky lg:top-24">
        <Card className="border-stone-200 bg-white">
          <CardContent className="space-y-3.5 p-5">
            <h2 className="text-base font-semibold text-zinc-950">Sepet özeti</h2>
            <p className="text-sm text-zinc-600">Sepet ve ödeme için giriş yapman gerekir.</p>
            <Link href="/giris" className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
              Güvenli giriş yap
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!cart || cart.item_count === 0) {
    return (
      <div className="hidden lg:block lg:sticky lg:top-24">
        <Card className="border-stone-200 bg-white">
          <CardContent className="space-y-2.5 p-5">
            <h2 className="text-base font-semibold text-zinc-950">Sepet özeti</h2>
            <p className="text-sm text-zinc-600">Henüz ürün seçmedin. Ürünler eklendiğinde özet burada görünür.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (hasOtherBusinessCart) {
    return (
      <div className="hidden lg:block lg:sticky lg:top-24">
        <Card className="border-stone-200 bg-white">
          <CardContent className="space-y-4 p-5">
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-zinc-950">Sepetteki ürünler farklı işletmeye aittir</h2>
              <p className="text-sm text-zinc-600">Sepetteki ürünler farklı işletmeye aittir. Tek bir işletme ile sepetinizi doldurabilirsiniz.</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-700">
              <p>Ürün sayısı: {cart.item_count}</p>
              <p className="mt-1.5">Toplam: <AmountText amount={cart.total_amount} currency={cart.currency} /></p>
            </div>
            <Link href="/sepet" className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
              Aktif sepeti aç
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isSameBusiness) {
    return null;
  }

  const totalPayableAmount = cart.pricing?.total_payable_amount ?? cart.total_amount;

  return (
    <div className="hidden space-y-4 lg:block lg:sticky lg:top-24">
      <div className="max-h-[min(56vh,620px)] overflow-y-auto pr-1">
        <CartItemsList
          cart={cart}
          isPending={isPending}
          onSelectQuantity={onSelectQuantity}
          onDecrease={onDecrease}
          onIncrease={onIncrease}
          onRemove={onRemove}
          onSelectItem={onSelectItem}
        />
      </div>
      <div className="space-y-4">
        <CartTotalsCard
          itemCount={cart.item_count}
          totalPayableAmount={totalPayableAmount}
          currency={cart.currency}
        />
        <CartCtaSection checkoutHref="/checkout" clearPending={clearPending} onClear={onClear} />
      </div>
    </div>
  );
}
