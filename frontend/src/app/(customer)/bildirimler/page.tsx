"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Clock3,
  Copy,
  Globe,
  Megaphone,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  getBrowserPushState,
  getNotifications,
  getNotificationReadiness,
  registerDevice,
} from "@/features/notifications/api";
import type {
  BrowserNotificationState,
  NotificationItem,
  NotificationReadiness,
} from "@/features/notifications/types";
import { getBrowserGuidance } from "@/features/notifications/presentation";
import { resolvePageParam } from "@/features/discovery/params";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";

function getNotificationTypePresentation(type: string) {
  const normalized = String(type || "").trim().toUpperCase();

  switch (normalized) {
    case "ORDER_PAID":
      return { label: "Sipariş onayı", icon: PackageCheck };
    case "ORDER_CONSUMED":
    case "ORDER_USED":
      return { label: "Teslim bilgisi", icon: PackageCheck };
    case "PAYMENT_SETTLED":
      return { label: "Bakiye bildirimi", icon: Wallet };
    case "BALANCE_LOW":
      return { label: "Düşük bakiye uyarısı", icon: TriangleAlert };
    case "SYSTEM_BROADCAST":
      return { label: "Duyuru", icon: Megaphone };
    case "PAYOUT_SENT":
      return { label: "Ödeme gönderimi", icon: Wallet };
    case "PAYOUT_CONFIRMED":
      return { label: "Ödeme onayı", icon: CheckCircle2 };
    default:
      return { label: "Genel bilgilendirme", icon: Bell };
  }
}

function getNotificationStatusPresentation(status: string) {
  const normalized = String(status || "").trim().toUpperCase();

  switch (normalized) {
    case "SENT":
      return {
        label: "Gönderildi",
        tone: "success" as const,
        description: "Bildirim bu cihaz için teslim edildi.",
      };
    case "FAILED":
      return {
        label: "Ulaşılamadı",
        tone: "danger" as const,
        description: "Bu denemede bildirim teslim edilemedi.",
      };
    case "CANCELLED":
      return {
        label: "İptal edildi",
        tone: "default" as const,
        description: "Bildirim gönderim öncesinde iptal edildi.",
      };
    case "PENDING":
    default:
      return {
        label: "Hazırlanıyor",
        tone: "warning" as const,
        description: "Bildirim gönderim sırasına alındı.",
      };
  }
}

function getBrowserPermissionPresentation(browserState: BrowserNotificationState | undefined) {
  if (!browserState) {
    return {
      label: "Kontrol ediliyor",
      tone: "default" as const,
      description: "Tarayıcı desteği ve izin durumu doğrulanıyor.",
    };
  }

  if (!browserState.configured) {
    return {
      label: "Yapılandırma eksik",
      tone: "warning" as const,
      description: "Firebase web push ayarları tamamlanmadan canlı bildirim alınamaz.",
    };
  }

  if (!browserState.secureContext) {
    return {
      label: "Güvenli bağlantı gerekli",
      tone: "warning" as const,
      description: "Bildirimler için siteyi HTTPS veya localhost üzerinden açmanız gerekir.",
    };
  }

  if (!browserState.supported) {
    return {
      label: "Tarayıcı desteklemiyor",
      tone: "danger" as const,
      description: "Bu tarayıcı canlı web bildirimi desteği sunmuyor.",
    };
  }

  switch (browserState.permission) {
    case "granted":
      return {
        label: "İzin verildi",
        tone: "success" as const,
        description: "Tarayıcı bildirim izni açık ve canlı bildirim almaya uygun.",
      };
    case "denied":
      return {
        label: "İzin kapalı",
        tone: "danger" as const,
        description: "Tarayıcı ayarlarından HalkYemek için bildirimi yeniden açmanız gerekir.",
      };
    default:
      return {
        label: "İzin bekleniyor",
        tone: "warning" as const,
        description: "Tarayıcıda henüz bildirim izni verilmedi.",
      };
  }
}

function getPayloadEntries(payload: Record<string, unknown>) {
  const labels: Record<string, string> = {
    order_id: "Sipariş no",
    payment_intent_id: "Yükleme kaydı",
    business_id: "İşletme no",
    payout_id: "Ödeme no",
  };

  return Object.entries(payload)
    .filter(([key, value]) => labels[key] && value !== null && typeof value !== "object")
    .slice(0, 4)
    .map(([key, value]) => ({ label: labels[key], value: String(value) }));
}

