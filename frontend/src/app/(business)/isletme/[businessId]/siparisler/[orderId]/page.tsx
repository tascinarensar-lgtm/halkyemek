"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Receipt, ShieldCheck, Wallet } from "lucide-react";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getBusinessOrderDetail } from "@/features/business-operations/api";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

const toneMap: Record<string, "default" | "success" | "warning" | "danger"> = {
  PAID: "success",
  USED: "success",
  PENDING: "warning",
  INITIATED: "warning",
  FAILED: "danger",
  CANCELLED: "danger",
  EXPIRED: "danger",
};

const orderStatusLabelMap: Record<string, string> = {
  PAID: "Ödeme alındı",
  USED: "Teslim edildi",
  PENDING: "Hazırlanıyor",
  INITIATED: "İşlem başladı",
  FAILED: "İşlem tamamlanamadı",
  CANCELLED: "İptal edildi",
  EXPIRED: "Süresi doldu",
};

function getOrderStatusLabel(status: string) {
  return orderStatusLabelMap[status] || "Sipariş durumu hazırlanıyor";
}

function getStatusSummary(status: string) {
  switch (status) {
    case "USED":
      return "Sipariş kasada doğrulandı ve teslim edildi.";
    case "PAID":
      return "Tahsilat alındı. Teslim veya kullanım adımı bekleniyor olabilir.";
    case "PENDING":
    case "INITIATED":
      return "Sipariş kaydı oluşturuldu. Teslim süreci tamamlandığında durum otomatik güncellenir.";
    case "FAILED":
      return "Bu siparişin kayıt akışı tamamlanamadı. Gerekirse ops ekibi kontrol edebilir.";
    case "EXPIRED":
      return "Bu siparişin teslim süresi doldu. QR artık kasada kullanılamaz.";
    case "CANCELLED":
      return "Bu sipariş iptal edildi.";
    default:
      return "Sipariş kaydı işletme panelinde görünüyor.";
  }
}

function CompactInfoRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-zinc-600">{label}</span>
      <span className="break-all font-medium text-zinc-950">{value || "-"}</span>
    </div>
  );
}

