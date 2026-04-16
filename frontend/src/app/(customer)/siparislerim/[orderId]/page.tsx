"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, CreditCard, Receipt, Store } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getOrderDetail } from "@/features/orders/api";
import type { Order } from "@/features/orders/types";
import { ApiClientError } from "@/lib/api/errors";
import { describeApiError } from "@/lib/api/presentation";
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

const statusLabelMap: Record<string, string> = {
  PAID: "Odeme alindi",
  USED: "Teslim edildi",
  PENDING: "Hazirlaniyor",
  INITIATED: "Islem basladi",
  FAILED: "Islem tamamlanamadi",
  CANCELLED: "Iptal edildi",
  EXPIRED: "Suresi doldu",
};

const sourceLabelMap: Record<string, string> = {
  cart_checkout_qr_order: "HalkYemek siparisi",
};

type ProcessTone = "success" | "active" | "warning" | "danger";

type ProcessStep = {
  title: string;
  description: string;
  timeLabel: string;
  tone: ProcessTone;
};

function resolveStatusLabel(status: string) {
  return statusLabelMap[status] || "Durum bilgisi hazirlaniyor";
}

function resolveSourceLabel(order: Order) {
  const contract = String(order.source?.contract || "").trim();
  if (!contract) {
    return "HalkYemek siparis akisi";
  }
  return sourceLabelMap[contract] || "HalkYemek siparis akisi";
}

function buildProcessSteps(order: Order): ProcessStep[] {
  const steps: ProcessStep[] = [
    {
      title: "Siparis olusturuldu",
      description: "Sectigin menuler icin siparis kaydin olusturuldu ve sistemde gorunur hale geldi.",
      timeLabel: formatDateTime(order.created_at),
      tone: "success",
    },
  ];

  if (order.status === "FAILED") {
    steps.push({
      title: "Islem tamamlanamadi",
      description: "Odeme veya siparis islemi beklendigi gibi tamamlanamadi. Istersen yeniden deneyebilirsin.",
      timeLabel: formatDateTime(order.paid_at || order.created_at),
      tone: "danger",
    });
    return steps;
  }

  if (order.paid_at || ["PAID", "USED", "EXPIRED", "CANCELLED"].includes(order.status)) {
    steps.push({
      title: "Odeme onaylandi",
      description: "Odemen alindi ve siparisin HalkYemek akisinda isleme gecti.",
      timeLabel: formatDateTime(order.paid_at || order.created_at),
      tone: "success",
    });
  } else if (order.status === "PENDING" || order.status === "INITIATED") {
    steps.push({
      title: "Odeme kontrol ediliyor",
      description: "Siparisin alindi. Sistem odeme ve teslim hazirligini tamamlarken kaydin guncellenir.",
      timeLabel: formatDateTime(order.created_at),
      tone: "active",
    });
  }

  if (order.status === "USED") {
    steps.push({
      title: "Kasada onaylandi",
      description: "QR dogrulamasi tamamlandi ve siparisin basariyla teslim edildi.",
      timeLabel: formatDateTime(order.used_at),
      tone: "success",
    });
    return steps;
  }

  if (order.status === "EXPIRED") {
    steps.push({
      title: "Teslim suresi doldu",
      description: "Bu siparisin teslim suresi sona erdigi icin akis tamamlanamadi. Istersen yeniden siparis verebilirsin.",
      timeLabel: formatDateTime(order.expires_at),
      tone: "warning",
    });
    return steps;
  }

  if (order.status === "CANCELLED") {
    steps.push({
      title: "Siparis iptal edildi",
      description: "Bu siparis artik aktif degil. Dilersen ayni isletmenin menusune donerek yeni bir siparis olusturabilirsin.",
      timeLabel: formatDateTime(order.expires_at || order.paid_at || order.created_at),
      tone: "danger",
    });
    return steps;
  }

  if (order.status === "PENDING" || order.status === "INITIATED") {
    steps.push({
      title: "Teslim asamasi hazirlaniyor",
      description: "Odeme ve dogrulama tamamlandiginda siparisin teslim icin hazir hale gelir.",
      timeLabel: "Guncel durum bekleniyor",
      tone: "warning",
    });
    return steps;
  }

  return steps;
}

function processToneClasses(tone: ProcessTone) {
  if (tone === "success") {
    return {
      dot: "bg-emerald-500",
      line: "bg-emerald-200",
      card: "border-emerald-200 bg-emerald-50/80",
      text: "text-emerald-800",
      icon: CheckCircle2,
    };
  }
  if (tone === "warning") {
    return {
      dot: "bg-amber-500",
      line: "bg-amber-200",
      card: "border-amber-200 bg-amber-50/80",
      text: "text-amber-900",
      icon: AlertTriangle,
    };
  }
  if (tone === "danger") {
    return {
      dot: "bg-red-500",
      line: "bg-red-200",
      card: "border-red-200 bg-red-50/80",
      text: "text-red-800",
      icon: AlertTriangle,
    };
  }
  return {
    dot: "bg-sky-500",
    line: "bg-sky-200",
    card: "border-sky-200 bg-sky-50/80",
    text: "text-sky-800",
    icon: Clock3,
  };
}

