"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ActiveCheckoutSessionCard } from "@/components/checkout/active-checkout-session-card";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getLatestCheckoutSession } from "@/features/cart/api";
import { buildUpdatedSearchParams, resolvePageParam } from "@/features/discovery/params";
import { getOrders } from "@/features/orders/api";
import type { Order } from "@/features/orders/types";
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
  PAID: "Ödeme alındı",
  USED: "Teslim edildi",
  PENDING: "Hazırlanıyor",
  INITIATED: "İşlem başladı",
  CANCELLED: "İptal edildi",
  FAILED: "İşlem tamamlanamadı",
  EXPIRED: "Süresi doldu",
};

const sourceLabelMap: Record<string, string> = {
  cart_checkout_qr_order: "HalkYemek QR siparişi",
};

function resolveStatusLabel(status: string) {
  return statusLabelMap[status] || "Durum bilgisi hazırlanıyor";
}

function resolveSourceLabel(contract: string | undefined) {
  if (!contract) {
    return "HalkYemek sipariş akışı";
  }
  return sourceLabelMap[contract] || "HalkYemek sipariş akışı";
}

function resolveActiveFilterLabel(status: string | undefined) {
  if (!status) {
    return "Tüm siparişler";
  }
  return resolveStatusLabel(status);
}

function buildOrderMeta(order: Order) {
  const parts = [`${order.item_count} ürün`, `Sipariş tarihi: ${formatDateTime(order.created_at)}`];
  if (order.paid_at) {
    parts.push(`Ödeme zamanı: ${formatDateTime(order.paid_at)}`);
  }
  if (order.used_at) {
    parts.push(`Teslim zamanı: ${formatDateTime(order.used_at)}`);
  }
  return parts.join(" · ");
}

