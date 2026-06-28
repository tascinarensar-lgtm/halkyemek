"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, BellRing, CheckCircle2, Loader2, Megaphone, PackageCheck, PackageOpen, ShieldCheck, TriangleAlert, Wallet } from "lucide-react";
import { toast } from "sonner";

import { CustomerBottomSection } from "@/components/layout/customer-bottom-section";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { StatusChip } from "@/components/ui/status-chip";
import { getBrowserPushState, getNotifications, getNotificationReadiness, registerDevice, showBrowserTestNotification } from "@/features/notifications/api";
import type { BrowserNotificationState, NotificationItem } from "@/features/notifications/types";
import { getBrowserGuidance, getBrowserPermissionPresentation } from "@/features/notifications/presentation";
import { resolvePageParam } from "@/features/discovery/params";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";

function getNotificationTypePresentation(type: string) {
  const normalized = String(type || "").trim().toUpperCase();

  switch (normalized) {
    case "ORDER_PAID":
      return { label: "Sipariş", icon: PackageCheck };
    case "ORDER_CONSUMED":
    case "ORDER_USED":
      return { label: "Teslim", icon: PackageCheck };
    case "SURPRISE_DEAL_RESERVED":
      return { label: "Sürpriz Paket", icon: PackageOpen };
    case "SURPRISE_DEAL_CONSUMED":
      return { label: "Teslim", icon: PackageCheck };
    case "SURPRISE_DEAL_EXPIRED":
    case "SURPRISE_DEAL_CLOSED":
      return { label: "Sürpriz Paket", icon: TriangleAlert };
    case "PAYMENT_SETTLED":
      return { label: "Cüzdan", icon: Wallet };
    case "BALANCE_LOW":
      return { label: "Bakiye", icon: TriangleAlert };
    case "SYSTEM_BROADCAST":
      return { label: "Duyuru", icon: Megaphone };
    default:
      return { label: "Bildirim", icon: Bell };
  }
}

function getNotificationStatusPresentation(status: string) {
  const normalized = String(status || "").trim().toUpperCase();

  switch (normalized) {
    case "SENT":
      return { label: "Ulaştı", tone: "success" as const };
    case "FAILED":
      return { label: "Ulaşılamadı", tone: "danger" as const };
    case "CANCELLED":
      return { label: "İptal edildi", tone: "default" as const };
    case "PENDING":
    default:
      return { label: "Hazırlanıyor", tone: "warning" as const };
  }
}

function canPrepareDevice(browserState: BrowserNotificationState | undefined) {
  if (!browserState) return true;
  if (browserState.environment === "in_app_browser" || browserState.environment === "ios_home_screen_required") return false;
  return browserState.configured && browserState.secureContext && browserState.supported;
}

function getNotificationDate(notification: NotificationItem) {
  return notification.sent_at || notification.scheduled_at || notification.created_at;
}