function buildTimelineLabel(notification: NotificationItem) {
  if (notification.sent_at) {
    return {
      title: "Gönderim zamanı",
      value: formatDateTime(notification.sent_at),
    };
  }

  if (notification.scheduled_at) {
    return {
      title: "Planlanan zaman",
      value: formatDateTime(notification.scheduled_at),
    };
  }

  return {
    title: "Kayıt zamanı",
    value: formatDateTime(notification.created_at),
  };
}

function getReadinessCardCopy(
  readiness: NotificationReadiness | null | undefined,
  browserState: BrowserNotificationState | undefined,
) {
  if (readiness?.notification_ready) {
    return {
      title: "Bu cihaz bildirimler için hazır",
      description: "Sipariş, bakiye ve önemli duyurular bu cihaz üzerinden takip edilebilir.",
      tone: "success" as const,
      icon: BellRing,
    };
  }

  const browserPresentation = getBrowserPermissionPresentation(browserState);
  return {
    title: "Bildirim hazırlığında tamamlanacak bir adım var",
    description: readiness?.message || browserPresentation.description,
    tone: "warning" as const,
    icon: browserPresentation.tone === "danger" ? BellOff : Bell,
  };
}

function canPrepareDevice(browserState: BrowserNotificationState | undefined) {
  if (!browserState) {
    return true;
  }
  return browserState.configured && browserState.secureContext && browserState.supported;
}