export default function OrdersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = {
    status: searchParams.get("status") || undefined,
    search: searchParams.get("search") || undefined,
    ordering: searchParams.get("ordering") || undefined,
    page: resolvePageParam(searchParams.get("page"), 1),
  };

  const ordersQuery = useQuery({
    queryKey: ["orders", filters],
    queryFn: () => getOrders(filters),
    retry: 0,
  });

  const latestSessionQuery = useQuery({
    queryKey: ["checkout-session", "latest"],
    queryFn: getLatestCheckoutSession,
    retry: 0,
  });

  function updateFilters(formData: FormData) {
    const next = buildUpdatedSearchParams(searchParams, {
      status: String(formData.get("status") || ""),
      search: String(formData.get("search") || ""),
      ordering: String(formData.get("ordering") || ""),
      page: 1,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  function buildPageHref(page: number) {
    const next = buildUpdatedSearchParams(searchParams, { page });
    const serialized = next.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
  }

  const totalOrders = ordersQuery.data?.count ?? 0;
  const shownOrders = ordersQuery.data?.results.length ?? 0;
  const activeFilterLabel = resolveActiveFilterLabel(filters.status);

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Siparişlerim"
        description="Geçmiş siparişlerini burada düzenli şekilde görebilir, ödeme ve teslim durumlarını takip edebilir, istersen ayrıntı ekranına geçebilirsin."
        actions={
          <Link href="/isletmeler" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Yeni menülere bak
          </Link>
        }
      />

      {latestSessionQuery.data ? (
        <ActiveCheckoutSessionCard
          session={latestSessionQuery.data}
          title="Henüz okutulmamış bir QR kodun var"
          description="Bu sipariş henüz teslim edilmediği için listede görünmüyor olabilir. İstersen QR ekranına dönerek aynı akıştan kaldığın yerden devam edebilirsin."
          primaryHref={`/checkout/${latestSessionQuery.data.token}`}
          primaryLabel="QR ekranına git"
          secondaryHref="/sepet"
          secondaryLabel="Sepet özetini aç"
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-stone-200">
          <CardContent className="space-y-2 p-5">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam sipariş</div>
            <div className="text-2xl font-semibold text-zinc-950">{totalOrders}</div>
            <p className="text-sm leading-6 text-zinc-600">Hesabında oluşmuş tüm sipariş kayıtları burada toplanır.</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200">
          <CardContent className="space-y-2 p-5">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bu sayfada görünen</div>
            <div className="text-2xl font-semibold text-zinc-950">{shownOrders}</div>
            <p className="text-sm leading-6 text-zinc-600">Seçtiğin arama ve sıralama ölçülerine göre listelenen kayıt sayısı.</p>
          </CardContent>
        </Card>
        <Card className="border-stone-200">
          <CardContent className="space-y-2 p-5">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Seçili görünüm</div>
            <div className="text-lg font-semibold text-zinc-950">{activeFilterLabel}</div>
            <p className="text-sm leading-6 text-zinc-600">İstersen durum filtresini değiştirerek farklı siparişleri hızlıca ayırabilirsin.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200">
        <CardContent className="space-y-5 p-5">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-zinc-950">Siparişlerini ara ve süz</h2>
            <p className="text-sm leading-6 text-zinc-600">
              İşletme adına, sipariş durumuna veya sıralama tercihine göre istediğin kayıtları daha hızlı bulabilirsin.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              updateFilters(new FormData(event.currentTarget));
            }}
            className="grid gap-3 md:grid-cols-4"
          >
            <input
              name="search"
              defaultValue={filters.search || ""}
              placeholder="İşletme veya menü adına göre ara"
              className="rounded-xl border border-zinc-300 px-3 py-2 text-sm md:col-span-2"
            />
            <select name="status" defaultValue={filters.status || ""} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm">
              <option value="">Tüm sipariş durumları</option>
              <option value="PAID">Ödeme alındı</option>
              <option value="USED">Teslim edildi</option>
              <option value="FAILED">İşlem tamamlanamadı</option>
              <option value="CANCELLED">İptal edildi</option>
              <option value="EXPIRED">Süresi doldu</option>
            </select>
            <select name="ordering" defaultValue={filters.ordering || "-created_at"} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm">
              <option value="-created_at">En yeni siparişler</option>
              <option value="created_at">En eski siparişler</option>
              <option value="-paid_at">Ödeme tarihi en yeni</option>
              <option value="status">Duruma göre sırala</option>
            </select>
            <div className="flex gap-2 md:col-span-4">
              <button type="submit" className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Sonuçları göster
              </button>
              <Link href="/siparislerim" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Filtreleri temizle
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {ordersQuery.isPending ? <LoadingSkeleton /> : null}
      {ordersQuery.isError ? (
        <ErrorState
          title="Siparişler yüklenemedi"
          description={describeApiError(ordersQuery.error, "Sipariş bilgileri şu anda getirilemedi. Lütfen biraz sonra tekrar dene.")}
        />
      ) : null}
      {ordersQuery.data && ordersQuery.data.results.length === 0 ? (
        <EmptyState
          title="Bu ölçülere uyan sipariş bulunamadı"
          description="Farklı bir arama sözcüğü veya başka bir durum filtresi seçerek siparişlerini yeniden listeleyebilirsin."
        />
      ) : null}

      {ordersQuery.data?.results.length ? (
        <div className="space-y-4">
          {ordersQuery.data.results.map((order) => {
            const businessName = repairPotentialMojibake(order.business_name);
            const statusLabel = resolveStatusLabel(order.status);
            const sourceLabel = resolveSourceLabel(String(order.source?.contract || ""));

            return (
              <Card key={order.id} className="border-stone-200">
                <CardContent className="space-y-4 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-zinc-950">
                          #{order.id} · {businessName}
                        </h2>
                        <StatusChip label={statusLabel} tone={statusToneMap[order.status] || "default"} />
                      </div>
                      <p className="mt-1 text-sm leading-6 text-zinc-600">{buildOrderMeta(order)}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-xs uppercase tracking-wide text-zinc-500">Toplam ödeme</p>
                      <AmountText amount={order.total_charged_amount} />
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-3">
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Sipariş türü</div>
                      <div className="mt-2 font-medium text-zinc-900">{sourceLabel}</div>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Ürün adedi</div>
                      <div className="mt-2 font-medium text-zinc-900">{order.item_count}</div>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Son durum</div>
                      <div className="mt-2 font-medium text-zinc-900">{statusLabel}</div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm leading-6 text-zinc-500">
                      Bu siparişin ürünlerini, ödeme bilgisini ve teslim ayrıntılarını detay ekranında görebilirsin.
                    </div>
                    <Link href={`/siparislerim/${order.id}`} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                      Siparişi incele
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <PaginationControls
            page={filters.page}
            hasPrevious={Boolean(ordersQuery.data.previous)}
            hasNext={Boolean(ordersQuery.data.next)}
            buildHref={buildPageHref}
          />
        </div>
      ) : null}
    </PageContainer>
  );
}
