"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, QrCode, Receipt, RefreshCcw, ShieldCheck, Store } from "lucide-react";
import { toast } from "sonner";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
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
      return "Bu QR daha önce kasada doğrulanmış. Mevcut sipariş kaydını açarak işlemi kontrol edebilirsin.";
    case "expired":
      return "Bu QR oturumunun süresi dolmuş. Müşterinin siparişi yeniden başlatması gerekir.";
    case "cancelled":
      return "Bu QR oturumu müşteri tarafından iptal edilmiş.";
    case "business_unavailable":
      return "İşletme şu anda bu doğrulamayı tamamlayacak uygun durumda görünmüyor.";
    case "wallet_missing":
    case "insufficient_balance":
      return "Müşteri cüzdanı bu işlemi tamamlayacak durumda görünmüyor.";
    case "empty_snapshot":
      return "Sipariş içeriği okunamadığı için güvenli teslim onayı kapatıldı.";
    case "invalid_status":
      return "Bu QR oturumu mevcut durumu nedeniyle doğrulanamaz.";
    default:
      return "Bu QR şu anda teslim onayı için uygun görünmüyor.";
  }
}

function getStatusPresentation(status: string, canConsume: boolean) {
  if (canConsume) {
    return { label: "Teslime hazır", tone: "success" as const };
  }
  if (status === "CONSUMED") {
    return { label: "Teslim onayı verildi", tone: "warning" as const };
  }
  if (status === "EXPIRED" || status === "CANCELLED") {
    return { label: "Doğrulama kapalı", tone: "danger" as const };
  }
  return { label: "Kontrol gerekiyor", tone: "default" as const };
}

