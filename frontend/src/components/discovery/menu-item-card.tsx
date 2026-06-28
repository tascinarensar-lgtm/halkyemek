"use client";

import Image from "next/image";
import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, ShoppingBag, Sparkles, X } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { PendingButton } from "@/components/ui/pending-button";
import { addCartItem } from "@/features/cart/api";
import type { CartDetail } from "@/features/cart/types";
import { getMenuItemDisplayDescription, getMenuItemDisplayImage, getMenuItemDisplayName } from "@/features/discovery/menu-copy";
import { getMenuQuotaDisplayText, getMenuQuotaDisplayTone } from "@/features/discovery/quota-copy";
import type { MenuItemSummary } from "@/features/discovery/types";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, getApiErrorMessage } from "@/lib/api/errors";
import { openLoginDrawer } from "@/lib/auth/login-drawer";

function getQuotaBadgeClass(item: MenuItemSummary) {
  const tone = getMenuQuotaDisplayTone(item);
  if (tone === "sold_out") {
    return "bg-zinc-950 text-white ring-1 ring-white/20";
  }
  if (tone === "low") {
    return "bg-[#f50555] text-white";
  }
  return "bg-white/95 text-zinc-900 ring-1 ring-zinc-200";
}

export function MenuItemCard({ item, businessId, cart }: { item: MenuItemSummary; businessId: number; cart?: CartDetail }) {
  const [isDetailOpen, setDetailOpen] = useState(false);
  const session = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const cartBelongsToOtherBusiness = Boolean(cart && cart.item_count > 0 && cart.business !== businessId);
  const nextPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const itemName = getMenuItemDisplayName(item);
  const itemDescription = getMenuItemDisplayDescription(item);
  const itemImage = getMenuItemDisplayImage(item);
  const quotaLabel = getMenuQuotaDisplayText(item);
  const canAddToCart = item.can_add_to_cart && item.is_available;
  const quotaBadgeClass = getQuotaBadgeClass(item);

  const mutation = useMutation({
    mutationFn: (nextQuantity: number) => addCartItem({ menu_item_id: item.id, quantity: nextQuantity }),
    onSuccess: async (nextCart) => {
      queryClient.setQueryData(["cart", "detail"], nextCart);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
      ]);
      toast.success("Sepete eklendi.", { description: itemName });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.envelope?.error?.code === "NOTIFICATION_NOT_READY") {
        toast.error("Bildirim izni gerekiyor.", { description: "Sepete devam etmek için bildirim ayarını tamamlayın." });
        return;
      }
      toast.error(getApiErrorMessage(error, "Ürün sepete eklenemedi."));
    },
  });

  useEffect(() => {
    if (!isDetailOpen) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailOpen(false);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDetailOpen]);

  function handleAdd(nextQuantity = 1) {
    if (!canAddToCart) return;
    mutation.mutate(nextQuantity);
  }

  function handleCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setDetailOpen(true);
    }
  }

  return (
    <>
      <Card className={`overflow-hidden border-stone-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md ${item.is_sold_out ? "opacity-75" : ""}`}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setDetailOpen(true)}
          onKeyDown={handleCardKeyDown}
          className="grid cursor-pointer gap-0 outline-none ring-[#f50555]/20 transition focus-visible:ring-4 sm:grid-cols-[160px_1fr] lg:grid-cols-[180px_1fr]"
        >
          <div className="relative aspect-[4/3] bg-zinc-100 sm:aspect-auto">
            {itemImage ? (
              <Image
                src={itemImage}
                alt={itemName}
                fill
                unoptimized
                sizes="(max-width: 640px) 100vw, 180px"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-1 bg-[linear-gradient(145deg,_#fafaf9,_#f4f4f5)] px-4 text-center">
                <span className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-400">HalkYemek</span>
                <p className="text-sm text-zinc-500">Ürün görseli eklenmemiş</p>
              </div>
            )}
            {quotaLabel ? (
              <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${quotaBadgeClass}`}>
                {quotaLabel}
              </span>
            ) : null}
          </div>
          <CardContent className="flex flex-col justify-between gap-3.5 p-4 sm:p-5">
            <div className="space-y-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-2.5">
                  <h3 className="text-lg font-semibold leading-6 tracking-tight text-zinc-950">{itemName}</h3>
                  {itemDescription ? <p className="line-clamp-2 text-sm leading-6 text-zinc-600">{itemDescription}</p> : null}
                  {item.minimum_grams ? (
                    <span className="inline-flex rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-semibold text-zinc-700">
                      Min. {item.minimum_grams} gr
                    </span>
                  ) : null}
                </div>
                <div className="shrink-0 rounded-xl bg-orange-50/80 px-3 py-2.5 text-left ring-1 ring-orange-100 sm:min-w-[140px] sm:text-right">
                  <span className="whitespace-nowrap text-xl font-semibold leading-none text-zinc-950">
                    <AmountText amount={item.price_amount} />
                  </span>
                  <p className="mt-1 text-xs font-medium text-orange-700">HalkYemek özel fiyat</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-stone-200/80 pt-3.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-zinc-500">
                {item.is_sold_out
                  ? "Hepsi tükendi. Kota yenilendiğinde tekrar sepete eklenebilir."
                  : item.is_available
                    ? quotaLabel || "Sepete ekle, ödeme sonrası QR ile işletmede kullan."
                    : "Bu ürün şu anda siparişe açık görünmüyor."}
              </p>
              {session.data?.isAuthenticated ? (
                <PendingButton
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleAdd();
                  }}
                  pending={mutation.isPending}
                  pendingText="Ekleniyor..."
                  disabled={!canAddToCart}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 sm:w-auto sm:min-w-[166px]"
                >
                  <Plus className="h-4 w-4" />
                  {item.is_sold_out ? "Tükendi" : "Sepete ekle"}
                </PendingButton>
              ) : (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!canAddToCart) return;
                    openLoginDrawer(nextPath || `/isletmeler/${businessId}`);
                  }}
                  disabled={!canAddToCart}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[166px]"
                >
                  <Plus className="h-4 w-4" /> {item.is_sold_out ? "Tükendi" : "Giriş yapıp ekle"}
                </button>
              )}
            </div>

            {cartBelongsToOtherBusiness ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700 ring-1 ring-amber-100">
                Aktif sepetinde başka bir işletmeden ürün olabilir. Sepetin boşsa sistem yeni işletmeye otomatik geçer.
              </p>
            ) : null}
          </CardContent>
        </div>
      </Card>

      {isDetailOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-zinc-950/58 px-0 py-0 backdrop-blur-[2px] sm:items-center sm:px-5 sm:py-8"
          role="dialog"
          aria-modal="true"
        >
          <button type="button" aria-label="Ürün detayını kapat" className="absolute inset-0 cursor-default" onClick={() => setDetailOpen(false)} />
          <div className="hy-product-modal relative z-10 flex max-h-[92dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-t-[28px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.28)] sm:max-h-[calc(100dvh-2rem)] sm:rounded-[28px]">
            <button
              type="button"
              aria-label="Ürün detayını kapat"
              onClick={() => setDetailOpen(false)}
              className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/96 text-zinc-700 shadow-[0_10px_30px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:text-[#f50555]"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="relative aspect-[16/9] max-h-[250px] shrink-0 bg-zinc-100 sm:max-h-none">
              {itemImage ? (
                <Image src={itemImage} alt={itemName} fill unoptimized sizes="(max-width: 768px) 100vw, 640px" className="object-cover" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 bg-[linear-gradient(145deg,#fafafa,#f4f4f5)] text-center">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">HalkYemek</span>
                  <p className="text-sm text-zinc-500">Ürün görseli eklenmemiş</p>
                </div>
              )}
              {quotaLabel ? (
                <span className={`absolute left-4 top-4 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ${quotaBadgeClass}`}>
                  {quotaLabel}
                </span>
              ) : null}
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-[#f50555] ring-1 ring-rose-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  HalkYemek özel fiyat
                </div>
                {quotaLabel ? (
                  <div className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${quotaBadgeClass}`}>
                    {quotaLabel}
                  </div>
                ) : null}
                <h2 className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950">{itemName}</h2>
                {item.minimum_grams ? (
                  <span className="inline-flex rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700">
                    Min. {item.minimum_grams} gr
                  </span>
                ) : null}
                <div className="flex flex-wrap items-end gap-2">
                  <span className="text-2xl font-semibold text-emerald-700">
                    <AmountText amount={item.price_amount} />
                  </span>
                  <span className="pb-1 text-sm font-medium text-zinc-500">QR ile teslim akışında geçerli</span>
                </div>
                {itemDescription ? <p className="text-sm leading-7 text-zinc-600">{itemDescription}</p> : null}
              </div>

              <div className="border-t border-zinc-100 pt-4 sm:pt-5">
                <div className="grid gap-3">
                  {session.data?.isAuthenticated ? (
                    <PendingButton
                      type="button"
                      onClick={() => handleAdd()}
                      pending={mutation.isPending}
                      pendingText="Ekleniyor..."
                      disabled={!canAddToCart}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(245,5,85,0.22)] transition hover:-translate-y-0.5 hover:bg-[#df044d] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none"
                    >
                      <ShoppingBag className="h-4 w-4" />
                      {item.is_sold_out ? "Tükendi" : "Sepete ekle"}
                    </PendingButton>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (!canAddToCart) return;
                        openLoginDrawer(nextPath || `/isletmeler/${businessId}`);
                      }}
                      disabled={!canAddToCart}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(245,5,85,0.22)] transition hover:-translate-y-0.5 hover:bg-[#df044d] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ShoppingBag className="h-4 w-4" />
                      {item.is_sold_out ? "Tükendi" : "Giriş yapıp ekle"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
