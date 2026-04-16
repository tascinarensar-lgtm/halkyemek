"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Receipt, ShieldCheck, Store, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { ActiveCheckoutSessionCard } from "@/components/checkout/active-checkout-session-card";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PendingButton } from "@/components/ui/pending-button";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { clearCart, getCart, getLatestCheckoutSession, removeCartItem, updateCartItemQuantity } from "@/features/cart/api";
import { isNotificationReadinessError } from "@/lib/api/errors";
import { describeApiError, isNotFoundError } from "@/lib/api/presentation";
import { repairPotentialMojibake } from "@/lib/utils/text";

export default function CartPage() {
  const queryClient = useQueryClient();
  const cartQuery = useQuery({ queryKey: ["cart", "detail"], queryFn: getCart, retry: 0 });
  const latestSessionQuery = useQuery({
    queryKey: ["checkout-session", "latest"],
    queryFn: getLatestCheckoutSession,
    retry: 0,
    enabled: cartQuery.isError && isNotFoundError(cartQuery.error),
  });

  const syncCart = async (cart: unknown) => {
    queryClient.setQueryData(["cart", "detail"], cart);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cart"] }),
      queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
    ]);
  };

  const updateMutation = useMutation({
    mutationFn: updateCartItemQuantity,
    onSuccess: async (nextCart) => {
      await syncCart(nextCart);
    },
    onError: (error) => toast.error(describeApiError(error, "Sepetin güncellenemedi.")),
  });

  const removeMutation = useMutation({
    mutationFn: removeCartItem,
    onSuccess: async (nextCart) => {
      await syncCart(nextCart);
    },
    onError: (error) => toast.error(describeApiError(error, "Ürün sepetten çıkarılamadı.")),
  });

  const clearMutation = useMutation({
    mutationFn: clearCart,
    onSuccess: async (nextCart) => {
      await syncCart(nextCart);
    },
    onError: (error) => toast.error(describeApiError(error, "Sepet temizlenemedi.")),
  });

  if (cartQuery.isPending) {
    return (
      <PageContainer className="space-y-6">
        <LoadingSkeleton />
        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      </PageContainer>
    );
  }

  if (cartQuery.isError) {
    if (isNotificationReadinessError(cartQuery.error)) {
      return (
        <PageContainer className="space-y-6">
          <SectionHeader
            title="Sepetim"
            description="Siparişini tamamlamadan önce sepetini kontrol edebilir, ürünlerini düzenleyebilir ve ödeme hazırlığını görebilirsin."
          />
          <ErrorState
            title="Bildirim hazırlığını tamamla"
            description="Sipariş ve QR teslim sürecini sorunsuz sürdürebilmek için önce bildirim ayarlarını tamamlaman gerekiyor."
          />
          <Link href="/bildirimler" className="inline-flex w-fit items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            Bildirim ayarlarına git
            <ArrowRight className="h-4 w-4" />
          </Link>
        </PageContainer>
      );
    }

    if (isNotFoundError(cartQuery.error)) {
      if (latestSessionQuery.isPending) {
        return (
          <PageContainer className="space-y-6">
            <LoadingSkeleton />
            <LoadingSkeleton />
          </PageContainer>
        );
      }

      if (latestSessionQuery.data) {
        return (
          <PageContainer className="space-y-6">
            <SectionHeader
              title="Sepetim"
              description="Aktif sepetin şu anda QR aşamasında bekliyor. İstersen aynı siparişe kaldığın yerden devam edebilir, istersen sadece içeriğini inceleyebilirsin."
            />
            <ActiveCheckoutSessionCard
              session={latestSessionQuery.data}
              title="Bu sepet için QR kodun zaten hazır"
              description="Sepetin silinmedi; siparişin şu anda teslim kodu aşamasında bekliyor. QR ekranına dönerek aynı akıştan devam edebilirsin."
              primaryHref={`/checkout/${latestSessionQuery.data.token}`}
              primaryLabel="QR ekranına dön"
              secondaryHref="/isletmeler"
              secondaryLabel="Yeni menülere göz at"
            />
          </PageContainer>
        );
      }

      return (
        <PageContainer className="space-y-6">
          <SectionHeader
            title="Sepetim"
            description="Beğendiğin menüleri buraya ekledikten sonra ödeme öncesi tüm tutarı ve sipariş akışını tek ekranda görebilirsin."
          />
          <EmptyState title="Sepetinde henüz ürün yok" description="İşletme menülerini inceleyip sana uygun ürünleri eklediğinde siparişin burada hazır olacak." />
          <div className="flex flex-wrap gap-3">
            <Link href="/isletmeler" className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
              İşletmeleri incele
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/kategoriler" className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
              Kategorilere dön
            </Link>
          </div>
        </PageContainer>
      );
    }

    return (
      <PageContainer>
        <ErrorState title="Sepet yüklenemedi" description={describeApiError(cartQuery.error, "Sepet bilgileri şu anda getirilemedi. Lütfen kısa bir süre sonra tekrar deneyin.")} />
      </PageContainer>
    );
  }

  const cart = cartQuery.data;
  const businessSnapshotName = repairPotentialMojibake(
    String((cart.items[0]?.menu_item_snapshot as { business_name?: string } | undefined)?.business_name || ""),
  );
  const subtotalAmount = cart.pricing?.subtotal_amount ?? cart.subtotal_amount;
  const customerFeeAmount = cart.pricing?.customer_fee_amount ?? cart.customer_fee_amount;
  const totalPayableAmount = cart.pricing?.total_payable_amount ?? cart.total_amount;

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Sepetim"
        description="Seçtiğin menüleri burada gözden geçirebilir, miktarlarını düzenleyebilir ve ödeme öncesi toplam tutarı net şekilde görebilirsin."
        actions={
          <Link href="/isletmeler" className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            İşletmelere dön
          </Link>
        }
      />

      {cart.item_count === 0 ? (
        <>
          <EmptyState title="Sepetin şu anda boş görünüyor" description="Henüz ürün eklemedin. İşletme menülerine geçip sana uygun seçenekleri sepete ekleyebilirsin." />
          <div className="flex flex-wrap gap-3">
            <Link href="/isletmeler" className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
              Menüleri incele
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/kategoriler" className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
              Kategorileri aç
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
              <CardContent className="space-y-5 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                      <Store className="h-3.5 w-3.5" /> Aktif sipariş noktası
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
                        {businessSnapshotName || "Seçtiğin işletmenin menüleri"}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                        Sepetindeki ürünleri son kez gözden geçir, istersen miktarlarını düzenle ve ardından ödeme adımına geçerek QR ile teslim akışını tamamla.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Sepetteki ürün adedi</div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">{cart.item_count}</div>
                    </div>
                    <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ödenecek tutar</div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">
                        <AmountText amount={totalPayableAmount} currency={cart.currency} />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-stone-200 bg-zinc-950 text-white">
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <ShieldCheck className="h-4 w-4" /> Sipariş akışı
                </div>
                <div className="space-y-4 text-sm text-zinc-200">
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">1</span>
                    <p>Sepetindeki ürünleri ve adetlerini kontrol et.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">2</span>
                    <p>Ödeme adımına geçerek siparişini güvenle tamamla.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">3</span>
                    <p>QR kodunu kasada okut ve yemeğini hızlıca teslim al.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              {cart.items.map((item) => (
                <Card key={item.cart_item_id} className="border-stone-200">
                  <CardContent className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-3">
                      <div>
                        <h3 className="text-base font-semibold text-zinc-950">{repairPotentialMojibake(item.name)}</h3>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">
                          Dilersen ürün adedini güncelleyebilir veya sepetinden çıkarabilirsin.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm text-zinc-600">
                        <div className="rounded-full bg-zinc-100 px-3 py-1.5">
                          Birim fiyat: <AmountText amount={item.unit_price_amount} currency={cart.currency} />
                        </div>
                        <div className="rounded-full bg-zinc-100 px-3 py-1.5">
                          Bu ürün için toplam: <AmountText amount={item.line_total_amount} currency={cart.currency} />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <select
                        className="rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
                        value={item.quantity}
                        onChange={(event) => updateMutation.mutate({ itemId: item.cart_item_id, quantity: Number(event.target.value) })}
                        disabled={updateMutation.isPending || removeMutation.isPending || clearMutation.isPending}
                      >
                        {Array.from({ length: 10 }, (_, index) => index + 1).map((quantity) => (
                          <option key={quantity} value={quantity}>
                            {quantity} adet
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                        onClick={() => removeMutation.mutate(item.cart_item_id)}
                        disabled={removeMutation.isPending || updateMutation.isPending || clearMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" /> Ürünü kaldır
                      </button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card className="border-stone-200">
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                    <Receipt className="h-4 w-4" /> Sipariş özeti
                  </div>
                  <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Ödeme öncesi son görünüm</h2>
                  <p className="text-sm leading-6 text-zinc-600">
                    Bu alanda ödeyeceğin toplam tutarı görür, ardından güvenli şekilde ödeme adımına geçersin.
                  </p>
                </div>

                <div className="space-y-3 text-sm text-zinc-700">
                  <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                    <span>Sepetteki ürün adedi</span>
                    <span className="font-medium text-zinc-950">{cart.item_count}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                    <span>Menülerin toplamı</span>
                    <AmountText amount={subtotalAmount} currency={cart.currency} />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                    <span>İşlem ve hizmet payı</span>
                    <AmountText amount={customerFeeAmount} currency={cart.currency} />
                  </div>
                  <div className="flex items-center justify-between rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white">
                    <span>Şimdi ödeyeceğin tutar</span>
                    <AmountText amount={totalPayableAmount} currency={cart.currency} />
                  </div>
                </div>

                <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                  Ödemeni tamamladığında QR kodun hazırlanır. Kasada bu kodu okutarak siparişini hızlı ve kolay şekilde teslim alabilirsin.
                </div>

                <div className="grid gap-2">
                  <Link href="/checkout" className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                    Ödemeye geç
                  </Link>
                  <PendingButton
                    type="button"
                    onClick={() => clearMutation.mutate()}
                    pending={clearMutation.isPending}
                    pendingText="Sepet temizleniyor..."
                    className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                  >
                    Sepeti temizle
                  </PendingButton>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  );
}
