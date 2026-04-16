"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CreditCard, QrCode, ShieldCheck, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ActiveCheckoutSessionCard } from "@/components/checkout/active-checkout-session-card";
import { NotificationReadinessBanner } from "@/components/notifications/readiness-banner";
import { NotificationReadinessSummaryCard } from "@/components/notifications/readiness-summary-card";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PendingButton } from "@/components/ui/pending-button";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { createCheckoutSession, getCheckoutPreview, getLatestCheckoutSession } from "@/features/cart/api";
import { getNotificationReadiness } from "@/features/notifications/api";
import { isNotificationReadinessError } from "@/lib/api/errors";
import { describeApiError, isConflictError, isNotFoundError } from "@/lib/api/presentation";
import { repairPotentialMojibake } from "@/lib/utils/text";

export default function CheckoutPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const readinessQuery = useQuery({ queryKey: ["notifications", "readiness"], queryFn: getNotificationReadiness, retry: 0 });
  const previewQuery = useQuery({ queryKey: ["cart", "checkout-preview"], queryFn: getCheckoutPreview, retry: 0 });
  const previewMissingCart = previewQuery.isError && isNotFoundError(previewQuery.error);
  const latestSessionQuery = useQuery({
    queryKey: ["checkout-session", "latest"],
    queryFn: getLatestCheckoutSession,
    retry: 0,
    enabled: previewMissingCart,
  });

  const checkoutMutation = useMutation({
    mutationFn: createCheckoutSession,
    onSuccess: async (session) => {
      queryClient.setQueryData(["checkout-session", session.token], session);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart", "detail"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
      ]);
      toast.success("Ödeme adımın hazırlandı.");
      router.push(`/checkout/${session.token}`);
      router.refresh();
    },
    onError: (error) => {
      if (isConflictError(error)) {
        toast.error(describeApiError(error, "Ödeme hazırlığı zaten başlatılmış olabilir. Lütfen birkaç saniye sonra tekrar deneyin."));
        return;
      }
      toast.error(describeApiError(error, "Ödeme adımı başlatılamadı."));
    },
  });

  const readinessBlocked =
    readinessQuery.data?.notification_ready === false ||
    isNotificationReadinessError(previewQuery.error) ||
    isNotificationReadinessError(checkoutMutation.error);

  if (readinessQuery.isPending || previewQuery.isPending) {
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

  if (previewMissingCart) {
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
            title="Ödeme ve QR hazırlığı"
            description="Bu sipariş için QR kodun zaten hazırlanmış durumda. Kaldığın yerden aynı akıştan devam edebilirsin."
            actions={<Link href="/sepet" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">Sepetime dön</Link>}
          />
          <ActiveCheckoutSessionCard
            session={latestSessionQuery.data}
            title="Önceki ödeme adımın hâlâ aktif"
            description="Ödeme özetin ve teslim kodun hazır olduğu için yeni bir işlem başlatmadık. Dilersen doğrudan QR ekranına dönerek devam edebilirsin."
            primaryHref={`/checkout/${latestSessionQuery.data.token}`}
            primaryLabel="QR ekranına dön"
            secondaryHref="/sepet"
            secondaryLabel="Sepet içeriğini gör"
          />
        </PageContainer>
      );
    }

    return (
      <PageContainer className="space-y-6">
        <SectionHeader
          title="Ödeme ve QR hazırlığı"
          description="Sepetindeki ürünleri onayladıktan sonra ödeme adımına geçer ve kasada okutacağın QR kodunu oluşturursun."
          actions={<Link href="/sepet" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">Sepetime dön</Link>}
        />
        <NotificationReadinessBanner readiness={readinessQuery.data} />
        <EmptyState title="Sepetinde onaylanacak ürün yok" description="Ödemeye geçebilmek için önce menülerden ürün eklemeli ve sepetini oluşturmalısın." />
        <div className="flex flex-wrap gap-3">
          <Link href="/sepet" className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Sepetime dön
          </Link>
          <Link href="/isletmeler" className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            İşletmeleri incele
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <NotificationReadinessSummaryCard readiness={readinessQuery.data} />
      </PageContainer>
    );
  }

  if (previewQuery.isError && isNotificationReadinessError(previewQuery.error)) {
    return (
      <PageContainer className="space-y-6">
        <SectionHeader
          title="Ödeme ve QR hazırlığı"
          description="Ödeme adımına geçmeden önce cihazının bildirim ve teslim akışına hazır olduğundan emin olmalısın."
          actions={<Link href="/sepet" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">Sepetime dön</Link>}
        />
        <NotificationReadinessBanner readiness={readinessQuery.data} />
        <ErrorState
          title="Bildirim ayarı tamamlanmalı"
          description="Ödemeyi başlatmadan önce cihazındaki bildirim hazırlığını tamamla. Böylece QR ve sipariş süreci daha sorunsuz ilerler."
        />
        <NotificationReadinessSummaryCard readiness={readinessQuery.data} />
      </PageContainer>
    );
  }

  if (previewQuery.isError) {
    return (
      <PageContainer className="space-y-6">
        <SectionHeader
          title="Ödeme ve QR hazırlığı"
          description="Sepetindeki ürünleri onayladıktan sonra ödeme adımına geçer ve kasada okutacağın QR kodunu oluşturursun."
          actions={<Link href="/sepet" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">Sepetime dön</Link>}
        />
        <ErrorState title="Ödeme sayfası yüklenemedi" description={describeApiError(previewQuery.error, "Ödeme bilgileri şu anda getirilemedi. Lütfen kısa bir süre sonra tekrar deneyin.")} />
      </PageContainer>
    );
  }

  const preview = previewQuery.data;
  const businessSnapshotName = repairPotentialMojibake(
    String((preview.items[0]?.menu_item_snapshot as { business_name?: string } | undefined)?.business_name || ""),
  );
  const subtotalAmount = preview.pricing?.subtotal_amount ?? preview.subtotal_amount;
  const customerFeeAmount = preview.pricing?.customer_fee_amount ?? preview.customer_fee_amount;
  const totalPayableAmount = preview.pricing?.total_payable_amount ?? preview.total_amount;

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Ödeme ve QR hazırlığı"
        description="Sepetindeki ürünleri son kez kontrol et, ödemeni tamamla ve kasada okutacağın QR kodunu tek adımda hazırla."
        actions={<Link href="/sepet" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">Sepetime dön</Link>}
      />

      <NotificationReadinessBanner readiness={readinessQuery.data} />

      {preview.item_count === 0 ? (
        <>
          <EmptyState title="Sepetinde ürün görünmüyor" description="Ödeme adımına geçmeden önce menülerden ürün seçip sepetine eklemen gerekiyor." />
          <div className="flex flex-wrap gap-3">
            <Link href="/sepet" className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
              Sepetime dön
            </Link>
            <Link href="/isletmeler" className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
              Menüleri incele
              <ArrowRight className="h-4 w-4" />
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
                      <Store className="h-3.5 w-3.5" /> Ödeme için hazır sipariş
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
                        {businessSnapshotName || "Seçtiğin işletmenin siparişi"}
                      </h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                        Burada tüm ürünlerini ve toplam tutarını son kez görürsün. Ödemeyi tamamladıktan sonra kasada okutacağın QR kodun hazırlanır.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ürün adedi</div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">{preview.item_count}</div>
                    </div>
                    <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ödenecek tutar</div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">
                        <AmountText amount={totalPayableAmount} currency={preview.currency} />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-stone-200 bg-zinc-950 text-white">
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <QrCode className="h-4 w-4" /> Sonraki adımlar
                </div>
                <div className="space-y-4 text-sm text-zinc-200">
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">1</span>
                    <p>Ödemeni onayladıktan sonra siparişin için özel QR kodun hazırlanır.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">2</span>
                    <p>Kasada bu QR kodu göstererek siparişini hızlıca doğrulatırsın.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">3</span>
                    <p>Onay sonrası yemeğini beklemeden teslim alma akışına geçersin.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-stone-200">
              <CardContent className="space-y-5 p-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 text-zinc-700" />
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-950">Siparişindeki ürünler</h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">
                      Ödeme öncesinde seçtiğin menüleri ve adetlerini burada son kez kontrol edebilirsin.
                    </p>
                  </div>
                </div>
                <div className="space-y-3">
                  {preview.items.map((item) => (
                    <div key={`${item.cart_item_id}-${item.menu_item_id}`} className="rounded-2xl bg-zinc-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-zinc-950">{repairPotentialMojibake(item.name)}</p>
                          <p className="mt-1 text-sm text-zinc-500">{item.quantity} adet</p>
                        </div>
                        <div className="text-sm font-medium text-zinc-900">
                          <AmountText amount={item.line_total_amount} currency={preview.currency} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card className="border-stone-200">
                <CardContent className="space-y-5 p-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                      <CreditCard className="h-4 w-4" /> Ödeme özeti
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Şimdi ödeyeceğin tutar</h2>
                    <p className="text-sm leading-6 text-zinc-600">
                      Toplam tutarı burada net şekilde görür, ardından güvenli biçimde ödeme adımını başlatırsın.
                    </p>
                  </div>

                  <div className="space-y-3 text-sm text-zinc-700">
                    <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                      <span>Menülerin toplamı</span>
                      <AmountText amount={subtotalAmount} currency={preview.currency} />
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                      <span>İşlem ve hizmet payı</span>
                      <AmountText amount={customerFeeAmount} currency={preview.currency} />
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white">
                      <span>Toplam ödeme</span>
                      <AmountText amount={totalPayableAmount} currency={preview.currency} />
                    </div>
                  </div>

                  <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                    Ödemen tamamlandığında kasada okutacağın QR kodun hazırlanır. Böylece siparişini daha hızlı ve düzenli şekilde teslim alabilirsin.
                  </div>

                  <PendingButton
                    type="button"
                    onClick={() => checkoutMutation.mutate()}
                    pending={checkoutMutation.isPending}
                    pendingText="Ödeme hazırlanıyor..."
                    disabled={readinessBlocked || preview.item_count === 0}
                    className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Ödemeyi tamamla ve QR hazırla
                  </PendingButton>

                  {readinessBlocked ? (
                    <p className="text-sm leading-6 text-amber-700">
                      Ödemeye geçmeden önce bildirim ayarını tamamlaman gerekiyor. Hazırlık tamamlandığında bu adımı tekrar başlatabilirsin.
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <NotificationReadinessSummaryCard readiness={readinessQuery.data} />
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
