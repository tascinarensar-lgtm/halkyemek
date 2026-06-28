"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, PackageOpen, QrCode, Store, Tag, XCircle } from "lucide-react";
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
  if (isExpired || status === "EXPIRED") return "bg-red-50 text-red-700 ring-red-100";
  if (status === "CONSUMED") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  if (status === "CANCELLED") return "bg-red-50 text-red-700 ring-red-100";
  if (status === "CONFIRMED") return "bg-rose-50 text-[#f50555] ring-rose-100";
  return "bg-zinc-100 text-zinc-700 ring-zinc-200";
}

function isSessionAwaitingUse(status: string, expiresAt: string | null, now: number) {
  const isExpired = status === "EXPIRED" || (expiresAt ? new Date(expiresAt).getTime() <= now : false);
  return !isExpired && status !== "CONSUMED" && status !== "CANCELLED";
}

function formatTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function getCheckoutItemName(item: { menu_item_id?: number | null; menu_item_name?: string; name?: string }) {
  return repairPotentialMojibake(item.menu_item_name || item.name || (item.menu_item_id ? `Ürün ${item.menu_item_id}` : "Sürpriz Paket"));
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
      const isNextSurpriseSession =
        nextSession.source_type === "SURPRISE_DEAL" || Boolean(nextSession.items.some((item) => item.source_type === "SURPRISE_DEAL"));
      queryClient.setQueryData(["checkout-session", token], nextSession);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["checkout-session", token] }),
        queryClient.invalidateQueries({ queryKey: ["checkout-session", "latest"] }),
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "detail"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
        queryClient.invalidateQueries({ queryKey: ["surprise-deals"] }),
      ]);
      toast.success("QR iptal edildi.", {
        description: isNextSurpriseSession ? "Fırsat stoğu tekrar serbest bırakıldı." : "Sepetin yeniden açıldı.",
      });
      router.push(isNextSurpriseSession ? "/halktasarruf" : "/sepet");
      router.refresh();
    },
    onError: (error) => {
      toast.error(describeApiError(error, "QR iptal edilemedi."));
    },
  });

  const session = checkoutQuery.data;
  const sessionStatus = session?.status ?? "PENDING";
  const countdown = formatCountdown(session?.expires_at ?? null, now);
  const isExpired = sessionStatus === "EXPIRED" || countdown === "Süresi doldu";
  const isConsumed = sessionStatus === "CONSUMED";
  const isCancelled = sessionStatus === "CANCELLED";
  const isAwaitingUse = session ? isSessionAwaitingUse(session.status, session.expires_at, now) : false;
  const canPoll = isAwaitingUse && isPageVisible;
  const businessName = session ? repairPotentialMojibake(session.business.name) : "";
  const isSurpriseSession = session?.source_type === "SURPRISE_DEAL" || Boolean(session?.items.some((item) => item.source_type === "SURPRISE_DEAL"));
  const primaryItem = session?.items[0] ?? null;
  const surprisePickupWindow =
    primaryItem?.pickup_window_start && primaryItem.pickup_window_end
      ? `${formatTime(primaryItem.pickup_window_start)} - ${formatTime(primaryItem.pickup_window_end)}`
      : "";
  const checkoutTitle = isSurpriseSession ? "Sürpriz paket QR kodun" : "Kasada göster";
  const checkoutDescription = isSurpriseSession
    ? `${businessName} için sürpriz paket rezervasyonun hazır. Teslim saatinde QR kodunu ya da kasa kodunu göster.`
    : `${businessName} için hazırlanan QR kodun burada. QR okunmazsa kasa kodu yeterli.`;
  const statusLabel = useMemo(() => getStatusLabel(sessionStatus, isExpired), [isExpired, sessionStatus]);
  const statusStyles = useMemo(() => getStatusStyles(sessionStatus, isExpired), [isExpired, sessionStatus]);

  if (!token) {
    return (
      <PageContainer className="space-y-5 sm:space-y-6">
        <SectionHeader title="QR doğrulama" description="Bağlantıdaki bilgi okunamadığı için teslim ekranı açılamadı." />
        <ErrorState title="Geçersiz bağlantı" description="Bu sayfayı açmak için gereken bağlantı eksik veya hatalı görünüyor." />
      </PageContainer>
    );
  }

  if (checkoutQuery.isPending) {
    return (
      <PageContainer className="space-y-5 sm:space-y-6">
        <LoadingSkeleton />
        <div className="grid gap-5 sm:gap-6 lg:grid-cols-[0.95fr_1.05fr]">
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
      <PageContainer className="space-y-5 sm:space-y-6">
        <SectionHeader title="QR doğrulama" description="Ödeme sonrası oluşan QR kod bu ekranda gösterilir ve kasada okutulur." />
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

  if (!session) {
    return (
      <PageContainer className="space-y-5 sm:space-y-6">
        <SectionHeader title="QR doğrulama" description="Teslim bilgileri şu anda görüntülenemiyor." />
        <ErrorState title="Teslim bilgisi bulunamadı" description="Bu QR kaydı için gösterilecek aktif teslim bilgisi bulunamadı." />
      </PageContainer>
    );
  }

  const handleCancel = () => {
    if (!isAwaitingUse) {
      return;
    }
    const confirmed = window.confirm(
      isSurpriseSession
        ? "Bu QR kodunu iptal edersen fırsat rezervasyonun serbest kalır ve bu kod kasada kullanılamaz. Devam etmek istiyor musun?"
        : "Bu QR kodunu iptal edersen siparişin yeniden sepetine döner ve bu kod kasada kullanılamaz. Devam etmek istiyor musun?",
    );
    if (!confirmed) {
      return;
    }
    cancelMutation.mutate();
  };

  return (
    <PageContainer className="space-y-5 bg-white sm:space-y-6">
      <section className="relative overflow-hidden rounded-[34px] bg-zinc-950 p-5 text-white shadow-[0_24px_70px_rgba(9,9,11,0.18)] sm:p-7 lg:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#f50555]/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-8 h-48 w-48 rounded-full bg-rose-300/20 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-100">
              {isSurpriseSession ? <PackageOpen className="h-3.5 w-3.5" /> : <QrCode className="h-3.5 w-3.5" />}
              {isSurpriseSession ? "Sürpriz paket" : "QR doğrulama"}
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{checkoutTitle}</h1>
              <p className="text-sm leading-6 text-zinc-300 sm:text-base">{checkoutDescription}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[460px]">
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">Durum</p>
              <p className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ${statusStyles}`}>{statusLabel}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">Kalan süre</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">{countdown}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">Toplam</p>
              <p className="mt-3 text-2xl font-semibold tracking-tight">
                <AmountText amount={session.total_payable_amount} currency={session.currency} />
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[0.94fr_1.06fr]">
        <Card className="overflow-hidden border-zinc-100 bg-zinc-950 text-white shadow-[0_18px_55px_rgba(9,9,11,0.13)]">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[#f50555]/15 text-[#ff7a9f]">
                  <QrCode className="h-4 w-4" />
                </span>
                Teslim kodun
              </div>
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-zinc-300">{session.item_count} ürün</span>
            </div>

            {isAwaitingUse ? (
              <div className="rounded-[30px] bg-white p-5 shadow-inner shadow-zinc-200/70">
                <div className="flex justify-center">
                  <QrCard value={session.token} />
                </div>
              </div>
            ) : null}

            {isConsumed ? (
              <div className="rounded-[28px] bg-emerald-50 p-5 text-sm leading-6 text-emerald-800">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <CheckCircle2 className="h-4 w-4" /> Teslim edildi
                </div>
                QR kod işletmede okutuldu. {isSurpriseSession ? "Sürpriz paket teslimin tamamlandı." : "Siparişinin son durumunu Siparişlerim ekranından takip edebilirsin."}
              </div>
            ) : null}

            {isExpired ? (
              <div className="rounded-[28px] bg-red-50 p-5 text-sm leading-6 text-red-800">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Süresi doldu
                </div>
                {isSurpriseSession ? "Bu QR artık kasada kullanılamaz. Yeni bir paket için Son Dakika Fırsatları sayfasına dönebilirsin." : "Bu QR artık kasada kullanılamaz. Yeni QR oluşturmak için sepet akışını yeniden başlatabilirsin."}
              </div>
            ) : null}

            {isCancelled ? (
              <div className="rounded-[28px] bg-red-50 p-5 text-sm leading-6 text-red-800">
                <div className="mb-2 flex items-center gap-2 font-semibold">
                  <XCircle className="h-4 w-4" /> İptal edildi
                </div>
                {isSurpriseSession ? "Bu QR bağlantısı iptal edildi. Fırsat stoğu yeniden serbest bırakıldı." : "Bu QR bağlantısı iptal edildi. Yeni sipariş için menüye veya sepetine dönebilirsin."}
              </div>
            ) : null}

            {session.cashier_code ? (
              <div className="rounded-[26px] border border-white/10 bg-white/5 p-4">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Kasa kodu</p>
                <p className="mt-2 break-all text-3xl font-semibold tracking-[0.18em] text-white">{session.cashier_code}</p>
                <p className="mt-3 text-sm leading-6 text-zinc-400">QR okunmazsa bu kodu kasiyere söylemen yeterli.</p>
              </div>
            ) : null}

            <div className={`grid gap-2 ${isAwaitingUse ? "sm:grid-cols-2" : ""}`}>
              <Link
                href="/siparislerim"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100"
              >
                Siparişlerime git
              </Link>
              {isAwaitingUse ? (
                <PendingButton
                  type="button"
                  onClick={handleCancel}
                  pending={cancelMutation.isPending}
                  pendingText="İptal ediliyor..."
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  <XCircle className="h-4 w-4" />
                  QR iptal et
                </PendingButton>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="border-zinc-100 bg-white shadow-[0_18px_50px_rgba(24,24,27,0.08)]">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f50555]">Sipariş özeti</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
                  {isSurpriseSession ? "Sürpriz paket özeti" : "Az ve net"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  {isSurpriseSession ? "Teslim saatinde işletmede doğrulanacak fırsat paketi." : "Kasada doğrulanacak sipariş ve ödenen toplam."}
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700">
                <Store className="h-4 w-4" /> {businessName}
              </div>
            </div>

            <div className="space-y-3">
              {session.items.length > 0 ? (
                session.items.map((item, index) => (
                  <div key={`${item.source_type ?? "item"}-${item.menu_item_id ?? item.surprise_deal_id ?? index}`} className="rounded-[22px] border border-zinc-100 bg-zinc-50/80 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-zinc-950">{getCheckoutItemName(item)}</p>
                        <p className="mt-1 text-sm text-zinc-500">{item.quantity} adet</p>
                        {item.source_type === "SURPRISE_DEAL" && item.pickup_window_start && item.pickup_window_end ? (
                          <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium text-[#f50555]">
                            <Clock3 className="h-3.5 w-3.5" />
                            Teslim: {formatTime(item.pickup_window_start)} - {formatTime(item.pickup_window_end)}
                          </p>
                        ) : null}
                      </div>
                      <div className="text-sm font-semibold text-zinc-900">
                        <AmountText amount={item.line_total_amount} currency={session.currency} />
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-[22px] bg-zinc-50 p-4 text-sm text-zinc-600">
                  Bu sipariş için ürün özeti şu anda görüntülenemiyor.
                </div>
              )}
            </div>

            {isSurpriseSession && primaryItem ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {primaryItem.original_value_amount ? (
                  <div className="rounded-[22px] bg-rose-50 p-4 text-rose-900">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Tag className="h-4 w-4" /> Tahmini değer
                    </div>
                    <p className="mt-2 text-lg font-semibold">
                      <AmountText amount={primaryItem.original_value_amount} currency={session.currency} />
                    </p>
                  </div>
                ) : null}
                {surprisePickupWindow ? (
                  <div className="rounded-[22px] bg-zinc-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                      <Clock3 className="h-4 w-4 text-[#f50555]" /> Teslim aralığı
                    </div>
                    <p className="mt-2 text-lg font-semibold text-zinc-950">{surprisePickupWindow}</p>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-[26px] bg-[#f50555] p-5 text-white shadow-[0_18px_45px_rgba(245,5,85,0.22)]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-white/75">Ödenen toplam</span>
                <span className="text-3xl font-semibold tracking-tight">
                  <AmountText amount={session.total_payable_amount} currency={session.currency} />
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] bg-zinc-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                  <Clock3 className="h-4 w-4 text-[#f50555]" /> Geçerlilik
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{formatDateTime(session.expires_at)}</p>
              </div>
              <div className="rounded-[22px] bg-zinc-50 p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                  <CheckCircle2 className="h-4 w-4 text-[#f50555]" /> Takip
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  {canPoll ? "Ekran açıkken otomatik yenileniyor." : isPageVisible ? "Takip tamamlandı." : "Sekme pasif, beklemede."}
                </p>
              </div>
            </div>

            <div className="rounded-[22px] border border-rose-100 bg-rose-50/70 p-4 text-sm leading-6 text-rose-900">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f50555]" />
                <p>
                  {isSurpriseSession
                    ? "QR süresi içinde okutulmazsa fırsat rezervasyonu serbest kalır. QR okunmazsa kasa kodu ile doğrulama yapılabilir."
                    : "QR süresi içinde okutulmazsa bağlantı geçersiz olur. QR okunmazsa kasa kodu ile doğrulama yapılabilir."}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