export default function BusinessConsumePage() {
  const params = useParams<{ businessId: string; token: string }>();
  const businessId = Number(params.businessId);
  const token = params.token;
  const queryClient = useQueryClient();
  const [postConsumeSyncMessage, setPostConsumeSyncMessage] = useState<string | null>(null);

  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const hasValidToken = typeof token === "string" && token.trim().length > 0;

  const previewQuery = useQuery({
    queryKey: ["business-operations", businessId, "consume-preview", token],
    queryFn: () => getBusinessConsumePreview(businessId, token),
    enabled: hasValidBusinessId && hasValidToken,
    retry: false,
  });

  const consumeMutation = useMutation({
    mutationFn: () => consumeBusinessCheckoutSession(businessId, token),
    onMutate: () => {
      setPostConsumeSyncMessage(null);
    },
    onSuccess: async (data) => {
      toast.success("Teslim onayı verildi. Sipariş başarıyla oluşturuldu.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "consume-history"] }),
        queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "consume-preview", token] }),
      ]);
      queryClient.setQueryData(["business-operations", businessId, "consume-result", token], data);
    },
    onError: async (error) => {
      const code = getApiErrorCode(error);

      if (code === "checkout_session_already_consumed") {
        await queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "consume-preview", token] });
        toast.error("Bu QR daha önce doğrulanmış. Mevcut siparişe yönlenebilirsin.");
        return;
      }

      if (code === "proxy_network_error" || !(error && typeof error === "object" && "status" in error)) {
        const refreshedPreview = await previewQuery.refetch();
        if (refreshedPreview.data?.existing_order_id) {
          setPostConsumeSyncMessage("İlk istek ağ hatasına düştü; tekrar sorguda mevcut sipariş bulundu. İşlem ikinci kez tetiklenmedi.");
          toast.error("İlk istek belirsiz kaldı ama mevcut sipariş bulundu.");
          return;
        }
        setPostConsumeSyncMessage("Ağ hatası nedeniyle son durum doğrulanamadı. Tekrar denemeden önce bilgiyi yenile.");
      }

      toast.error(getApiErrorMessage(error, "Teslim onayı tamamlanamadı."));
    },
  });

  const preview = previewQuery.data;
  const alreadyConsumedOrderId = useMemo(() => {
    const details = getApiErrorDetails(consumeMutation.error);
    const orderId = details?.order_id;
    return typeof orderId === "number" ? orderId : typeof orderId === "string" ? Number(orderId) : null;
  }, [consumeMutation.error]);
  const successOrderId = consumeMutation.data?.order_id ?? preview?.existing_order_id ?? alreadyConsumedOrderId ?? null;
  const canConsume = Boolean(preview?.can_consume) && !consumeMutation.isPending && !previewQuery.isFetching;

  const statusPresentation = preview ? getStatusPresentation(preview.status, Boolean(preview.can_consume)) : null;
  const statusText = preview
    ? preview.can_consume
      ? "Teslim onayına bastığında müşterinin ödemesi kesinleşir, sipariş kaydı açılır ve bu işlem geri dönmez."
      : getFailureCopy(preview.failure_reason)
    : "";
  const items = [...(preview?.items ?? [])].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader
            title="QR doğrulama ve teslim onayı"
            description="Kasadaki QR veya kısa kasa kodu bu ekrana düşer. Önce sipariş içeriğini kontrol eder, ardından tek tuşla teslim onayı verirsin."
            actions={
              <Link href={hasValidBusinessId ? `/isletme/${businessId}/gecmis` : "/isletme"} className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                İşlem geçmişine dön
              </Link>
            }
          />

          {!hasValidBusinessId ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme bilgisi okunamadı. Güvenli işlem için işletme panelinden tekrar aç." /> : null}
          {hasValidBusinessId && !hasValidToken ? <ErrorState title="Geçersiz doğrulama bağlantısı" description="QR veya bağlantı bilgisi eksik görünüyor. QR kodu yeniden okut veya kasa kodunu tekrar gir." /> : null}

          {hasValidBusinessId && hasValidToken && previewQuery.isPending ? <LoadingSkeleton /> : null}
          {hasValidBusinessId && hasValidToken && previewQuery.isError ? (
            <ErrorState
              title={getPreviewErrorTitle(previewQuery.error)}
              description={`${getApiErrorMessage(previewQuery.error)}${getApiRequestId(previewQuery.error) ? ` · request_id: ${getApiRequestId(previewQuery.error)}` : ""}`}
            />
          ) : null}

          {preview ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                          <Store className="h-3.5 w-3.5" /> Kasada doğrulama ekranı
                        </div>
                        <div>
                          <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
                            {repairPotentialMojibake(preview.business.name)}
                          </h2>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                            Bu ekranda müşterinin seçtiği ürünleri, toplam tahsilatı ve kısa kasa kodunu görürsün. Doğrulamayı sadece sipariş içeriği ve işletme eşleşmesi doğruysa tamamla.
                          </p>
                        </div>
                      </div>
                      {statusPresentation ? <StatusChip label={statusPresentation.label} tone={statusPresentation.tone} /> : null}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Kısa kasa kodu</div>
                        <div className="mt-2 text-2xl font-semibold tracking-[0.28em] text-zinc-950">{preview.cashier_code || "-"}</div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ürün adedi</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">{preview.item_count}</div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Müşteriden alınacak</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">
                          <AmountText amount={preview.total_payable_amount} currency={preview.currency || "TRY"} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <ShieldCheck className="h-4 w-4" /> Kasiyer kontrol notu
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      Önce ürünleri ve toplam tutarı kontrol et. Teslim onayı verildiğinde müşterinin ödemesi kesinleşir ve sipariş geçmişe kaydolur.
                    </div>
                    <div className="space-y-4 text-sm text-zinc-200">
                      <div className="flex gap-3">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">1</span>
                        <p>QR okutulduysa veya kısa kasa kodu girildiyse işletme ve ürün eşleşmesini bu ekranda kontrol et.</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">2</span>
                        <p>Müşterinin sipariş toplamı doğruysa tek tuşla teslim onayı ver.</p>
                      </div>
                      <div className="flex gap-3">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">3</span>
                        <p>Onaydan sonra detay sayfası açılır; net tutar ve satır bazlı ürünleri orada da inceleyebilirsin.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
                <Card className="border-stone-200">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-start gap-3">
                      <Receipt className="mt-0.5 h-5 w-5 text-zinc-700" />
                      <div>
                        <h2 className="text-lg font-semibold text-zinc-950">Sipariş içeriği</h2>
                        <p className="mt-1 text-sm leading-6 text-zinc-600">
                          Teslim onayından önce kasada hangi ürünlerin verileceğini ve müşteriden tahsil edilecek toplamı burada kontrol edebilirsin.
                        </p>
                      </div>
                    </div>

                    {items.length ? (
                      <div className="space-y-3">
                        {items.map((item, index) => (
                          <div key={`${item.menu_item_id}-${index}`} className="rounded-2xl bg-zinc-50 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-medium text-zinc-950">
                                  {repairPotentialMojibake(item.menu_item_name || item.name || `Ürün ${item.menu_item_id}`)}
                                </p>
                                <p className="mt-1 text-sm text-zinc-500">
                                  {item.quantity} adet · Birim fiyat <AmountText amount={item.unit_price_amount} currency={preview.currency || "TRY"} />
                                </p>
                              </div>
                              <div className="text-sm font-medium text-zinc-900">
                                <AmountText amount={item.line_total_amount} currency={preview.currency || "TRY"} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <ErrorState title="Sipariş satırları görüntülenemiyor" description="Ürün kalemleri şu anda okunamadı. Doğrulamayı tamamlamadan önce bilgiyi yenilemeyi dene." />
                    )}

                    <div className="grid gap-3 text-sm text-zinc-700">
                      <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                        <span>Menülerin toplamı</span>
                        <AmountText amount={preview.subtotal_amount ?? preview.total_payable_amount} currency={preview.currency || "TRY"} />
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                        <span>Müşteri hizmet payı</span>
                        <AmountText amount={preview.customer_fee_amount ?? 0} currency={preview.currency || "TRY"} />
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white">
                        <span>Kasada tahsil edilecek toplam</span>
                        <AmountText amount={preview.total_payable_amount} currency={preview.currency || "TRY"} />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-start gap-3">
                      <QrCode className="mt-0.5 h-5 w-5 text-zinc-700" />
                      <div>
                        <h2 className="text-lg font-semibold text-zinc-950">Teslim onayı</h2>
                        <p className="mt-1 text-sm leading-6 text-zinc-600">
                          Bu bölümde QR oturumunun son durumunu görür, gerekirse bilgiyi yeniler ve doğrulamayı güvenle tamamlarsın.
                        </p>
                      </div>
                    </div>

                    <div className={`rounded-2xl p-4 text-sm leading-6 ${preview.can_consume ? "bg-emerald-50 text-emerald-800" : preview.status === "EXPIRED" || preview.status === "CANCELLED" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-800"}`}>
                      {statusText}
                    </div>

                    <div className="space-y-3 text-sm text-zinc-700">
                      <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                        <span>QR oturum numarası</span>
                        <span className="font-medium text-zinc-950">#{preview.checkout_session_id}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                        <span>Son geçerlilik</span>
                        <span className="font-medium text-zinc-950">{formatDateTime(preview.expires_at)}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                        <span>İşletmeye yansıyacak net</span>
                        <AmountText amount={preview.business_net_amount ?? 0} currency={preview.currency || "TRY"} />
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                        <span>Platform kesintisi</span>
                        <AmountText amount={preview.business_fee_amount ?? 0} currency={preview.currency || "TRY"} />
                      </div>
                    </div>

                    {postConsumeSyncMessage ? (
                      <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">{postConsumeSyncMessage}</div>
                    ) : null}

                    {successOrderId ? (
                      <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium">Teslim onayı tamamlandı</p>
                            <p className="mt-1">Sipariş kaydı hazır. İstersen ayrıntı sayfasında kalemleri ve tutar kırılımını açabilirsin.</p>
                          </div>
                        </div>
                        <Link href={`/isletme/${businessId}/siparisler/${successOrderId}`} className="mt-4 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800">
                          Sipariş detayını aç
                        </Link>
                      </div>
                    ) : null}

                    {preview.existing_order_id && !successOrderId ? (
                      <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">
                        Bu QR için daha önce oluşturulmuş sipariş bulundu: #{preview.existing_order_id}
                      </div>
                    ) : null}

                    {consumeMutation.isError && getApiErrorCode(consumeMutation.error) !== "checkout_session_already_consumed" ? (
                      <ErrorState
                        title="Teslim onayı tamamlanamadı"
                        description={`${getApiErrorMessage(consumeMutation.error)}${getApiRequestId(consumeMutation.error) ? ` · request_id: ${getApiRequestId(consumeMutation.error)}` : ""}`}
                      />
                    ) : null}

                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => consumeMutation.mutate()}
                        disabled={!canConsume}
                        className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                      >
                        {consumeMutation.isPending ? "Teslim onayı veriliyor..." : "Teslim onayını ver"}
                      </button>
                      <button
                        type="button"
                        onClick={() => previewQuery.refetch()}
                        disabled={previewQuery.isFetching || consumeMutation.isPending}
                        className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 disabled:text-zinc-400"
                      >
                        <RefreshCcw className="h-4 w-4" />
                        Bilgiyi yenile
                      </button>
                    </div>

                    <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>
                          Teslim onayına bastığında müşterinin ödemesi bu ekranda tamamlanır. Yanlış müşteride veya yanlış işletmede işlem yapmamak için kısa kasa kodu, ürün listesi ve toplam tutarı her zaman son kez kontrol et.
                        </p>
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