export default function BusinessOrderDetailPage() {
  const params = useParams<{ businessId: string; orderId: string }>();
  const businessId = Number(params.businessId);
  const orderId = Number(params.orderId);

  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const hasValidOrderId = Number.isFinite(orderId) && orderId > 0;

  const orderQuery = useQuery({
    queryKey: ["business-operations", businessId, "order", orderId],
    queryFn: () => getBusinessOrderDetail(businessId, orderId),
    enabled: hasValidBusinessId && hasValidOrderId,
    retry: false,
  });

  const order = orderQuery.data;

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader
            title={hasValidOrderId ? `Sipariş kaydı #${orderId}` : "Sipariş kaydı"}
            description="Ürünler, tahsilat ve QR doğrulama bilgileri sade şekilde burada görünür."
            actions={
              <Link href={hasValidBusinessId ? `/isletme/${businessId}/gecmis` : "/isletme"} className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                İşlem geçmişine dön
              </Link>
            }
          />

          <div className="flex flex-wrap gap-2">
            <Badge tone="primary">Tahsilat</Badge>
            <Badge tone="success">QR doğrulama</Badge>
          </div>

          {!hasValidBusinessId ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme bilgisi okunamadı. İşletme panelinden tekrar aç." /> : null}
          {hasValidBusinessId && !hasValidOrderId ? <ErrorState title="Geçersiz sipariş" description="Sipariş numarası okunamadı. İşlem geçmişinden tekrar seçim yap." /> : null}

          {hasValidBusinessId && hasValidOrderId && orderQuery.isPending ? <LoadingSkeleton /> : null}
          {hasValidBusinessId && hasValidOrderId && orderQuery.isError ? (
            <ErrorState
              title="Sipariş ayrıntısı yüklenemedi"
              description={`${getApiErrorMessage(orderQuery.error)}${getApiRequestId(orderQuery.error) ? ` · request_id: ${getApiRequestId(orderQuery.error)}` : ""}`}
            />
          ) : null}

          {order ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(245,5,85,0.10),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-4 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-900">
                          <Receipt className="h-3.5 w-3.5" /> İşletme sipariş kaydı
                        </div>
                        <div>
                          <h2 className="text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">Sipariş #{order.id}</h2>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{getStatusSummary(order.status)}</p>
                        </div>
                      </div>
                      <StatusChip label={getOrderStatusLabel(order.status)} tone={toneMap[order.status] || "default"} />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ürün adedi</div>
                        <div className="mt-2 text-xl font-semibold text-zinc-950 sm:text-2xl">{order.item_count}</div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm sm:col-span-2">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Tahsilat</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950 sm:text-3xl">
                          <AmountText amount={order.total_charged_amount} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-4 sm:p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <ShieldCheck className="h-4 w-4" /> Kayıt özeti
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      Siparişin durumu ve zaman bilgileri.
                    </div>
                    <div className="space-y-3 text-sm text-zinc-200">
                      <div className="flex flex-col gap-1 rounded-2xl bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>Sipariş durumu</span>
                        <span className="font-medium text-white">{getOrderStatusLabel(order.status)}</span>
                      </div>
                      <div className="flex flex-col gap-1 rounded-2xl bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>Oluşturulma zamanı</span>
                        <span className="font-medium text-white">{formatDateTime(order.created_at)}</span>
                      </div>
                      <div className="flex flex-col gap-1 rounded-2xl bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>Tahsilat zamanı</span>
                        <span className="font-medium text-white">{formatDateTime(order.paid_at)}</span>
                      </div>
                      <div className="flex flex-col gap-1 rounded-2xl bg-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>Teslim zamanı</span>
                        <span className="font-medium text-white">{formatDateTime(order.used_at)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
                <Card className="border-stone-200">
                  <CardContent className="space-y-5 p-4 sm:p-6">
                    <div className="flex items-start gap-3">
                      <Receipt className="mt-0.5 h-5 w-5 text-zinc-700" />
                      <div>
                        <h2 className="text-lg font-semibold text-zinc-950">Ürünler</h2>
                        <p className="mt-1 text-sm leading-6 text-zinc-600">Siparişteki ürünler ve tahsilat satırları.</p>
                      </div>
                    </div>

                    {order.items.length ? (
                      <div className="space-y-3">
                        {order.items.map((item) => (
                          <div key={item.id} className="rounded-2xl bg-zinc-50 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div>
                                <p className="font-medium text-zinc-950">{repairPotentialMojibake(item.menu_item_name)}</p>
                                <p className="mt-1 text-sm text-zinc-500">
                                  {item.quantity} adet · Birim fiyat <AmountText amount={item.unit_price_amount} />
                                </p>
                              </div>
                              <div className="text-sm font-medium text-zinc-900">
                                <AmountText amount={item.line_total_amount} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="Sipariş satırı görünmüyor" description="Bu siparişte ürün kalemi bulunamadı. Sipariş kaydı var ama içerik boş görünüyor." />
                    )}
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card className="border-stone-200">
                    <CardContent className="space-y-5 p-4 sm:p-6">
                      <div className="flex items-start gap-3">
                        <Wallet className="mt-0.5 h-5 w-5 text-zinc-700" />
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">Tahsilat</h2>
                          <p className="mt-1 text-sm leading-6 text-zinc-600">Müşteriden alınan toplam sipariş tutarı.</p>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white sm:flex sm:items-center sm:justify-between">
                        <span>Tahsilat</span>
                        <span className="mt-2 block sm:mt-0">
                          <AmountText amount={order.total_charged_amount} />
                        </span>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-stone-200">
                    <CardContent className="space-y-5 p-4 sm:p-6">
                      <div className="flex items-start gap-3">
                        <Clock3 className="mt-0.5 h-5 w-5 text-zinc-700" />
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">Doğrulama bilgileri</h2>
                          <p className="mt-1 text-sm leading-6 text-zinc-600">Siparişin QR oturumu ve kasa eşleşme bilgisi.</p>
                        </div>
                      </div>

                      <div className="space-y-3 text-sm">
                        <CompactInfoRow label="QR oturum numarası" value={order.checkout_session_id} />
                        <CompactInfoRow label="Kısa kasa kodu" value={order.checkout_session_cashier_code} />
                        <CompactInfoRow label="Kasada onaylayan kullanıcı" value={order.consumed_by_user_id} />
                        <CompactInfoRow label="Müşteri hesabı" value={order.customer_user_id} />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
