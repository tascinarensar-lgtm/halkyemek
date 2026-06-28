"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Clock3, PackageOpen, QrCode, ReceiptText, ShoppingBag, Store } from "lucide-react";

import { ActiveCheckoutSessionCard } from "@/components/checkout/active-checkout-session-card";
import { CustomerBottomSection } from "@/components/layout/customer-bottom-section";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { AmountText } from "@/components/ui/amount-text";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { StatusChip } from "@/components/ui/status-chip";
import { getLatestCheckoutSession } from "@/features/cart/api";
import { buildUpdatedSearchParams, resolvePageParam } from "@/features/discovery/params";
import { getOrders } from "@/features/orders/api";
import type { Order } from "@/features/orders/types";
import { useSession } from "@/hooks/use-session";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

const statusToneMap: Record<string, "default" | "success" | "warning" | "danger"> = {
  PAID: "success",
  USED: "success",
  PENDING: "warning",
  INITIATED: "warning",
  CANCELLED: "danger",
  FAILED: "danger",
  EXPIRED: "danger",
};

const statusLabelMap: Record<string, string> = {
  PAID: "\u00d6deme al\u0131nd\u0131",
  USED: "Teslim edildi",
  PENDING: "Haz\u0131rlan\u0131yor",
  INITIATED: "\u0130\u015flem ba\u015flad\u0131",
  CANCELLED: "\u0130ptal edildi",
  FAILED: "\u0130\u015flem tamamlanamad\u0131",
  EXPIRED: "S\u00fcresi doldu",
};

function resolveStatusLabel(status: string) {
  return statusLabelMap[status] || "Durum haz\u0131rlan\u0131yor";
}

function isOrderDelivered(order: Order) {
  return order.status === "USED" || Boolean(order.used_at || order.checkout_session_consumed_at);
}

function isActiveCheckoutSessionStatus(status?: string | null) {
  return Boolean(status && !["CONSUMED", "EXPIRED", "CANCELLED"].includes(status));
}

function getMinuteKey(value?: string | null) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  return String(Math.floor(time / 60_000));
}

