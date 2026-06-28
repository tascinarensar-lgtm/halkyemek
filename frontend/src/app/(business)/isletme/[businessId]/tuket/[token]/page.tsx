"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, QrCode, Receipt, Store, XCircle } from "lucide-react";
import { toast } from "sonner";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { AmountText } from "@/components/ui/amount-text";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { consumeBusinessCheckoutSession, getBusinessConsumePreview } from "@/features/business-operations/api";
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

function getPreviewErrorTitle(error: unknown) {
  const code = getApiErrorCode(error);
  if (code === "checkout_session_not_found") return "QR bilgisi bulunamadı";
  if (code === "checkout_session_expired") return "Bu QR oturumunun süresi dolmuş";
  if (code === "checkout_session_forbidden") return "Bu doğrulama için yetki görünmüyor";
  return "Doğrulama ekranı açılamadı";
}

function getFailureCopy(reason: string | null | undefined) {
  switch (reason) {
    case "already_consumed":
      return "Bu QR daha önce doğrulanmış. Mevcut sipariş kaydını açarak kontrol edebilirsin.";
    case "expired":
      return "Bu QR oturumunun süresi dolmuş. Müşterinin yeni QR oluşturması gerekir.";
    case "cancelled":
      return "Bu QR oturumu müşteri tarafından iptal edilmiş.";
    case "business_unavailable":
      return "İşletme şu anda bu doğrulamayı tamamlayacak uygun durumda görünmüyor.";
    case "wallet_missing":
    case "insufficient_balance":
      return "Müşteri cüzdanı bu işlemi tamamlayacak durumda görünmüyor.";
    case "empty_snapshot":
      return "Sipariş içeriği okunamadığı için teslim onayı kapatıldı.";
    case "invalid_status":
      return "Bu QR oturumu mevcut durumu nedeniyle doğrulanamaz.";
    default:
      return "Bu QR şu anda teslim onayı için uygun görünmüyor.";
  }
}

function getStatusPresentation(status: string, canConsume: boolean) {
  if (canConsume) {
    return {
      icon: CheckCircle2,
      label: "Onaya hazır",
      className: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      panelClassName: "border-emerald-100 bg-emerald-50/80 text-emerald-800",
    };
  }
  if (status === "CONSUMED") {
    return {
      icon: CheckCircle2,
      label: "Onaylandı",
      className: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      panelClassName: "border-emerald-100 bg-emerald-50/80 text-emerald-800",
    };
  }
  if (status === "EXPIRED" || status === "CANCELLED") {
    return {
      icon: XCircle,
      label: "Kapalı",
      className: "bg-red-50 text-red-700 ring-red-100",
      panelClassName: "border-red-100 bg-red-50/80 text-red-800",
    };
  }
  return {
    icon: AlertTriangle,
    label: "Kontrol gerekiyor",
    className: "bg-amber-50 text-amber-700 ring-amber-100",
    panelClassName: "border-amber-100 bg-amber-50/80 text-amber-800",
  };
}

