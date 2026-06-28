"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Clock3, CreditCard, PackageOpen, QrCode, ReceiptText, Store, Tag } from "lucide-react";

import { CustomerBottomSection } from "@/components/layout/customer-bottom-section";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { StatusChip } from "@/components/ui/status-chip";
import { getOrderDetail } from "@/features/orders/api";
import type { Order } from "@/features/orders/types";
import { useSession } from "@/hooks/use-session";
import { ApiClientError } from "@/lib/api/errors";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

const statusToneMap: Record<string, "default" | "success" | "warning" | "danger"> = {
  PAID: "success",
  USED: "success",
  PENDING: "warning",
  INITIATED: "warning",
  FAILED: "danger",
  CANCELLED: "danger",
  EXPIRED: "danger",
};

const statusLabelMap: Record<string, string> = {
  PAID: "Ödeme alındı",
  USED: "Teslim edildi",
  PENDING: "Hazırlanıyor",
  INITIATED: "İşlem başladı",
  FAILED: "İşlem tamamlanamadı",
  CANCELLED: "İptal edildi",
  EXPIRED: "Süresi doldu",
};

type TimelineTone = "success" | "active" | "warning" | "danger";

type TimelineStep = {
  title: string;
  description: string;
  timeLabel: string;
  tone: TimelineTone;
};

function resolveStatusLabel(status: string) {
  return statusLabelMap[status] || "Durum hazırlanıyor";
}

function isOrderDelivered(order: Order) {
  return order.status === "USED" || Boolean(order.used_at || order.checkout_session_consumed_at);
}

function isSurpriseOrder(order: Order) {
  return order.source?.source_type === "SURPRISE_DEAL" || order.order_items.some((item) => item.item_type === "SURPRISE_DEAL" || item.source_type === "SURPRISE_DEAL");
}

function getOrderItemDisplayName(item: Order["order_items"][number]) {
  return repairPotentialMojibake(item.display_name || item.menu_item_name || "Sürpriz Paket");
}

function formatPickupWindow(item: Order["order_items"][number]) {
  if (!item.pickup_window_start || !item.pickup_window_end) return "";
  return `${formatDateTime(item.pickup_window_start)} - ${formatDateTime(item.pickup_window_end)}`;
}

function resolveSourceLabel(order: Order) {
  if (isSurpriseOrder(order)) return "Sürpriz Paket";
  const contract = String(order.source?.contract || "").trim();
  if (contract === "cart_checkout_qr_order") return "QR ile teslim";
  return "HalkYemek siparişi";
}

function safeDate(value: string | null | undefined) {
  return value ? formatDateTime(value) : "-";
}

function buildTimeline(order: Order): TimelineStep[] {
  const isSurprise = isSurpriseOrder(order);
  const steps: TimelineStep[] = [
    {
      title: "Sipariş oluşturuldu",
      description: isSurprise ? "Sürpriz Paket kaydı oluşturuldu." : "Sipariş kaydı oluşturuldu.",
      timeLabel: safeDate(order.created_at),
      tone: "success",
    },
  ];

  if (order.status === "FAILED") {
    return [
      ...steps,
      {
        title: "İşlem tamamlanamadı",
        description: "Ödeme veya teslim akışı beklenen şekilde tamamlanamadı.",
        timeLabel: safeDate(order.paid_at || order.created_at),
        tone: "danger",
      },
    ];
  }

  if (order.paid_at || ["PAID", "USED", "EXPIRED", "CANCELLED"].includes(order.status)) {
    steps.push({
      title: "Ödeme onaylandı",
      description: isSurprise ? "Paket tutarı teslim onayıyla cüzdandan düşüldü." : "Sipariş ödemesi onaylandı.",
      timeLabel: safeDate(order.paid_at || order.created_at),
      tone: "success",
    });
  } else {
    steps.push({
      title: "Ödeme kontrol ediliyor",
      description: "Sipariş ödeme akışı sistem tarafından doğrulanıyor.",
      timeLabel: "Bekleniyor",
      tone: "active",
    });
  }

  if (isOrderDelivered(order)) {
    steps.push({
      title: "Teslim tamamlandı",
      description: isSurprise
        ? "İşletme Sürpriz Paket teslimini onayladı."
        : "İşletme QR, kasa kodu veya doğrudan teslim onayı ile siparişi tamamladı.",
      timeLabel: safeDate(order.used_at || order.checkout_session_consumed_at),
      tone: "success",
    });
  } else if (order.status === "PAID") {
    steps.push({
      title: isSurprise ? "Sürpriz Paket QR bekleniyor" : "Kasada QR bekleniyor",
      description: isSurprise ? "Teslim saatinde QR kodunu ya da kasa kodunu işletmeye gösterebilirsin." : "Kasada QR kodunu ya da kasa kodunu gösterebilirsin.",
      timeLabel: order.expires_at ? `Son geçerlilik: ${safeDate(order.expires_at)}` : "Aktif",
      tone: "active",
    });
  } else if (order.status === "EXPIRED") {
    steps.push({
      title: "Teslim süresi doldu",
      description: isSurprise ? "Bu paket için ayrılan teslim süresi sona erdi." : "Bu sipariş için QR teslim süresi sona erdi.",
      timeLabel: safeDate(order.expires_at),
      tone: "warning",
    });
  } else if (order.status === "CANCELLED") {
    steps.push({
      title: "Sipariş iptal edildi",
      description: "Bu sipariş artık aktif değildir.",
      timeLabel: safeDate(order.expires_at || order.paid_at || order.created_at),
      tone: "danger",
    });
  } else {
    steps.push({
      title: "Teslim hazırlanıyor",
      description: "Sipariş durumu güncellendiğinde süreç bu ekranda görünür.",
      timeLabel: "Bekleniyor",
      tone: "warning",
    });
  }

  return steps;
}

