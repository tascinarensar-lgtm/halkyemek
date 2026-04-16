"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent, Coins, Receipt, ShieldCheck, Wallet } from "lucide-react";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { AmountText } from "@/components/ui/amount-text";
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
  FAILED: "danger",
  CANCELLED: "danger",
  EXPIRED: "danger",
};

function getStatusSummary(status: string) {
  switch (status) {
    case "USED":
      return "Sipariş kasada doğrulanmış ve teslim edilmiş görünüyor.";
    case "PAID":
      return "Sipariş ödemesi alınmış. Teslim veya kullanım adımı bekleniyor olabilir.";
    case "CANCELLED":
      return "Bu sipariş iptal edilmiş durumda.";
    default:
      return "Sipariş kaydı oluşturulmuş ve işletme kayıtlarında görünür durumda.";
  }
}

function getEarningStatusLabel(status: string | null | undefined) {
  switch (status) {
    case "PENDING":
      return "Hakediş beklemede";
    case "ELIGIBLE":
      return "Ödemeye uygun";
    case "IN_PAYOUT":
      return "Ödeme sürecine alındı";
    case "PAID":
      return "Hakediş ödendi";
    case "FAILED":
      return "Ödeme sürecinde sorun var";
    case "REVERSED":
      return "Hakediş ters kayıtla kapandı";
    default:
      return "Hakediş kaydı hazırlanıyor";
  }
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
            description="Satır bazlı ürünler, toplam tahsilat ve işletmeye yansıyacak net tutar bu ekranda açık şekilde görünür."
            actions={
              <Link href={hasValidBusinessId ? `/isletme/${businessId}/gecmis` : "/isletme"} className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                İşlem geçmişine dön
              </Link>
            }
          />

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
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                          <Receipt className="h-3.5 w-3.5" /> İşletme sipariş kaydı
                        </div>
                        <div>
                          <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Sipariş #{order.id}</h2>
                          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{getStatusSummary(order.status)}</p>
                        </div>
                      </div>
                      <StatusChip label={order.status} tone={toneMap[order.status] || "default"} />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ürün adedi</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">{order.item_count}</div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam tahsilat</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">
                          <AmountText amount={order.total_charged_amount} />
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Net işletme tutarı</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">
                          <AmountText amount={order.business_net_amount} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <ShieldCheck className="h-4 w-4" /> Kayıt özeti
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      Bu kart, kasada tamamlanan siparişin finans ve süreç bilgisini tek ekranda gösterir. Özellikle işletmeye yansıyacak net tutar ve kesinti kalemleri burada açık şekilde görünür.
                    </div>
                    <div className="space-y-3 text-sm text-zinc-200">
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                        <span>Oluşturulma zamanı</span>
                        <span className="font-medium text-white">{formatDateTime(order.created_at)}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                        <span>Ödeme zamanı</span>
                        <span className="font-medium text-white">{formatDateTime(order.paid_at)}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                        <span>Teslim/kullanım zamanı</span>
                        <span className="font-medium text-white">{formatDateTime(order.used_at)}</span>
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
                        <h2 className="text-lg font-semibold text-zinc-950">Satır bazlı ürünler</h2>
                        <p className="mt-1 text-sm leading-6 text-zinc-600">
                          Müşterinin siparişinde yer alan her ürün ve o kaleme ait tutar bu bölümde görünür.
                        </p>
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
                    <CardContent className="space-y-5 p-6">
                      <div className="flex items-start gap-3">
                        <Wallet className="mt-0.5 h-5 w-5 text-zinc-700" />
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">Tahsilat ve kesinti kırılımı</h2>
                          <p className="mt-1 text-sm leading-6 text-zinc-600">
                            Kasada müşteriden alınan toplam tutar ile işletmeye yansıyan net rakam burada ayrıntılı görünür.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3 text-sm text-zinc-700">
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Menülerin toplamı</span>
                          <AmountText amount={order.subtotal_amount} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Müşteri ücreti</span>
                          <AmountText amount={order.customer_fee_amount} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Platform kesintisi</span>
                          <AmountText amount={order.business_fee_amount} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white">
                          <span>Toplam tahsilat</span>
                          <AmountText amount={order.total_charged_amount} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-emerald-50 px-4 py-4 text-base font-semibold text-emerald-800">
                          <span>İşletmeye yansıyacak net tutar</span>
                          <AmountText amount={order.business_net_amount} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-stone-200">
                    <CardContent className="space-y-5 p-6">
                      <div className="flex items-start gap-3">
                        <Coins className="mt-0.5 h-5 w-5 text-zinc-700" />
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">Operasyon bilgileri</h2>
                          <p className="mt-1 text-sm leading-6 text-zinc-600">
                            Siparişin hangi QR oturumundan geldiğini ve kasada hangi kayıtla eşleştiğini bu alanda görürsün.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3 text-sm text-zinc-700">
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>QR oturum numarası</span>
                          <span className="font-medium text-zinc-950">{order.checkout_session_id ?? "-"}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Kısa kasa kodu</span>
                          <span className="font-medium tracking-[0.22em] text-zinc-950">{order.checkout_session_cashier_code || "-"}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Kasada onaylayan kullanıcı</span>
                          <span className="font-medium text-zinc-950">{order.consumed_by_user_id ?? "-"}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Müşteri hesabı</span>
                          <span className="font-medium text-zinc-950">{order.customer_user_id}</span>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                        <div className="flex items-start gap-3">
                          <BadgePercent className="mt-0.5 h-4 w-4 shrink-0" />
                          <p>
                            Toplam tahsilat müşteriden alınan tüm tutarı, net işletme tutarı ise platform kesintisi sonrası işletmeye yansıyacak rakamı gösterir. Gün sonu ve hakediş kontrolünde esas alınacak alan net tutardır.
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-stone-200">
                    <CardContent className="space-y-5 p-6">
                      <div className="flex items-start gap-3">
                        <Coins className="mt-0.5 h-5 w-5 text-zinc-700" />
                        <div>
                          <h2 className="text-lg font-semibold text-zinc-950">Hakediş durumu</h2>
                          <p className="mt-1 text-sm leading-6 text-zinc-600">
                            Bu siparişin işletme hakedişi ödeme sürecinde hangi aşamada olduğunu burada görebilirsin.
                          </p>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                        <p className="font-medium">{getEarningStatusLabel(order.earning?.status)}</p>
                        <p className="mt-1">
                          Hakediş, bu sipariş için işletmeye yansıyacak net tahsilatı ifade eder. Ödeme planında esas alınan alan bu kayıttır.
                        </p>
                      </div>

                      <div className="space-y-3 text-sm text-zinc-700">
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Hakediş net tutarı</span>
                          <AmountText amount={order.earning?.net_amount ?? order.business_net_amount} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Ödeme planına esas bakiye</span>
                          <AmountText amount={order.earning?.outstanding_amount ?? order.business_net_amount} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Ödemeye uygun olacağı zaman</span>
                          <span className="font-medium text-zinc-950">{formatDateTime(order.earning?.eligible_at ?? null)}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Hakediş ödendiği zaman</span>
                          <span className="font-medium text-zinc-950">{formatDateTime(order.earning?.paid_at ?? null)}</span>
                        </div>
                        <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                          <span>Bağlı ödeme kaydı</span>
                          <span className="font-medium text-zinc-950">
                            {order.earning?.payout?.id ? `#${order.earning.payout.id} · ${order.earning.payout.status}` : "Henüz oluşturulmadı"}
                          </span>
                        </div>
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