export default function NotificationsPage() {
  const searchParams = useSearchParams();
  const page = resolvePageParam(searchParams.get("page"), 1);
  const queryClient = useQueryClient();

  const readinessQuery = useQuery({ queryKey: ["notifications", "readiness"], queryFn: getNotificationReadiness, retry: 0 });
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
      toast.success("Bildirim ayarı güncellendi.");
    },
    onError: (error) => toast.error(describeApiError(error, "Bildirim ayarı güncellenemedi.")),
  });

  const testNotificationMutation = useMutation({
    mutationFn: showBrowserTestNotification,
    onSuccess: () => toast.success("Test bildirimi gönderildi.", { description: "PC ekranında bildirim balonu görünmelidir." }),
    onError: (error) => toast.error(describeApiError(error, "Test bildirimi gösterilemedi.")),
  });

  const notifications = useMemo(() => notificationsQuery.data?.results ?? [], [notificationsQuery.data?.results]);
  const browserPresentation = getBrowserPermissionPresentation(browserStateQuery.data);
  const browserGuidance = getBrowserGuidance(browserStateQuery.data);
  const isReady = readinessQuery.data?.notification_ready === true;
  const readyTitle = isReady ? "Bildirimler hazır" : "Bildirim iznini aç";
  const readyDescription = isReady
    ? "Sipariş, cüzdan ve sistem duyurularını bu cihazda alabilirsin."
    : browserGuidance?.description || browserPresentation.description || readinessQuery.data?.message || "Bildirimleri açarak QR ve sipariş akışındaki gelişmeleri kaçırmazsın.";
  const permissionGranted = isReady || browserStateQuery.data?.permission === "granted";

  const summary = useMemo(() => {
    const total = notificationsQuery.data?.count ?? notifications.length;
    const sent = notifications.filter((item) => String(item.status).toUpperCase() === "SENT").length;
    return { total, sent };
  }, [notifications, notificationsQuery.data?.count]);

  return (
    <PageContainer className="space-y-8 bg-white">
      <section className="overflow-hidden rounded-[30px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)] ring-1 ring-zinc-100">
        <div className="bg-[#f50555] px-5 pb-20 pt-6 text-white sm:px-7 sm:pt-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                <BellRing className="h-6 w-6" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/75">HalkYemek</p>
                <h1 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Bildirimler</h1>
              </div>
            </div>
            <span className="hidden rounded-full bg-white/14 px-4 py-2 text-xs font-semibold text-white/90 ring-1 ring-white/20 sm:inline-flex">
              Sipariş · QR · Cüzdan
            </span>
          </div>
        </div>

        <div className="-mt-14 px-4 pb-5 sm:px-6 sm:pb-6">
          <div className="rounded-[24px] border border-zinc-100 bg-white p-5 shadow-[0_18px_52px_rgba(15,23,42,0.14)] sm:p-6">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-600">Bildirim durumu</p>
                  <StatusChip label={browserPresentation.label} tone={browserPresentation.tone} />
                </div>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.06em] text-zinc-950 sm:text-4xl">{readyTitle}</h2>
                {readyDescription ? <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">{readyDescription}</p> : null}
              </div>

              <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                {!isReady && canPrepareDevice(browserStateQuery.data) ? (
                  <button
                    type="button"
                    onClick={() => registerMutation.mutate()}
                    disabled={registerMutation.isPending}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(245,5,85,0.22)] transition hover:-translate-y-0.5 hover:bg-[#dc004c] disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none"
                  >
                    {registerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Bildirim iznini aç
                  </button>
                ) : null}
                {permissionGranted ? (
                  <button
                    type="button"
                    onClick={() => testNotificationMutation.mutate()}
                    disabled={testNotificationMutation.isPending}
                    className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {testNotificationMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                    Bu cihazda test et
                  </button>
                ) : null}
              </div>
            </div>

            {browserGuidance ? (
              <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900 ring-1 ring-amber-100">
                <p className="font-semibold">{browserGuidance.title}</p>
                <ol className="mt-2 space-y-1">
                  {browserGuidance.steps.map((step) => (
                    <li key={step} className="flex gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Toplam</p>
                <p className="mt-2 text-2xl font-semibold text-zinc-950">{summary.total}</p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Gönderilen</p>
                <p className="mt-2 text-2xl font-semibold text-zinc-950">{summary.sent}</p>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Bildirim izni</p>
                <p className="mt-2 text-lg font-semibold text-zinc-950">{permissionGranted ? "Verildi" : "Verilmedi"}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {readinessQuery.isError ? (
        <ErrorState title="Bildirim durumu alınamadı" description="Bu cihazın bildirim ayarı şu anda kontrol edilemiyor. Sayfayı yenileyip tekrar deneyebilirsin." />
      ) : null}

      {notificationsQuery.isPending ? <LoadingSkeleton /> : null}
      {notificationsQuery.isError ? (
        <ErrorState title="Bildirimler yüklenemedi" description="Bildirim listesi şu anda getirilemiyor. Sayfayı yenileyip tekrar deneyebilirsin." />
      ) : null}

      {notificationsQuery.data && notifications.length === 0 ? (
        <section className="rounded-[28px] border border-zinc-100 bg-white p-8 text-center shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
          <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555]">
            {isReady ? <Bell className="h-6 w-6" /> : <BellOff className="h-6 w-6" />}
          </div>
          <h2 className="mt-4 text-xl font-semibold tracking-[-0.04em] text-zinc-950">Henüz bildirim yok</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-zinc-500">
            Sipariş, cüzdan veya sistem duyurusu geldiğinde burada sade bir liste halinde görünecek.
          </p>
        </section>
      ) : null}

      {notifications.length > 0 ? (
        <section className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)] sm:p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-900">Son bildirimler</h2>
            <span className="w-fit rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-500">{summary.total} kayıt</span>
          </div>

          <div className="divide-y divide-zinc-100">
            {notifications.map((notification) => {
              const typePresentation = getNotificationTypePresentation(notification.type);
              const statusPresentation = getNotificationStatusPresentation(notification.status);
              const TypeIcon = typePresentation.icon;

              return (
                <article key={notification.id} className="flex gap-3 py-5 first:pt-0 last:pb-0 sm:gap-4">
                  <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-50 text-zinc-700 ring-1 ring-zinc-100">
                    <TypeIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 max-w-full break-words text-base font-semibold text-zinc-950">{notification.title}</h3>
                      <StatusChip label={typePresentation.label} />
                      <StatusChip label={statusPresentation.label} tone={statusPresentation.tone} />
                    </div>
                    <p className="mt-2 text-sm leading-6 text-zinc-500">{notification.body}</p>
                    <p className="mt-3 text-xs font-medium text-zinc-400">{formatDateTime(getNotificationDate(notification))}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <PaginationControls
            page={page}
            hasPrevious={Boolean(notificationsQuery.data?.previous)}
            hasNext={Boolean(notificationsQuery.data?.next)}
            buildHref={(nextPage) => `/bildirimler?page=${nextPage}`}
          />
        </section>
      ) : null}

      <CustomerBottomSection />
    </PageContainer>
  );
}