function toneClasses(tone: TimelineTone) {
  if (tone === "success") return { icon: CheckCircle2, dot: "bg-emerald-500", card: "border-emerald-100 bg-emerald-50", text: "text-emerald-800" };
  if (tone === "danger") return { icon: AlertTriangle, dot: "bg-red-500", card: "border-red-100 bg-red-50", text: "text-red-800" };
  if (tone === "warning") return { icon: AlertTriangle, dot: "bg-amber-500", card: "border-amber-100 bg-amber-50", text: "text-amber-900" };
  return { icon: Clock3, dot: "bg-[#ff1f63]", card: "border-rose-100 bg-rose-50", text: "text-[#c80f4a]" };
}

function guidanceFor(order: Order) {
  const isSurprise = isSurpriseOrder(order);
  if (isSurprise && isOrderDelivered(order)) return "Sürpriz paket teslimin tamamlandı. Paket tutarını, tahmini değerini ve teslim zamanını bu sayfadan takip edebilirsin.";
  if (isSurprise && order.status === "PAID") return "Sürpriz Paket QR kodun hazır. Teslim saatinde işletmede QR kodunu veya kasa kodunu göstererek paketi teslim alabilirsin.";
  if (isOrderDelivered(order)) return "Bu sipariş tamamlandı. Ürünleri, tutarı ve teslim zamanını bu sayfadan takip edebilirsin.";
  if (order.status === "PAID") return "Ödeme tamamlandı. İşletmede QR kodunu kasada okutarak siparişini teslim alabilirsin.";
  if (order.status === "EXPIRED") return isSurprise
    ? "Bu Sürpriz Paket için teslim süresi dolmuş. Yeni fırsatları Son Dakika Fırsatları sayfasından takip edebilirsin."
    : "Bu siparişin teslim süresi dolmuş. Dilersen aynı işletmenin menüsünden yeni bir sipariş oluşturabilirsin.";
  if (order.status === "CANCELLED") return "Bu sipariş iptal edilmiş. Yeni sipariş için işletme menüsüne dönebilirsin.";
  if (order.status === "FAILED") return "Bu sipariş tamamlanamamış. Cüzdan ve sepet durumunu kontrol ederek yeniden deneyebilirsin.";
  return "Siparişin sistem tarafından güncelleniyor. Kısa süre sonra bu ekrandan son durumu görebilirsin.";
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const sessionQuery = useSession();
  const orderId = typeof params.orderId === "string" ? params.orderId : "";
  const numericOrderId = Number(orderId);
  const isValidOrderId = Number.isFinite(numericOrderId) && numericOrderId > 0;
  const currentUserId = sessionQuery.data?.user?.id ?? null;

  const orderQuery = useQuery({
    queryKey: ["orders", "customer", "detail", orderId, currentUserId],
    queryFn: () => getOrderDetail(orderId),
    enabled: isValidOrderId && Boolean(currentUserId),
    retry: 0,
    refetchInterval: (query) => {
      const order = query.state.data;
      if (!order) return 5_000;
      return isOrderDelivered(order) || ["EXPIRED", "CANCELLED", "FAILED"].includes(order.status) ? false : 5_000;
    },
    refetchIntervalInBackground: false,
  });

  if (!isValidOrderId) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState title="Geçersiz sipariş bağlantısı" description="Bağlantıdaki sipariş numarası okunamadı." />
        <Link href="/siparislerim" className="inline-flex w-fit items-center gap-2 rounded-2xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white">
          <ArrowLeft className="h-4 w-4" /> Siparişlerime dön
        </Link>
      </PageContainer>
    );
  }

  if (!sessionQuery.isPending && !currentUserId) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState title="Oturum açman gerekiyor" description="Kişisel sipariş ayrıntılarını görüntülemek için giriş yapmalısın." />
        <Link href="/siparislerim" className="inline-flex w-fit items-center gap-2 rounded-2xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white">
          <ArrowLeft className="h-4 w-4" /> Siparişlerime dön
        </Link>
      </PageContainer>
    );
  }

  if (sessionQuery.isPending || orderQuery.isPending) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <LoadingSkeleton />
        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      </PageContainer>
    );
  }

  if (orderQuery.isError) {
    let title = "Sipariş ayrıntıları yüklenemedi";
    if (orderQuery.error instanceof ApiClientError && orderQuery.error.status === 404) title = "Sipariş bulunamadı";
    if (orderQuery.error instanceof ApiClientError && orderQuery.error.status === 401) title = "Oturum açman gerekiyor";

    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState title={title} description={describeApiError(orderQuery.error, "Sipariş ayrıntıları şu anda getirilemedi.")} />
        <Link href="/siparislerim" className="inline-flex w-fit items-center gap-2 rounded-2xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white">
          <ArrowLeft className="h-4 w-4" /> Siparişlerime dön
        </Link>
      </PageContainer>
    );
  }

  const order = orderQuery.data;

  if (currentUserId && order.user !== currentUserId) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState title="Sipariş bulunamadı" description="Bu kayıt müşteri sipariş geçmişine ait değil. İşletme kayıtları işletme panelinden görüntülenir." />
        <Link href="/siparislerim" className="inline-flex w-fit items-center gap-2 rounded-2xl bg-zinc-950 px-4 py-2 text-sm font-semibold text-white">
          <ArrowLeft className="h-4 w-4" /> Siparişlerime dön
        </Link>
      </PageContainer>
    );
  }

  const businessName = repairPotentialMojibake(order.business_name);
  const statusLabel = isOrderDelivered(order) ? "Teslim edildi" : resolveStatusLabel(order.status);
  const isSurprise = isSurpriseOrder(order);
  const sourceLabel = resolveSourceLabel(order);
  const timeline = buildTimeline(order);

  return (
    <PageContainer className="space-y-7 bg-white sm:space-y-8">
      <section className="relative overflow-hidden rounded-[30px] bg-[#f50555] px-5 py-7 text-white shadow-[0_24px_70px_rgba(245,5,85,0.20)] sm:px-8 lg:px-10">
        <div className="pointer-events-none absolute -right-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-white/12" />
        <div className="pointer-events-none absolute right-20 top-1/2 h-44 w-44 -translate-y-1/2 rounded-full bg-white/10" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Link href="/siparislerim" className="inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1.5 text-xs font-semibold text-white/90 ring-1 ring-white/20 transition hover:bg-white/20">
              <ArrowLeft className="h-3.5 w-3.5" /> Siparişlerime dön
            </Link>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">Sipariş #{order.id}</h1>
            <p className="mt-2 flex max-w-2xl items-center gap-2 text-sm leading-6 text-white/88">
              <Store className="h-4 w-4 shrink-0" />
              {businessName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {isSurprise ? <StatusChip label="Sürpriz Paket" tone="warning" /> : null}
            <StatusChip label={statusLabel} tone={statusToneMap[order.status] || "default"} />
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[22px] border border-zinc-100 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Toplam ödeme</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950"><AmountText amount={order.total_charged_amount} /></p>
        </div>
        <div className="rounded-[22px] border border-zinc-100 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Ürün adedi</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-950">{order.item_count}</p>
        </div>
        <div className="rounded-[22px] border border-zinc-100 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Sipariş türü</p>
          <p className="mt-2 text-base font-semibold text-zinc-950">{sourceLabel}</p>
        </div>
        <div className="rounded-[22px] border border-zinc-100 bg-white p-5 shadow-[0_16px_42px_rgba(15,23,42,0.06)]">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Oluşturulma</p>
          <p className="mt-2 text-sm font-semibold text-zinc-950">{safeDate(order.created_at)}</p>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-6">
          <Card className="border-zinc-100 shadow-[0_18px_54px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <ReceiptText className="mt-0.5 h-5 w-5 text-[#ff1f63]" />
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.035em] text-zinc-950">Siparişindeki ürünler</h2>
                </div>
              </div>

              {order.order_items.length > 0 ? (
                <div className="space-y-3">
                  {order.order_items.map((item) => {
                    const itemIsSurprise = item.item_type === "SURPRISE_DEAL" || item.source_type === "SURPRISE_DEAL";
                    const pickupWindow = formatPickupWindow(item);
                    return (
                      <div key={item.id} className="flex flex-col gap-3 rounded-2xl bg-zinc-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-zinc-950">{getOrderItemDisplayName(item)}</p>
                            {itemIsSurprise ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-[#f50555] ring-1 ring-rose-100">
                                <PackageOpen className="h-3.5 w-3.5" />
                                Sürpriz Paket
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-sm text-zinc-500">{item.quantity} adet · Birim fiyat <AmountText amount={item.unit_price_amount} /></p>
                          {pickupWindow ? (
                            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[#f50555]">
                              <Clock3 className="h-3.5 w-3.5" />
                              Teslim: {pickupWindow}
                            </p>
                          ) : null}
                          {item.original_value_amount ? (
                            <p className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600">
                              <Tag className="h-3.5 w-3.5 text-[#f50555]" />
                              Tahmini değer: <AmountText amount={item.original_value_amount} />
                            </p>
                          ) : null}
                        </div>
                        <p className="text-lg font-semibold text-zinc-950"><AmountText amount={item.line_total_amount} /></p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState title="Ürün bilgisi görünmüyor" description="Sipariş kaydı var ancak ürün satırları şu anda gösterilemiyor." />
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-100 shadow-[0_18px_54px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <h2 className="text-xl font-semibold tracking-[-0.035em] text-zinc-950">Ne yapmalısın?</h2>
              <p className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">{guidanceFor(order)}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href={`/isletmeler/${order.business}`} className="inline-flex items-center justify-center rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#f50555]">
                  İşletmeye git
                </Link>
                <Link href="/siparislerim" className="inline-flex items-center justify-center rounded-2xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 transition hover:-translate-y-0.5 hover:bg-zinc-200">
                  Tüm siparişlerim
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-zinc-100 shadow-[0_18px_54px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <QrCode className="mt-0.5 h-5 w-5 text-[#ff1f63]" />
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.035em] text-zinc-950">Sipariş süreci</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">QR, ödeme ve teslim akışının son durumu.</p>
                </div>
              </div>

              <div className="space-y-3">
                {timeline.map((step) => {
                  const classes = toneClasses(step.tone);
                  const Icon = classes.icon;
                  return (
                    <div key={step.title} className={`rounded-2xl border p-4 ${classes.card}`}>
                      <div className="flex items-start gap-3">
                        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${classes.dot}`}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className={`font-semibold ${classes.text}`}>{step.title}</p>
                            <span className="rounded-full bg-white/75 px-2.5 py-1 text-xs font-medium text-zinc-600">{step.timeLabel}</span>
                          </div>
                          {step.description ? <p className="mt-2 text-sm leading-6 text-zinc-700">{step.description}</p> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-100 shadow-[0_18px_54px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-0.5 h-5 w-5 text-[#ff1f63]" />
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.035em] text-zinc-950">Ödeme özeti</h2>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white">
                <span>Toplam</span>
                <AmountText amount={order.total_charged_amount} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-zinc-100 shadow-[0_18px_54px_rgba(15,23,42,0.06)]">
            <CardContent className="space-y-3 p-5 sm:p-6">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-[#ff1f63]" />
                <h2 className="text-xl font-semibold tracking-[-0.035em] text-zinc-950">Kayıt bilgileri</h2>
              </div>
              <div className="grid gap-2 text-sm text-zinc-700">
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-50 px-4 py-3"><span>Durum</span><span className="text-right font-semibold text-zinc-950">{statusLabel}</span></div>
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-50 px-4 py-3"><span>Ödeme</span><span className="text-right font-semibold text-zinc-950">{safeDate(order.paid_at)}</span></div>
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-50 px-4 py-3"><span>Teslim</span><span className="text-right font-semibold text-zinc-950">{safeDate(order.used_at || order.checkout_session_consumed_at)}</span></div>
                <div className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-50 px-4 py-3"><span>Geçerlilik</span><span className="text-right font-semibold text-zinc-950">{safeDate(order.expires_at)}</span></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <CustomerBottomSection />
    </PageContainer>
  );
}