function buildGuidance(order: Order) {
  if (order.status === "USED") {
    return "Bu siparis kasada dogrulanip teslim edilmis durumda. Gecmis kayit olarak bu ekrandan her zaman inceleyebilirsin.";
  }
  if (order.status === "PAID") {
    return "Bu siparis icin odeme kasada QR dogrulamasi sirasinda alinmis ve kayit olusturulmustur. Siparis durumu teslim sonrasinda guncellenir.";
  }
  if (order.status === "EXPIRED") {
    return "Bu kayit teslim suresi dolan bir siparise ait. Yeni bir siparis vermek istersen ayni isletmenin menusune gecebilirsin.";
  }
  if (order.status === "CANCELLED") {
    return "Bu siparis aktif degil. Dilersen ayni isletmenin menulerine donup yeni bir sepet hazirlayabilirsin.";
  }
  return "Bu siparisin durumu sistem tarafinda guncellenmeye devam ediyor. Gerekirse bu ekran uzerinden son bilgileri tekrar kontrol edebilirsin.";
}

export default function OrderDetailPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : "";
  const numericOrderId = Number(orderId);
  const isValidOrderId = Number.isFinite(numericOrderId) && numericOrderId > 0;
  const orderQuery = useQuery({
    queryKey: ["orders", "detail", orderId],
    queryFn: () => getOrderDetail(orderId),
    enabled: isValidOrderId,
    retry: 0,
  });

  let errorTitle = "Siparis ayrintilari yuklenemedi";
  if (orderQuery.error instanceof ApiClientError && orderQuery.error.status === 404) errorTitle = "Siparis bulunamadi";
  if (orderQuery.error instanceof ApiClientError && orderQuery.error.status === 401) errorTitle = "Oturum acman gerekiyor";

  if (!isValidOrderId) {
    return (
      <PageContainer className="space-y-6">
        <SectionHeader
          title="Siparis ayrintisi"
          description="Baglantidaki siparis numarasi okunamadigi icin bu ekran acilamadi."
          actions={
            <Link href="/siparislerim" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
              Siparislerime don
            </Link>
          }
        />
        <ErrorState title="Gecersiz siparis baglantisi" description="Bu baglantidaki siparis numarasi hatali gorunuyor." />
      </PageContainer>
    );
  }

  if (orderQuery.isPending) {
    return (
      <PageContainer className="space-y-6">
        <LoadingSkeleton />
        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      </PageContainer>
    );
  }

  if (orderQuery.isError) {
    return (
      <PageContainer className="space-y-6">
        <SectionHeader
          title={`Siparis #${orderId}`}
          description="Bu ekranda siparisinin urunlerini, odeme ozetini ve teslim durumunu gorebilirsin."
          actions={
            <Link href="/siparislerim" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
              Siparislerime don
            </Link>
          }
        />
        <ErrorState title={errorTitle} description={describeApiError(orderQuery.error, "Siparis ayrintilari su anda getirilemedi. Lutfen daha sonra tekrar dene.")} />
      </PageContainer>
    );
  }

  if (!orderQuery.data) {
    return (
      <PageContainer className="space-y-6">
        <SectionHeader
          title={`Siparis #${orderId}`}
          description="Bu ekranda siparisinin urunlerini, odeme ozetini ve teslim durumunu gorebilirsin."
          actions={
            <Link href="/siparislerim" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
              Siparislerime don
            </Link>
          }
        />
        <ErrorState title="Siparis ayrintisi alinamadi" description="Islem tamamlandi ancak gosterilebilir bir siparis verisi donmedi." />
      </PageContainer>
    );
  }

  const order = orderQuery.data;
  const businessName = repairPotentialMojibake(order.business_name);
  const statusLabel = resolveStatusLabel(order.status);
  const sourceLabel = resolveSourceLabel(order);
  const processSteps = buildProcessSteps(order);
  const guidance = buildGuidance(order);

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title={`Siparis #${order.id}`}
        description="Bu ekranda siparisinin urunlerini, odeme ozetini ve teslim surecindeki son durumu net sekilde gorebilirsin."
        actions={
          <Link href="/siparislerim" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Siparislerime don
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                  <Store className="h-3.5 w-3.5" /> Siparis kaydi
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">{businessName}</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                    HalkYemek uzerinden verdigin bu siparisin tum ayrintilari burada toplanir. Urunlerini, odeme tutarini ve son durumu tek ekranda gorebilirsin.
                  </p>
                </div>
              </div>
              <StatusChip label={statusLabel} tone={toneMap[order.status] || "default"} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Urun adedi</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">{order.item_count}</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam odeme</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">
                  <AmountText amount={order.total_charged_amount} />
                </div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Siparis turu</div>
                <div className="mt-2 text-sm font-semibold text-zinc-950">{sourceLabel}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-zinc-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.98))] shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-medium text-zinc-700">
                <Clock3 className="h-3.5 w-3.5" /> Siparis sureci
              </div>
              <h2 className="text-lg font-semibold text-zinc-950">Siparisin hangi asamada?</h2>
              <p className="text-sm leading-6 text-zinc-600">
                Bu bolumde siparisinin olusturulma, odeme onayi ve teslim surecindeki guncel adimlarini acik ve sade sekilde gorebilirsin.
              </p>
            </div>

            <div className="relative space-y-4">
              {processSteps.map((step, index) => {
                const tone = processToneClasses(step.tone);
                const Icon = tone.icon;
                const showLine = index < processSteps.length - 1;

                return (
                  <div key={`${step.title}-${index}`} className="relative pl-14">
                    {showLine ? <div className={`absolute left-[18px] top-10 h-[calc(100%-12px)] w-px ${tone.line}`} /> : null}
                    <div className={`absolute left-0 top-1 flex h-9 w-9 items-center justify-center rounded-full ${tone.dot} text-white shadow-sm`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className={`rounded-2xl border p-4 ${tone.card}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={`font-semibold ${tone.text}`}>{step.title}</p>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-zinc-600">{step.timeLabel}</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-zinc-700">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="space-y-6">
          <Card className="border-stone-200">
            <CardContent className="space-y-5 p-6">
              <div className="flex items-start gap-3">
                <Receipt className="mt-0.5 h-5 w-5 text-zinc-700" />
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Siparisindeki urunler</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    Siparisine eklenen menuleri ve her urun icin odedigin tutari burada gorebilirsin.
                  </p>
                </div>
              </div>

              {order.order_items.length > 0 ? (
                <div className="space-y-3">
                  {order.order_items.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-zinc-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="font-medium text-zinc-950">{repairPotentialMojibake(item.menu_item_name)}</p>
                          <p className="mt-1 text-sm text-zinc-500">{item.quantity} adet</p>
                        </div>
                        <div className="text-sm font-medium text-zinc-900">
                          <AmountText amount={item.line_total_amount} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="Bu sipariste urun gorunmuyor" description="Siparis kaydi var ancak urun satirlari su anda goruntulenemiyor." />
              )}
            </CardContent>
          </Card>

          <Card className="border-stone-200">
            <CardContent className="space-y-4 p-6">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-zinc-950">Sonraki adim</h2>
                <p className="text-sm leading-6 text-zinc-600">
                  Ayni isletmeden tekrar siparis vermek istersen menuyu yeniden acabilir veya diger siparislerini incelemek icin listeye donebilirsin.
                </p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">{guidance}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href={`/isletmeler/${order.business}/menu`} className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                  Menuyu tekrar ac
                </Link>
                <Link href="/siparislerim" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                  Diger siparislerime bak
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-stone-200">
            <CardContent className="space-y-5 p-6">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-0.5 h-5 w-5 text-zinc-700" />
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">Odeme ozeti</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    Siparisin icin odedigin tutarin dagilimini burada net bicimde gorebilirsin.
                  </p>
                </div>
              </div>

              <div className="space-y-3 text-sm text-zinc-700">
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Menulerin toplami</span>
                  <AmountText amount={order.subtotal_amount} />
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Islem ve hizmet payi</span>
                  <AmountText amount={order.customer_fee_amount} />
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Isletmeye yansiyan tutar</span>
                  <AmountText amount={order.business_net_amount} />
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-950 px-4 py-4 text-base font-semibold text-white">
                  <span>Toplam odeme</span>
                  <AmountText amount={order.total_charged_amount} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200">
            <CardContent className="space-y-4 p-6">
              <h2 className="text-lg font-semibold text-zinc-950">Siparis bilgileri</h2>
              <div className="space-y-3 text-sm text-zinc-700">
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Durum</span>
                  <span className="font-medium text-zinc-950">{statusLabel}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Siparis turu</span>
                  <span className="font-medium text-zinc-950">{sourceLabel}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Odeme zamani</span>
                  <span className="font-medium text-zinc-950">{formatDateTime(order.paid_at)}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Teslim zamani</span>
                  <span className="font-medium text-zinc-950">{formatDateTime(order.used_at)}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl bg-zinc-50 px-4 py-3">
                  <span>Siparis numarasi</span>
                  <span className="font-medium text-zinc-950">#{order.id}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
