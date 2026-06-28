"use client";

import Image from "next/image";
import { Trash2 } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import type { CartDetail, CartItemSnapshot } from "@/features/cart/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

type CartItemsListProps = {
  cart: CartDetail;
  isPending: boolean;
  onSelectQuantity: (item: CartItemSnapshot, quantity: number) => void;
  onDecrease: (item: CartItemSnapshot) => void;
  onIncrease: (item: CartItemSnapshot) => void;
  onRemove: (item: CartItemSnapshot) => void;
  onSelectItem?: (item: CartItemSnapshot) => void;
};

export function CartItemsList({
  cart,
  isPending,
  onSelectQuantity,
  onDecrease,
  onIncrease,
  onRemove,
  onSelectItem,
}: CartItemsListProps) {
  return (
    <div className="space-y-3.5">
      {cart.items.map((item) => {
        const imageUrl = item.menu_item_snapshot?.image_url;
        const quotaRemaining =
          typeof item.menu_item_snapshot?.quota_remaining === "number" ? item.menu_item_snapshot.quota_remaining : null;
        const quotaLabel = typeof item.menu_item_snapshot?.quota_label === "string" ? item.menu_item_snapshot.quota_label : null;
        const isSoldOut = Boolean(item.menu_item_snapshot?.is_sold_out);
        const quotaExceeded = quotaRemaining !== null && item.quantity > quotaRemaining;
        const maxSelectableQuantity = quotaRemaining === null ? 10 : Math.max(item.quantity, Math.min(10, quotaRemaining));
        return (
          <Card key={item.cart_item_id} className="border-stone-200 shadow-sm">
            <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
              <div className="flex gap-3">
                {imageUrl ? (
                  <button
                    type="button"
                    onClick={() => onSelectItem?.(item)}
                    className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-zinc-100 hover:opacity-75"
                  >
                    <Image
                      src={imageUrl}
                      alt={item.name}
                      fill
                      unoptimized
                      sizes="64px"
                      className="object-cover"
                    />
                  </button>
                ) : null}
                <div className="flex-1 space-y-2">
                  <button
                    type="button"
                    onClick={() => onSelectItem?.(item)}
                    className="text-left hover:text-[#f50555]"
                  >
                    <h3 className="text-base font-semibold text-zinc-950">{repairPotentialMojibake(item.name)}</h3>
                  </button>
                  <div className="flex flex-wrap gap-2 text-xs text-zinc-600">
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1">
                      Birim: <AmountText amount={item.unit_price_amount} currency={cart.currency} />
                    </span>
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1">
                      Tutar: <AmountText amount={item.line_total_amount} currency={cart.currency} />
                    </span>
                    {quotaLabel ? (
                      <span className={`rounded-full px-2.5 py-1 font-semibold ${isSoldOut ? "bg-zinc-950 text-white" : quotaLabel.startsWith("Son ") ? "bg-rose-50 text-[#f50555]" : "bg-zinc-100 text-zinc-700"}`}>
                        {quotaLabel}
                      </span>
                    ) : null}
                  </div>
                  {quotaExceeded ? (
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-800 ring-1 ring-amber-100">
                      Sepetteki miktar kalan kotayı aşıyor. Sepetini güncelleyip tekrar dene.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  className="rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                  value={item.quantity}
                  onChange={(event) => onSelectQuantity(item, Number(event.target.value))}
                  disabled={isPending}
                >
                  {Array.from({ length: maxSelectableQuantity }, (_, index) => index + 1).map((quantity) => (
                    <option key={quantity} value={quantity}>
                      {quantity} adet
                    </option>
                  ))}
                </select>
                <div className="inline-flex rounded-xl bg-zinc-100 p-1">
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-300"
                    onClick={() => onDecrease(item)}
                    disabled={item.quantity <= 1 || isPending}
                  >
                    -
                  </button>
                  <span className="inline-flex min-w-8 items-center justify-center text-sm font-medium text-zinc-900">{item.quantity}</span>
                  <button
                    type="button"
                    className="rounded-lg px-3 py-1 text-sm text-zinc-700 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-300"
                    onClick={() => onIncrease(item)}
                    disabled={item.quantity >= maxSelectableQuantity || isPending}
                  >
                    +
                  </button>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                  onClick={() => onRemove(item)}
                  disabled={isPending}
                >
                  <Trash2 className="h-4 w-4" /> Ürünü kaldır
                </button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