export default function BusinessConsumePage() {
  const router = useRouter();
  const params = useParams<{ businessId: string; token: string }>();
  const businessId = Number(params.businessId);
  const token = params.token;
  const queryClient = useQueryClient();
  const [postConsumeSyncMessage, setPostConsumeSyncMessage] = useState<string | null>(null);
  const [showSlowConsumeNotice, setShowSlowConsumeNotice] = useState(false);

  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const hasValidToken = typeof token === "string" && token.trim().length > 0;

  const previewQuery = useQuery({
    queryKey: ["business-operations", businessId, "consume-preview", token],
    queryFn: () => getBusinessConsumePreview(businessId, token),
    enabled: hasValidBusinessId && hasValidToken,
    retry: false,
  });

  const previewQueryKey = ["business-operations", businessId, "consume-preview", token] as const;

  const consumeMutation = useMutation({
    mutationFn: (consumeToken: string) => consumeBusinessCheckoutSession(businessId, consumeToken),
    onMutate: () => {
      setPostConsumeSyncMessage(null);
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(previewQueryKey, (current: typeof previewQuery.data) =>
        current
          ? {
              ...current,
              status: data.status,
              can_consume: false,
              failure_reason: "already_consumed",
              existing_order_id: data.order_id,
            }
          : current,
      );
      queryClient.setQueryData(["business-operations", businessId, "consume-result", token], data);
      toast.success("Teslim onaylandı.", { description: "Sipariş kaydı oluşturuldu." });
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "consume-history"] }),
      ]);
      router.replace(`/isletme/${businessId}/siparisler/${data.order_id}`);
    },
    onError: async (error) => {
      const code = getApiErrorCode(error);

      if (code === "checkout_session_already_consumed") {
        const details = getApiErrorDetails(error);
        const orderId = details?.order_id;
        const normalizedOrderId = typeof orderId === "number" ? orderId : typeof orderId === "string" ? Number(orderId) : null;
        await queryClient.invalidateQueries({ queryKey: previewQueryKey });
        toast.error("QR daha önce kullanılmış.", { description: "Mevcut siparişe geçebilirsiniz." });
        if (normalizedOrderId) {
          router.replace(`/isletme/${businessId}/siparisler/${normalizedOrderId}`);
        }
        return;
      }

      if (code === "proxy_network_error" || code === "proxy_upstream_timeout" || !(error && typeof error === "object" && "status" in error)) {
        const refreshedPreview = await previewQuery.refetch();
        if (refreshedPreview.data?.existing_order_id) {
          setPostConsumeSyncMessage("İlk istek ağ hatasına düştü; tekrar sorguda mevcut sipariş bulundu. İşlem ikinci kez tetiklenmedi.");
          toast.error("Sipariş bulundu.", { description: "İşlem ikinci kez çalıştırılmadı." });
          return;
        }
        setPostConsumeSyncMessage("Ağ hatası nedeniyle son durum doğrulanamadı. Tekrar denemeden önce bilgiyi yenile.");
      }

      toast.error(getApiErrorMessage(error, "Teslim onayı tamamlanamadı."));
    },
  });

  useEffect(() => {
    if (!consumeMutation.isPending) {
      setShowSlowConsumeNotice(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowSlowConsumeNotice(true);
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [consumeMutation.isPending]);

  const preview = previewQuery.data;
  const alreadyConsumedOrderId = useMemo(() => {
    const details = getApiErrorDetails(consumeMutation.error);
    const orderId = details?.order_id;
    return typeof orderId === "number" ? orderId : typeof orderId === "string" ? Number(orderId) : null;
  }, [consumeMutation.error]);
  const successOrderId = consumeMutation.data?.order_id ?? preview?.existing_order_id ?? alreadyConsumedOrderId ?? null;
  const consumeToken = preview?.token || token;
  const canConsume = Boolean(preview?.can_consume && consumeToken) && !consumeMutation.isPending && !previewQuery.isFetching;

  const statusPresentation = preview ? getStatusPresentation(preview.status, Boolean(preview.can_consume)) : null;
  const StatusIcon = statusPresentation?.icon ?? AlertTriangle;
  const statusText = preview
    ? preview.can_consume
      ? "Sipariş doğrulandı. Ürün ve toplam doğruysa Teslimi onayla ile işlemi tamamla."
      : getFailureCopy(preview.failure_reason)
    : "";
  const items = [...(preview?.items ?? [])].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
  const businessName = preview ? repairPotentialMojibake(preview.business.name) : "";
  const currency = preview?.currency || "TRY";

  return (
    <PageContainer className="bg-white">
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-5 sm:space-y-6">
          {!hasValidBusinessId ? (
            <ErrorState title="Geçersiz işletme" description="URL içindeki işletme bilgisi okunamadı. Güvenli işlem için işletme panelinden tekrar aç." />
          ) : null}
          {hasValidBusinessId && !hasValidToken ? (
            <ErrorState title="Geçersiz doğrulama bağlantısı" description="QR veya bağlantı bilgisi eksik görünüyor. QR kodu yeniden okut veya kasa kodunu tekrar gir." />
          ) : null}

          {hasValidBusinessId && hasValidToken && previewQuery.isPending ? <LoadingSkeleton /> : null}
          {hasValidBusinessId && hasValidToken && previewQuery.isError ? (
            <>
              <SectionHeader title="Kasa doğrulama" description="QR/kısa kod doğrulama bilgisi şu anda görüntülenemiyor." />
              <ErrorState
                title={getPreviewErrorTitle(previewQuery.error)}
                description={`${getApiErrorMessage(previewQuery.error)}${getApiRequestId(previewQuery.error) ? ` · request_id: ${getApiRequestId(previewQuery.error)}` : ""}`}
              />
            </>
          ) : null}

          {preview ? (
            <>
              <section className="relative overflow-hidden rounded-[28px] bg-zinc-950 p-5 text-white shadow-[0_24px_70px_rgba(9,9,11,0.18)] sm:rounded-[34px] sm:p-7 lg:p-8">
                <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[#f50555]/30 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-24 left-8 h-48 w-48 rounded-full bg-rose-300/20 blur-3xl" />

                <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                  <div className="max-w-2xl space-y-4">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-100">
                      <QrCode className="h-3.5 w-3.5" /> Kasa doğrulama
                    </div>
                    <div className="space-y-2">
                      <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">Teslimi onayla</h1>
                      <p className="text-sm leading-6 text-zinc-300 sm:text-base">
                        {businessName} için sipariş eşleşti. Ürünleri kontrol edip teslimi onayla.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3 lg:min-w-[500px]">
                    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">Durum</p>
                      <p className={`mt-3 inline-flex rounded-full px-3 py-1 text-sm font-semibold ring-1 ${statusPresentation?.className ?? "bg-zinc-100 text-zinc-700 ring-zinc-200"}`}>
                        {statusPresentation?.label ?? "Kontrol"}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">Kasa kodu</p>
                      <p className="mt-3 break-all text-xl font-semibold tracking-[0.14em] sm:text-2xl sm:tracking-[0.18em]">{preview.cashier_code || "-"}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
                      <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-400">Toplam</p>
                      <p className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">
                        <AmountText amount={preview.total_payable_amount} currency={currency} />
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid gap-5 lg:grid-cols-[1.05fr_0.95fr]">
                <Card className="border-zinc-100 bg-white shadow-[0_18px_50px_rgba(24,24,27,0.08)]">
                  <CardContent className="space-y-5 p-5 sm:p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f50555]">Sipariş içeriği</p>
                        <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">Verilecek ürünler</h2>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">Onaydan önce ürünleri ve adetleri kontrol et.</p>
                      </div>
                      <div className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700">
                        <Receipt className="h-4 w-4" /> {preview.item_count} ürün
                      </div>
                    </div>

                    {items.length ? (
                      <div className="space-y-3">
                        {items.map((item, index) => (
                          <div key={`${item.menu_item_id}-${index}`} className="rounded-[22px] border border-zinc-100 bg-zinc-50/80 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-semibold text-zinc-950">
                                  {repairPotentialMojibake(item.menu_item_name || item.name || `Ürün ${item.menu_item_id}`)}
                                </p>
                                <p className="mt-1 text-sm text-zinc-500">
                                  {item.quantity} adet · Birim <AmountText amount={item.unit_price_amount} currency={currency} />
                                </p>
                              </div>
                              <div className="text-sm font-semibold text-zinc-900">
                                <AmountText amount={item.line_total_amount} currency={currency} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <ErrorState title="Sipariş satırları görüntülenemiyor" description="Ürün kalemleri şu anda okunamadı. Doğrulamayı tamamlamadan önce bilgiyi yenilemeyi dene." />
                    )}

                    <div className="rounded-[26px] bg-[#f50555] p-5 text-white shadow-[0_18px_45px_rgba(245,5,85,0.22)]">
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-sm font-medium text-white/75">Toplam</span>
                        <span className="text-2xl font-semibold tracking-tight sm:text-3xl">
                          <AmountText amount={preview.total_payable_amount} currency={currency} />
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden border-zinc-100 bg-zinc-950 text-white shadow-[0_18px_55px_rgba(9,9,11,0.13)]">
                  <CardContent className="space-y-5 p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[#f50555]/15 text-[#ff7a9f]">
                          <Store className="h-4 w-4" />
                        </span>
                        Onay paneli
                      </div>
                      <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-zinc-300">#{preview.checkout_session_id}</span>
                    </div>

                    <div className={`rounded-[26px] border p-5 text-sm leading-6 ${statusPresentation?.panelClassName ?? "border-white/10 bg-white/5 text-zinc-200"}`}>
                      <div className="mb-2 flex items-center gap-2 font-semibold">
                        <StatusIcon className="h-4 w-4" /> {statusPresentation?.label ?? "Kontrol gerekiyor"}
                      </div>
                      {statusText}
                    </div>

                    <div className="rounded-[26px] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-400">Kasa kodu</p>
                      <p className="mt-2 break-all text-2xl font-semibold tracking-[0.14em] text-white sm:text-3xl sm:tracking-[0.18em]">{preview.cashier_code || "-"}</p>
                      <p className="mt-3 text-sm leading-6 text-zinc-400">Müşterideki kod ile aynıysa işlem doğru QR oturumuna aittir.</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[22px] bg-white/5 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                          <Clock3 className="h-4 w-4 text-[#ff7a9f]" /> Geçerlilik
                        </div>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">{formatDateTime(preview.expires_at)}</p>
                      </div>
                      <div className="rounded-[22px] bg-white/5 p-4">
                        <div className="text-sm font-semibold text-white">Tahsilat</div>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">
                          <AmountText amount={preview.total_payable_amount} currency={currency} />
                        </p>
                      </div>
                    </div>

                    {consumeMutation.isPending ? (
                      <div className="rounded-[22px] border border-white/10 bg-white/5 p-4 text-sm leading-6 text-zinc-300">
                        <p className="font-semibold text-white">Teslim onayı işleniyor</p>
                        <p className="mt-1">
                          Cüzdan düşümü ve sipariş kaydı güvenli şekilde tamamlanıyor. Lütfen bu işlem bitene kadar sayfayı kapatma.
                        </p>
                        {showSlowConsumeNotice ? (
                          <p className="mt-2 text-zinc-400">
                            Yanıt normalden uzun sürüyor. Sistem işlemi ikinci kez tetiklemeden sonucu bekliyor; gerekirse son durumu otomatik kontrol edeceğiz.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {postConsumeSyncMessage ? (
                      <div className="rounded-[22px] bg-white/5 p-4 text-sm leading-6 text-zinc-300">{postConsumeSyncMessage}</div>
                    ) : null}

                    {successOrderId ? (
                      <div className="rounded-[24px] bg-emerald-50 p-4 text-sm text-emerald-800">
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-semibold">Teslim onayı tamamlandı</p>
                            <p className="mt-1 leading-6">Sipariş kaydı hazır. Detay sayfasından kalemleri ve tutarı inceleyebilirsin.</p>
                          </div>
                        </div>
                        <Link href={`/isletme/${businessId}/siparisler/${successOrderId}`} className="mt-4 inline-flex rounded-2xl bg-emerald-700 px-4 py-2 font-semibold text-white hover:bg-emerald-800">
                          Sipariş detayını aç
                        </Link>
                      </div>
                    ) : null}

                    {preview.existing_order_id && !successOrderId ? (
                      <div className="rounded-[22px] bg-white/5 p-4 text-sm leading-6 text-zinc-300">
                        Bu QR için daha önce oluşturulmuş sipariş bulundu: #{preview.existing_order_id}
                      </div>
                    ) : null}

                    {consumeMutation.isError && getApiErrorCode(consumeMutation.error) !== "checkout_session_already_consumed" ? (
                      <ErrorState
                        title="Teslim onayı tamamlanamadı"
                        description={`${getApiErrorMessage(consumeMutation.error)}${getApiRequestId(consumeMutation.error) ? ` · request_id: ${getApiRequestId(consumeMutation.error)}` : ""}`}
                      />
                    ) : null}

                    <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                      <button
                        type="button"
                        onClick={() => consumeMutation.mutate(consumeToken)}
                        disabled={!canConsume}
                        aria-busy={consumeMutation.isPending}
                        className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-white/20 disabled:text-white/40"
                      >
                        {consumeMutation.isPending ? "Teslim onayı işleniyor..." : "Teslimi onayla"}
                      </button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => previewQuery.refetch()}
                        disabled={previewQuery.isFetching || consumeMutation.isPending}
                      >
                        Yenile
                      </Button>
                    </div>

                    <div className="rounded-[22px] border border-amber-200/70 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>Kamera veya kasa kodu işletme panelinde siparişi otomatik tamamlar. Bu sayfa, bağlantıyla açılan siparişlerde son manuel kontrol için kullanılabilir.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : null}
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