export default function NotificationsPage() {
  const searchParams = useSearchParams();
  const page = resolvePageParam(searchParams.get("page"), 1);
  const queryClient = useQueryClient();

  const readinessQuery = useQuery({
    queryKey: ["notifications", "readiness"],
    queryFn: getNotificationReadiness,
    retry: 0,
  });

  const browserStateQuery = useQuery({
    queryKey: ["notifications", "browser-state"],
    queryFn: getBrowserPushState,
    staleTime: 15_000,
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", "list", page],
    queryFn: () => getNotifications(page),
    retry: 0,
  });

  const registerMutation = useMutation({
    mutationFn: () => registerDevice(),
    onSuccess: async (result) => {
      queryClient.setQueryData(["notifications", "readiness"], result.notification_readiness);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["topup"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      toast.success("Bu cihazın bildirim ayarı güncellendi.");
    },
    onError: (error) => toast.error(describeApiError(error, "Bu cihazın bildirim ayarı güncellenemedi.")),
  });

  const notificationItems = notificationsQuery.data?.results ?? [];
  const browserPresentation = getBrowserPermissionPresentation(browserStateQuery.data);
  const browserGuidance = getBrowserGuidance(browserStateQuery.data);
  const readinessCard = getReadinessCardCopy(readinessQuery.data, browserStateQuery.data);
  const ReadinessIcon = readinessCard.icon;

  const summary = useMemo(() => {
    const sentCount = notificationItems.filter((item) => String(item.status).toUpperCase() === "SENT").length;
    const pendingCount = notificationItems.filter((item) => String(item.status).toUpperCase() === "PENDING").length;
    const failedCount = notificationItems.filter((item) => String(item.status).toUpperCase() === "FAILED").length;

    return {
      totalCount: notificationsQuery.data?.count ?? notificationItems.length,
      sentCount,
      pendingCount,
      failedCount,
    };
  }, [notificationItems, notificationsQuery.data]);

  async function handleCopyCurrentLink() {
    if (typeof window === "undefined") {
      return;
    }

    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Bildirim sayfasi baglantisi kopyalandi.");
    } catch {
      toast.error("Baglanti kopyalanamadi. Tarayici izinlerini kontrol edin.");
    }
  }

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Bildirim Merkezi"
        description="Sipariş, cüzdan ve sistem duyurularını tek ekranda takip edin. Bu sayfada hem gelen bildirimleri hem de bu cihazın canlı bildirim hazırlığını net şekilde görebilirsiniz."
      />

      <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                <Bell className="h-3.5 w-3.5" /> Bildirim özeti
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Önemli gelişmeleri tek bakışta takip edin</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                  Bu sayfada sipariş, bakiye ve duyuru bildirimleri düzenli şekilde listelenir. Her kartta ne oldu, ne zaman oldu ve sürecin hangi aşamada olduğu açıkça görünür.
                </p>
              </div>
            </div>

            <div
              className={`rounded-2xl border p-4 shadow-sm lg:max-w-sm ${
                readinessCard.tone === "success"
                  ? "border-emerald-200 bg-emerald-50/80"
                  : "border-amber-200 bg-amber-50/80"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${
                    readinessCard.tone === "success"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  <ReadinessIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-zinc-950">{readinessCard.title}</h3>
                    <StatusChip label={browserPresentation.label} tone={browserPresentation.tone} />
                  </div>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">{readinessCard.description}</p>
                </div>
              </div>

              {!readinessQuery.data?.notification_ready && canPrepareDevice(browserStateQuery.data) ? (
                <button
                  type="button"
                  onClick={() => registerMutation.mutate()}
                  disabled={registerMutation.isPending}
                  className="mt-4 inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
                >
                  {registerMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                  Bu cihazı hazırla
                </button>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam bildirim</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.totalCount}</div>
              <p className="mt-1 text-sm text-zinc-600">Hesabınıza ait en güncel bildirimler bu alanda görünür.</p>
            </div>
            <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Gönderilen</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.sentCount}</div>
              <p className="mt-1 text-sm text-zinc-600">Bu cihaza teslim edilen bildirim sayısı.</p>
            </div>
            <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Hazırlanan</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.pendingCount}</div>
              <p className="mt-1 text-sm text-zinc-600">Gönderim sırasına alınmış kayıtlar.</p>
            </div>
            <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Tarayıcı izni</div>
              <div className="mt-2 text-lg font-semibold text-zinc-950">{browserPresentation.label}</div>
              <p className="mt-1 text-sm text-zinc-600">{browserPresentation.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {browserGuidance ? (
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                  {browserStateQuery.data?.environment === "ios_home_screen_required" ? (
                    <Smartphone className="h-5 w-5" />
                  ) : (
                    <Globe className="h-5 w-5" />
                  )}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-zinc-950">{browserGuidance.title}</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{browserGuidance.description}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyCurrentLink}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
              >
                <Copy className="h-4 w-4" />
                Baglantiyi kopyala
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {browserGuidance.steps.map((step, index) => (
                <div key={step} className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Adim {index + 1}</div>
                  <div className="mt-2 font-medium text-zinc-950">{step}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {readinessQuery.isError ? (
        <ErrorState
          title="Bildirim hazırlığı alınamadı"
          description={describeApiError(readinessQuery.error, "Bu cihazın bildirim durumu şu anda alınamıyor.")}
        />
      ) : (
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              {readinessQuery.data?.notification_ready ? (
                <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-700" />
              ) : (
                <BellOff className="mt-0.5 h-5 w-5 text-amber-700" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Canlı bildirim hazırlığı</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Bu bölümde tarayıcı izni, aktif cihaz kaydı ve bildirim akışının hazır olup olmadığı özetlenir.
                </p>
              </div>
            </div>

            <div
              className={`rounded-2xl p-4 text-sm leading-6 ${
                readinessQuery.data?.notification_ready
                  ? "bg-emerald-50 text-emerald-800"
                  : "bg-amber-50 text-amber-900"
              }`}
            >
              <div className="font-medium">
                {readinessQuery.data?.notification_ready
                  ? "Bildirim akışı bu cihaz için aktif görünüyor."
                  : "Bildirim akışında tamamlanması gereken bir adım bulunuyor."}
              </div>
              <p className="mt-2">{readinessQuery.data?.message || browserPresentation.description}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Tarayıcı izni</div>
                <div className="mt-2 font-semibold text-zinc-950">{browserPresentation.label}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Aktif cihaz</div>
                <div className="mt-2 text-lg font-semibold text-zinc-950">{readinessQuery.data?.active_device_count ?? 0}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İzinli cihaz</div>
                <div className="mt-2 text-lg font-semibold text-zinc-950">{readinessQuery.data?.active_permitted_device_count ?? 0}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İzni kapalı cihaz</div>
                <div className="mt-2 text-lg font-semibold text-zinc-950">{readinessQuery.data?.denied_permission_device_count ?? 0}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950">Son bildirimler</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Her kartta bildirimin konusu, durumu ve ilgili zaman bilgisi sade bir düzenle sunulur.
          </p>
        </div>

        {notificationsQuery.isPending ? <LoadingSkeleton /> : null}
        {notificationsQuery.isError ? (
          <ErrorState
            title="Bildirimler alınamadı"
            description={describeApiError(notificationsQuery.error, "Bildirim listesi şu anda getirilemiyor.")}
          />
        ) : null}

        {notificationsQuery.data && notificationItems.length === 0 ? (
          <Card className="border-dashed border-stone-300 shadow-sm">
            <CardContent className="p-8 text-center">
              <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
                <Bell className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-zinc-950">Henüz görünür bir bildirim yok</h3>
              <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                Yeni siparişler, bakiye hareketleri ve sistem duyuruları oluştuğunda bildirimler burada listelenir. Şimdilik bu alan boşsa hesabınız için yeni bir gelişme oluşmamış demektir.
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                <Link href="/siparislerim" className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                  Siparişlerime git
                </Link>
                <Link href="/cuzdan" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                  Cüzdanı aç
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {notificationItems.length ? (
          <div className="space-y-4">
            {notificationItems.map((notification) => {
              const typePresentation = getNotificationTypePresentation(notification.type);
              const statusPresentation = getNotificationStatusPresentation(notification.status);
              const timeline = buildTimelineLabel(notification);
              const payloadEntries = getPayloadEntries(notification.payload || {});
              const TimelineIcon =
                statusPresentation.tone === "success"
                  ? CheckCircle2
                  : statusPresentation.tone === "danger"
                    ? TriangleAlert
                    : Clock3;

              return (
                <Card key={notification.id} className="border-stone-200 shadow-sm">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-4">
                        <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700">
                          <typePresentation.icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold text-zinc-950">{notification.title}</h3>
                            <StatusChip label={statusPresentation.label} tone={statusPresentation.tone} />
                            <StatusChip label={typePresentation.label} />
                          </div>
                          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{notification.body}</p>
                        </div>
                      </div>

                      <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700 lg:max-w-xs">
                        <div className="flex items-center gap-2 font-medium text-zinc-900">
                          <TimelineIcon className="h-4 w-4" />
                          Süreç özeti
                        </div>
                        <p className="mt-2 leading-6">{statusPresentation.description}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Bildirim türü</div>
                        <div className="mt-2 font-medium text-zinc-900">{typePresentation.label}</div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Oluşturulma zamanı</div>
                        <div className="mt-2 font-medium text-zinc-900">{formatDateTime(notification.created_at)}</div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">{timeline.title}</div>
                        <div className="mt-2 font-medium text-zinc-900">{timeline.value}</div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Durum açıklaması</div>
                        <div className="mt-2 font-medium text-zinc-900">{statusPresentation.description}</div>
                      </div>
                    </div>

                    {payloadEntries.length ? (
                      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                        <div className="text-sm font-medium text-zinc-900">İlgili kayıt bilgileri</div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {payloadEntries.map((entry) => (
                            <span
                              key={`${notification.id}-${entry.label}`}
                              className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700"
                            >
                              <span className="text-zinc-500">{entry.label}:</span>
                              <span className="text-zinc-900">{entry.value}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}

            <PaginationControls
              page={page}
              hasPrevious={Boolean(notificationsQuery.data?.previous)}
              hasNext={Boolean(notificationsQuery.data?.next)}
              buildHref={(nextPage) => `/bildirimler?page=${nextPage}`}
            />
          </div>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Bu sayfada ne görürsünüz?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Sipariş onayları, teslim bilgileri, bakiye güncellemeleri ve sistem duyuruları bu alanda tek bir akışta toplanır.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Her kart; konu, durum ve zaman bilgilerini birlikte gösterir. Böylece yeni bir gelişme olduğunda sayfayı hızla okuyup ne olduğunu anlayabilirsiniz.
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-start gap-3">
              <BellRing className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Canlı bildirim neden önemli?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Özellikle sipariş, QR ve bakiye akışlarında zamanında haber almak beklenmedik aksaklıkları azaltır ve kullanıcı deneyimini güçlendirir.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Tarayıcı izni açık, cihaz kaydı güncel ve ops yayınları aktif olduğunda kampanya, duyuru ve işlem bildirimleri bu cihaza daha güvenilir şekilde ulaşır.
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
