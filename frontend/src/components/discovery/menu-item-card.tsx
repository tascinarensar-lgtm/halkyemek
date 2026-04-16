"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { PendingButton } from "@/components/ui/pending-button";
import { addCartItem } from "@/features/cart/api";
import type { CartDetail } from "@/features/cart/types";
import { getMenuItemDisplayDescription, getMenuItemDisplayImage, getMenuItemDisplayName } from "@/features/discovery/menu-copy";
import type { MenuItemSummary } from "@/features/discovery/types";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, getApiErrorMessage } from "@/lib/api/errors";

export function MenuItemCard({ item, businessId, cart }: { item: MenuItemSummary; businessId: number; cart?: CartDetail }) {
  const session = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const cartBelongsToOtherBusiness = Boolean(cart && cart.item_count > 0 && cart.business !== businessId);
  const nextPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const itemName = getMenuItemDisplayName(item);
  const itemDescription = getMenuItemDisplayDescription(item);
  const itemImage = getMenuItemDisplayImage(item);

  const mutation = useMutation({
    mutationFn: () => addCartItem({ menu_item_id: item.id, quantity: 1 }),
    onSuccess: async (nextCart) => {
      queryClient.setQueryData(["cart", "detail"], nextCart);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
      ]);
      toast.success(`${itemName} sepete eklendi.`);
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.envelope?.error?.code === "NOTIFICATION_NOT_READY") {
        toast.error("Sepet işlemleri için önce bildirim kurulumu tamamlanmalı.");
        return;
      }
      toast.error(getApiErrorMessage(error, "Ürün sepete eklenemedi."));
    },
  });

  function handleAdd() {
    if (cartBelongsToOtherBusiness) {
      toast.error("Aktif sepetin başka bir işletmeye ait. Önce mevcut sepeti temizle ya da tamamla.");
      return;
    }
    mutation.mutate();
  }

  return (
    <Card className="overflow-hidden border-stone-200 bg-white">
      <div className="grid gap-0 md:grid-cols-[180px_1fr]">
        <div className="aspect-[4/3] bg-zinc-100 md:aspect-auto">
          {itemImage ? (
            <img src={itemImage} alt={itemName} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-zinc-400">Ürün görseli yok</div>
          )}
        </div>
        <CardContent className="flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-950">{itemName}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{itemDescription}</p>
              </div>
              <span className="whitespace-nowrap text-sm font-semibold text-zinc-950">
                <AmountText amount={item.price_amount} />
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className={`rounded-full px-2.5 py-1 text-xs ${item.is_available ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"}`}>
              {item.is_available ? "Müsait" : "Şu an kapalı"}
            </span>
            {session.data?.isAuthenticated ? (
              <PendingButton
                type="button"
                onClick={handleAdd}
                pending={mutation.isPending}
                pendingText="Ekleniyor..."
                disabled={!item.is_available}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-3 py-2 text-sm font-medium text-white"
              >
                <Plus className="h-4 w-4" />
                {cartBelongsToOtherBusiness ? "Önce sepeti aç" : "Sepete ekle"}
              </PendingButton>
            ) : (
              <Link href={`/giris?next=${encodeURIComponent(nextPath || `/isletmeler/${businessId}/menu`)}`} className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-3 py-2 text-sm font-medium text-white">
                <Plus className="h-4 w-4" /> Giriş yapıp ekle
              </Link>
            )}
          </div>
          {cartBelongsToOtherBusiness ? (
            <p className="text-xs text-amber-700">Aktif sepet başka bir işletmeye ait. Aynı anda tek işletme sepeti desteklenir.</p>
          ) : null}
        </CardContent>
      </div>
    </Card>
  );
}
