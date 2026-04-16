"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, QrCode, Receipt, ShieldCheck, Store, XCircle } from "lucide-react";
import { toast } from "sonner";

import { QrCard } from "@/components/qr/qr-card";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PendingButton } from "@/components/ui/pending-button";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { cancelCheckoutSession, getCheckoutSession } from "@/features/cart/api";
import { describeApiError, isGoneError, isNotFoundError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

function formatCountdown(expiresAt: string | null, now: number) {
  if (!expiresAt) return "-";
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return "Süresi doldu";
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getStatusLabel(status: string, isExpired: boolean) {
  if (isExpired || status === "EXPIRED") return "Süresi doldu";
  if (status === "CONSUMED") return "Teslim edildi";
  if (status === "CANCELLED") return "İptal edildi";
  if (status === "CONFIRMED") return "Hazır";
  if (status === "PENDING") return "Onay bekliyor";
  return "Hazır";
}

function getStatusStyles(status: string, isExpired: boolean) {
  if (isExpired || status === "EXPIRED") return "bg-red-50 text-red-700";
  if (status === "CONSUMED") return "bg-emerald-50 text-emerald-700";
  if (status === "CANCELLED") return "bg-red-50 text-red-700";
  if (status === "CONFIRMED") return "bg-blue-50 text-blue-700";
  return "bg-zinc-100 text-zinc-700";
}

function isSessionAwaitingUse(status: string, expiresAt: string | null, now: number) {
  const isExpired = status === "EXPIRED" || (expiresAt ? new Date(expiresAt).getTime() <= now : false);
  return !isExpired && status !== "CONSUMED" && status !== "CANCELLED";
}

export default function CheckoutTokenPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useParams<{ token: string }>();
  const token = typeof params.token === "string" ? params.token.trim() : "";
  const [now, setNow] = useState(() => Date.now());
  const [isPageVisible, setIsPageVisible] = useState(true);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const checkoutQuery = useQuery({
    queryKey: ["checkout-session", token],
    queryFn: () => getCheckoutSession(token),
    enabled: Boolean(token),
    retry: 0,
    refetchInterval: (query) => {
      if (!token || !isPageVisible) return false;
      const session = query.state.data;
      if (!session) return 5_000;
      return ["CONSUMED", "EXPIRED", "CANCELLED"].includes(session.status) ? false : 5_000;
    },
    refetchIntervalInBackground: false,
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelCheckoutSession(token),
    onSuccess: async (nextSession) => {
      queryClient.setQueryData(["checkout-session", token], nextSession);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["checkout-session", token] }),
        queryClient.invalidateQueries({ queryKey: ["checkout-session", "latest"] }),
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "detail"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
      ]);
      toast.success("QR kodu iptal edildi. Sepetin yeniden açıldı.");
      router.push("/sepet");
      router.refresh();
    },
    onError: (error) => {
      toast.error(describeApiError(error, "QR kodu iptal edilemedi. Lütfen tekrar deneyin."));
    },
  });

  if (!token) {
    return (
      <PageContainer className="space-y-6">
        <SectionHeader title="QR teslim ekranı" description="Bağlantıdaki bilgi okunamadığı için teslim ekranı açılamadı." />
        <ErrorState title="Geçersiz bağlantı" description="Bu sayfayı açmak için gereken bağlantı eksik veya hatalı görünüyor." />
      </PageContainer>
    );
  }

  if (checkoutQuery.isPending) {
    return (
      <PageContainer className="space-y-6">
        <LoadingSkeleton />
        <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      </PageContainer>
    );
  }

  if (checkoutQuery.isError) {
    const title = isNotFoundError(checkoutQuery.error)
      ? "QR bağlantısı bulunamadı"
      : isGoneError(checkoutQuery.error)
        ? "Bu QR bağlantısının süresi dolmuş"
        : "QR ekranı yüklenemedi";

    return (
      <PageContainer className="space-y-6">
        <SectionHeader title="QR teslim ekranı" description="Ödeme sonrası oluşan QR kod bu ekranda görüntülenir ve kasada okutulur." />
        <ErrorState
          title={title}
          description={describeApiError(
            checkoutQuery.error,
            "Bu QR bağlantısı şu anda görüntülenemiyor. Gerekirse sepetine dönerek işlemi yeniden başlatabilirsin.",
          )}
        />
        <div className="flex flex-wrap gap-3">
          <Link href="/sepet" className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            Sepetime dön
          </Link>
          <Link href="/siparislerim" className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Siparişlerime git
          </Link>
        </div>
      </PageContainer>
    );
  }

  const session = checkoutQuery.data;
  const countdown = formatCountdown(session.expires_at, now);
  const isExpired = session.status === "EXPIRED" || countdown === "Süresi doldu";
  const isConsumed = session.status === "CONSUMED";
  const isCancelled = session.status === "CANCELLED";
  const isAwaitingUse = isSessionAwaitingUse(session.status, session.expires_at, now);
  const canPoll = isAwaitingUse && isPageVisible;
  const businessName = repairPotentialMojibake(session.business.name);
  const statusLabel = useMemo(() => getStatusLabel(session.status, isExpired), [isExpired, session.status]);
  const statusStyles = useMemo(() => getStatusStyles(session.status, isExpired), [isExpired, session.status]);

  const handleCancel = () => {
    if (!isAwaitingUse) {
      return;
    }
    const confirmed = window.confirm(
      "Bu QR kodunu iptal edersen siparişin yeniden sepetine döner ve bu kod kasada kullanılamaz. Devam etmek istiyor musun?",
    );
    if (!confirmed) {
      return;
    }
    cancelMutation.mutate();
  };

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="QR teslim ekranı"
        description="Ödemen tamamlandıktan sonra bu ekrandaki QR kodu kasada göstererek siparişini hızlıca teslim alabilirsin."
        actions={
          <Link href="/siparislerim" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Siparişlerime git
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                  <Store className="h-3.5 w-3.5" /> Teslim noktası hazır
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">{businessName}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                    QR kodun bu işletme için hazırlandı. Kasada bu ekranı göstererek siparişini hızlı şekilde doğrulatabilirsin.
                  </p>
                </div>
              </div>
              <div className={`inline-flex rounded-full px-3 py-1.5 text-sm font-medium ${statusStyles}`}>
                {statusLabel}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Kalan süre</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">{countdown}</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ürün adedi</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">{session.item_count}</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ödenen tutar</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">
                  <AmountText amount={session.total_payable_amount} currency={session.currency} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 bg-zinc-950 text-white">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <ShieldCheck className="h-4 w-4" /> Önemli bilgi
            </div>
            <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
              Bu QR kod yaklaşık 10 dakika boyunca geçerlidir. Süre sona ererse ekran geçersiz olur ve siparişini yeniden başlatman gerekebilir.
            </div>
            {isAwaitingUse ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                Fikrini değiştirirsen sürenin dolmasını beklemeden bu QR kodunu iptal edip sepetindeki ürünlere geri dönebilirsin.
              </div>
            ) : null}
            <div className="space-y-4 text-sm text-zinc-200">
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">1</span>
                <p>Kasaya geldiğinde bu ekranı aç ve QR kodunu görevliye göster.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">2</span>
                <p>QR okutulduğunda siparişin onaylanır ve teslim sürecin başlar.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">3</span>
                <p>Ekran açık kaldıkça sipariş durumunu otomatik olarak yenileyip sana gösteririz.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <QrCode className="h-4 w-4" /> Teslim kodun
            </div>

            {isAwaitingUse ? (
              <div className="flex justify-center">
                <QrCard value={session.token} />
              </div>
            ) : null}

            {session.cashier_code ? (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Kasa kodu</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-2xl font-semibold tracking-[0.28em] text-zinc-950">{session.cashier_code}</div>
                  <div className="text-sm leading-6 text-zinc-600">
                    QR açılmazsa bu kısa kodu kasiyere söyleyerek siparişini doğrulatabilirsin.
                  </div>
                </div>
              </div>
            ) : null}

            {isConsumed ? (
              <div className="rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-700">
                QR kodun işletmede okutuldu. Siparişinin son durumunu siparişlerim ekranından takip edebilirsin.
              </div>
            ) : null}

            {isExpired ? (
              <div className="rounded-2xl bg-red-50 p-4 text-sm leading-6 text-red-700">
                Bu QR kodun süresi doldu. Yeni bir sipariş için sepetine dönerek işlemi yeniden başlatabilirsin.
              </div>
            ) : null}

            {isCancelled ? (
              <div className="rounded-2xl bg-red-50 p-4 text-sm leading-6 text-red-700">
                Bu QR bağlantısı iptal edildi. Yeni bir sipariş için menülere veya sepetine dönerek işlemi yeniden başlatabilirsin.
              </div>
            ) : null}

            <div className="space-y-3 text-sm text-zinc-700">
              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                <span>Son geçerlilik zamanı</span>
                <span className="font-medium text-zinc-950">{formatDateTime(session.expires_at)}</span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                <span>Durum takibi</span>
                <span className="font-medium text-zinc-950">
                  {canPoll ? "Ekran açıkken otomatik yenileniyor" : isPageVisible ? "Takip tamamlandı" : "Sekme pasif, beklemede"}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                <span>İşletme</span>
                <span className="font-medium text-zinc-950">{businessName}</span>
              </div>
            </div>

            <div className={`grid gap-2 ${isAwaitingUse ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
              <Link href="/checkout" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Ödeme özetine dön
              </Link>
              {isAwaitingUse ? (
                <PendingButton
                  type="button"
                  onClick={handleCancel}
                  pending={cancelMutation.isPending}
                  pendingText="QR iptal ediliyor..."
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                >
                  <XCircle className="h-4 w-4" />
                  Vazgeçtim, QR kodunu iptal et
                </PendingButton>
              ) : null}
              <Link href="/siparislerim" className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Siparişlerime git
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <Receipt className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Sipariş özeti</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Kasada gösterdiğin QR kod bu sipariş özeti ile eşleşir. Ürünlerini ve ödenen toplamı burada görebilirsin.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {session.items.length > 0 ? (
                session.items.map((item, index) => (
                  <div key={`${item.menu_item_id}-${index}`} className="rounded-2xl bg-zinc-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-zinc-950">
                          {repairPotentialMojibake(item.menu_item_name || item.name || `Ürün ${item.menu_item_id}`)}
                        </p>
                        <p className="mt-1 text-sm text-zinc-500">{item.quantity} adet</p>
                      </div>
                      <div className="text-sm font-medium text-zinc-900">
                        <AmountText amount={item.line_total_amount} currency={session.currency} />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
                  Bu sipariş için ürün özeti şu anda görüntülenemiyor.
                </div>
              )}
            </div>

            <div className="space-y-3 text-sm text-zinc-700">
              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                <span>Menülerin toplamı</span>
                <AmountText amount={session.subtotal_amount} currency={session.currency} />
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                <span>İşlem ve hizmet payı</span>
                <AmountText amount={session.customer_fee_amount} currency={session.currency} />
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white">
                <span>Ödenen toplam</span>
                <AmountText amount={session.total_payable_amount} currency={session.currency} />
              </div>
            </div>

            <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  QR kodu süresi içinde okutulmazsa bu sipariş bağlantısı geçersiz hale gelir. Vazgeçersen sürenin dolmasını beklemeden bu ekrandan QR kodunu iptal edip sepetine geri dönebilirsin.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
              <div className="flex items-center gap-2 font-medium text-zinc-900">
                <Clock3 className="h-4 w-4" /> Zaman bilgisi
              </div>
              <p className="mt-2 leading-6">
                QR ekranı sana kalan süreyi anlık gösterir. Kasaya geçmeden önce bu süreyi kontrol etmen işlemini daha sorunsuz tamamlamana yardımcı olur.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