function isSameMinute(left?: string | null, right?: string | null) {
  const leftKey = getMinuteKey(left);
  const rightKey = getMinuteKey(right);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

function buildOrderTimeline(order: Order) {
  const items: Array<{ label: string; value: string; icon: "date" | "clock" }> = [];
  const qrCreatedAt = order.checkout_session_created_at || order.created_at;
  const paidAt = order.paid_at || null;
  const usedAt = order.used_at || null;

  if (!paidAt || !isSameMinute(qrCreatedAt, paidAt)) {
    items.push({ label: "QR olu\u015fturuldu", value: formatDateTime(qrCreatedAt), icon: "date" });
  }

  if (paidAt) {
    items.push({ label: "\u00d6deme onay\u0131", value: formatDateTime(paidAt), icon: "date" });
  }

  if (isOrderDelivered(order)) {
    const deliveryAt = usedAt || order.checkout_session_consumed_at || paidAt || order.created_at;
    items.push({
      label: "Teslim tamamland\u0131",
      value: isSameMinute(deliveryAt, paidAt) ? "\u00d6deme ile birlikte" : formatDateTime(deliveryAt),
      icon: "date",
    });
    return items;
  }

  if (order.status === "PAID" && order.expires_at) {
    items.push({ label: "QR son ge\u00e7erlilik", value: formatDateTime(order.expires_at), icon: "clock" });
    return items;
  }

  if (order.status === "EXPIRED" && order.expires_at) {
    items.push({ label: "S\u00fcre doldu", value: formatDateTime(order.expires_at), icon: "clock" });
    return items;
  }

  if (["CANCELLED", "FAILED"].includes(order.status)) {
    items.push({ label: "Son durum", value: formatDateTime(order.expires_at || order.paid_at || order.created_at), icon: "clock" });
  }

  if (items.length === 0) {
    items.push({ label: "Sipari\u015f kayd\u0131", value: formatDateTime(order.created_at), icon: "date" });
  }

  return items;
}
function getOrderPreviewItems(order: Order) {
  return order.order_items.slice(0, 3).map((item) => `${item.quantity}x ${getOrderItemDisplayName(item)}`);
}

function isSurpriseOrder(order: Order) {
  return order.source?.source_type === "SURPRISE_DEAL" || order.order_items.some((item) => item.item_type === "SURPRISE_DEAL" || item.source_type === "SURPRISE_DEAL");
}

function getOrderItemDisplayName(item: Order["order_items"][number]) {
  return repairPotentialMojibake(item.display_name || item.menu_item_name || "Sürpriz Paket");
}

export default function OrdersPage() {
  const searchParams = useSearchParams();
  const sessionQuery = useSession();
  const page = resolvePageParam(searchParams.get("page"), 1);
  const currentUserId = sessionQuery.data?.user?.id ?? null;

  const ordersQuery = useQuery({
    queryKey: ["orders", "customer", { page, user: currentUserId }],
    queryFn: () => getOrders({ page, user: currentUserId ?? undefined }),
    enabled: Boolean(currentUserId),
    retry: 0,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const latestSessionQuery = useQuery({
    queryKey: ["checkout-session", "latest"],
    queryFn: getLatestCheckoutSession,
    retry: 0,
    enabled: Boolean(currentUserId),
    refetchInterval: (query) => {
      const session = query.state.data;
      return session && isActiveCheckoutSessionStatus(session.status) ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  function buildPageHref(nextPage: number) {
    const next = buildUpdatedSearchParams(searchParams, { page: nextPage });
    const serialized = next.toString();
    return serialized ? `/siparislerim?${serialized}` : "/siparislerim";
  }

  const totalOrders = ordersQuery.data?.count ?? 0;
  const shownOrders = ordersQuery.data?.results.length ?? 0;
  const completedOrders = ordersQuery.data?.results.filter((order) => order.status === "USED").length ?? 0;
  const activeLatestSession = latestSessionQuery.data && isActiveCheckoutSessionStatus(latestSessionQuery.data.status) ? latestSessionQuery.data : null;

  if (!sessionQuery.isPending && !currentUserId) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState title={"Oturum a\u00e7man gerekiyor"} description={"Ki\u015fisel sipari\u015f ge\u00e7mi\u015fini g\u00f6r\u00fcnt\u00fclemek i\u00e7in giri\u015f yapmal\u0131s\u0131n."} />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-7 bg-white sm:space-y-8">
      <section className="relative overflow-hidden rounded-[34px] bg-zinc-950 px-5 py-7 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)] sm:px-8 lg:px-10">
        <div className="pointer-events-none absolute -right-24 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-[#f50555]/28 blur-2xl" />
        <div className="pointer-events-none absolute left-8 top-8 h-28 w-28 rounded-full bg-white/8 blur-xl" />
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/82 ring-1 ring-white/12">
              <ReceiptText className="h-3.5 w-3.5" />
              {"Sipari\u015f ge\u00e7mi\u015fi"}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.045em] sm:text-4xl">{"Sipari\u015flerim"}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-white/68">{"Aktif QR kartlar\u0131n\u0131, teslim edilen sipari\u015fleri ve ge\u00e7mi\u015f kay\u0131tlar\u0131n\u0131 tek ekranda sade bi\u00e7imde takip et."}</p>
          </div>

          <Link
            href="/#mutfaklar"
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-zinc-950 shadow-[0_18px_36px_rgba(0,0,0,0.20)] transition hover:-translate-y-0.5 hover:bg-rose-50 sm:w-auto"
          >
            {"Yeni men\u00fclere bak"}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {activeLatestSession ? (
        <ActiveCheckoutSessionCard
          session={activeLatestSession}
          title={"Hen\u00fcz okutulmam\u0131\u015f bir QR kodun var"}
          description={"Bu QR işletmede okutulmayı bekliyor. QR okunmazsa kasa kodu da kullanılabilir."}
          primaryHref={`/checkout/${activeLatestSession.token}`}
          primaryLabel={"QR ekran\u0131na git"}
        />
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-[24px] border border-zinc-100 bg-[linear-gradient(180deg,#fff,#fafafa)] p-5 shadow-[0_16px_42px_rgba(15,23,42,0.045)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555]">
              <ShoppingBag className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{"Toplam sipari\u015f"}</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-950">{totalOrders}</p>
            </div>
          </div>
        </div>
        <div className="rounded-[24px] border border-zinc-100 bg-[linear-gradient(180deg,#fff,#fafafa)] p-5 shadow-[0_16px_42px_rgba(15,23,42,0.045)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555]">
              <QrCode className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Teslim edilen</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-950">{completedOrders}</p>
            </div>
          </div>
        </div>
        <div className="rounded-[24px] border border-zinc-100 bg-[linear-gradient(180deg,#fff,#fafafa)] p-5 shadow-[0_16px_42px_rgba(15,23,42,0.045)]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555]">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{"G\u00f6sterilen"}</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-950">{shownOrders}</p>
            </div>
          </div>
        </div>
      </section>

      {sessionQuery.isPending || ordersQuery.isPending ? <LoadingSkeleton /> : null}

      {ordersQuery.isError ? (
        <ErrorState
          title={"Sipari\u015fler y\u00fcklenemedi"}
          description={describeApiError(ordersQuery.error, "Sipari\u015f bilgileri \u015fu anda getirilemedi. L\u00fctfen biraz sonra tekrar dene.")}
        />
      ) : null}

      {ordersQuery.data && ordersQuery.data.results.length === 0 ? (
        <EmptyState title={"Hen\u00fcz sipari\u015fin yok"} description={"Bir men\u00fc se\u00e7ip QR ak\u0131\u015f\u0131n\u0131 tamamlad\u0131\u011f\u0131nda sipari\u015flerin burada listelenecek."} />
      ) : null}

      {ordersQuery.data?.results.length ? (
        <section className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950">{"Ge\u00e7mi\u015f sipari\u015fler"}</h2>
            <span className="w-fit rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-[#f50555] ring-1 ring-rose-100">
              {shownOrders} {"kay\u0131t g\u00f6steriliyor"}
            </span>
          </div>

          <div className="space-y-3">
            {ordersQuery.data.results.map((order) => {
              const businessName = repairPotentialMojibake(order.business_name);
              const isSurprise = isSurpriseOrder(order);
              const statusLabel = isOrderDelivered(order) ? "Teslim edildi" : resolveStatusLabel(order.status);
              const timeline = buildOrderTimeline(order);
              const previewItems = getOrderPreviewItems(order);
              const extraItemCount = Math.max(order.order_items.length - previewItems.length, 0);

              return (
                <Link
                  key={order.id}
                  href={`/siparislerim/${order.id}`}
                  className="group block rounded-[28px] border border-zinc-100 bg-white p-4 shadow-[0_18px_54px_rgba(15,23,42,0.045)] transition hover:-translate-y-0.5 hover:border-[#f50555]/20 hover:shadow-[0_24px_64px_rgba(15,23,42,0.08)] sm:p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555] ring-1 ring-rose-100 transition group-hover:bg-[#f50555] group-hover:text-white">
                          {isSurprise ? <PackageOpen className="h-5 w-5" /> : <Store className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-xl font-semibold tracking-[-0.035em] text-zinc-950">{businessName}</h3>
                          <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{"Sipari\u015f #"}{order.id}</p>
                        </div>
                        <StatusChip label={statusLabel} tone={statusToneMap[order.status] || "default"} />
                        {isSurprise ? <StatusChip label="Sürpriz Paket" tone="warning" /> : null}
                      </div>

                      <div className="mt-4 grid gap-2 text-sm text-zinc-600 md:grid-cols-2 xl:grid-cols-3">
                        {timeline.map((item) => (
                          <div key={`${item.label}-${item.value}`} className="flex items-start gap-2 rounded-2xl bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-100">
                            {item.icon === "clock" ? <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" /> : <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />}
                            <span>
                              <span className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{item.label}</span>
                              <span className="mt-0.5 block font-medium text-zinc-700">{item.value}</span>
                            </span>
                          </div>
                        ))}
                      </div>

                      {previewItems.length > 0 ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          {previewItems.map((item) => (
                            <span key={item} className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700">
                              {item}
                            </span>
                          ))}
                          {extraItemCount > 0 ? (
                            <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-500">
                              +{extraItemCount} {"\u00fcr\u00fcn"}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-[24px] bg-zinc-950 p-4 text-white shadow-[0_18px_44px_rgba(15,23,42,0.14)] lg:min-w-[220px]">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/55">{"Toplam \u00f6deme"}</p>
                      <p className="mt-1 text-xl font-semibold text-white sm:text-2xl">
                        <AmountText amount={order.total_charged_amount} />
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          <PaginationControls
            page={page}
            hasPrevious={Boolean(ordersQuery.data.previous)}
            hasNext={Boolean(ordersQuery.data.next)}
            buildHref={buildPageHref}
          />
        </section>
      ) : null}

      <CustomerBottomSection />
    </PageContainer>
  );
}
