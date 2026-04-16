"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BadgePercent, CalendarRange, Clock3, Coins, Receipt, SearchCheck, ShieldCheck, Wallet } from "lucide-react";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getBusinessConsumeHistory } from "@/features/business-operations/api";
import { buildUpdatedSearchParams } from "@/features/discovery/params";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

function getOrderTone(status: string) {
  switch (status) {
    case "USED":
    case "PAID":
      return "success" as const;
    case "CANCELLED":
    case "EXPIRED":
      return "danger" as const;
    default:
      return "default" as const;
  }
}

function getOrderLabel(status: string) {
  switch (status) {
    case "USED":
      return "Teslim edildi";
    case "PAID":
      return "Ödeme alındı";
    case "CANCELLED":
      return "İptal edildi";
    case "EXPIRED":
      return "Süresi doldu";
    default:
      return status || "Durum bilgisi yok";
  }
}

function getEarningLabel(status: string | null | undefined) {
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

export default function BusinessConsumeHistoryPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const pageParam = Number(searchParams.get("page") || "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const filters = {
    consumed_after: searchParams.get("consumed_after") || undefined,
    consumed_before: searchParams.get("consumed_before") || undefined,
    page,
  };

  const historyQuery = useQuery({
    queryKey: ["business-operations", businessId, "consume-history", filters],
    queryFn: () => getBusinessConsumeHistory(businessId, filters),
    enabled: hasValidBusinessId,
  });

  const summary = useMemo(() => {
    const rows = historyQuery.data?.results ?? [];
    return rows.reduce(
      (accumulator, item) => {
        accumulator.count += 1;
        accumulator.totalCharged += item.order.total_charged_amount || item.total_payable_amount || 0;
        accumulator.totalNet += item.order.business_net_amount || 0;
        accumulator.totalPlatformFee += item.order.business_fee_amount || 0;
        accumulator.totalCustomerFee += item.order.customer_fee_amount || 0;
        return accumulator;
      },
      {
        count: 0,
        totalCharged: 0,
        totalNet: 0,
        totalPlatformFee: 0,
        totalCustomerFee: 0,
      },
    );
  }, [historyQuery.data]);

  function updateFilters(formData: FormData) {
    const next = buildUpdatedSearchParams(searchParams, {
      consumed_after: String(formData.get("consumed_after") || ""),
      consumed_before: String(formData.get("consumed_before") || ""),
      page: 1,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  function buildPageHref(nextPage: number) {
    const next = buildUpdatedSearchParams(searchParams, { page: nextPage });
    const serialized = next.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
  }

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader
            title="İşlem geçmişi"
            description="Kasada doğrulanmış siparişleri, toplam tahsilatı, platform kesintisini ve işletmeye yansıyacak net tutarı tek ekranda takip edebilirsin."
          />

          {!hasValidBusinessId ? (
            <ErrorState title="Geçersiz işletme" description="URL içindeki işletme bilgisi okunamadı. İşletme paneline güvenli giriş yapıp tekrar dene." />
          ) : null}

          {hasValidBusinessId ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-zinc-950 p-2.5 text-white">
                        <Receipt className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Tamamlanan doğrulama kayıtları</h2>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">
                          Bu ekran, kasada doğrulanmış tüm siparişleri listeler. Hangi siparişin ne zaman işlendiğini, işletmeye ne kadar net tutar
                          yansıdığını ve ödeme sürecindeki hakediş durumunu buradan izlersin.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Görünen kayıt</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.count}</div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam tahsilat</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">
                          <AmountText amount={summary.totalCharged} />
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Net işletme tutarı</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">
                          <AmountText amount={summary.totalNet} />
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam platform kesintisi</div>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">
                          <AmountText amount={summary.totalPlatformFee} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <ShieldCheck className="h-4 w-4" /> Bu ekran neyi gösterir?
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      İşlem geçmişi, yalnızca kasada doğrulanmış siparişleri gösterir. Buradaki her kayıt için sipariş tutarı, müşteri ücreti, platform
                      kesintisi, net işletme alacağı ve hakediş aşaması birlikte görülür.
                    </div>
                    <div className="space-y-3 text-sm text-zinc-200">
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                        <span>Müşteri ücretleri toplamı</span>
                        <AmountText amount={summary.totalCustomerFee} />
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                        <span>Filtre durumu</span>
                        <span className="font-medium text-white">
                          {filters.consumed_after || filters.consumed_before ? "Tarih filtresi aktif" : "Tüm kayıtlar"}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-stone-200 shadow-sm">
                <CardContent className="p-6">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      updateFilters(new FormData(event.currentTarget));
                    }}
                    className="grid gap-4 md:grid-cols-[1fr_1fr_auto]"
                  >
                    <label className="space-y-2">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800">
                        <CalendarRange className="h-4 w-4" />
                        Başlangıç zamanı
                      </span>
                      <input
                        name="consumed_after"
                        type="datetime-local"
                        defaultValue={filters.consumed_after || ""}
                        className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-950"
                      />
                    </label>
                    <label className="space-y-2">
                      <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-800">
                        <Clock3 className="h-4 w-4" />
                        Bitiş zamanı
                      </span>
                      <input
                        name="consumed_before"
                        type="datetime-local"
                        defaultValue={filters.consumed_before || ""}
                        className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-950"
                      />
                    </label>
                    <div className="flex flex-col justify-end gap-3 md:flex-row">
                      <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800">
                        <SearchCheck className="h-4 w-4" />
                        Listeyi güncelle
                      </button>
                      <Link href={pathname} className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                        Filtreleri temizle
                      </Link>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </>
          ) : null}

          {hasValidBusinessId && historyQuery.isPending ? <LoadingSkeleton /> : null}
          {hasValidBusinessId && historyQuery.isError ? (
            <ErrorState
              title="İşlem geçmişi yüklenemedi"
              description={`${getApiErrorMessage(historyQuery.error)}${getApiRequestId(historyQuery.error) ? ` · request_id: ${getApiRequestId(historyQuery.error)}` : ""}`}
            />
          ) : null}

          {hasValidBusinessId && historyQuery.data && historyQuery.data.results.length === 0 ? (
            <div className="space-y-4">
              <EmptyState
                title="Bu aralıkta kayıt görünmüyor"
                description="Kasada doğrulanmış siparişler burada listelenir. Henüz işlem yapılmadıysa ya da seçtiğin tarih aralığında kayıt yoksa bu alan boş görünür."
              />
              <Card className="border-stone-200">
                <CardContent className="space-y-3 p-6 text-sm leading-6 text-zinc-600">
                  <p className="font-medium text-zinc-900">Ne zaman dolmaya başlar?</p>
                  <p>
                    Müşteri QR kodu kasada doğrulanıp teslim onayı verildiğinde kayıt bu ekrana düşer. İstersen işletme panelindeki QR okutma alanından
                    yeni bir deneme yaparak akışı test edebilirsin.
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {historyQuery.data?.results.length ? (
            <div className="space-y-4">
              {historyQuery.data.results.map((item) => (
                <Card key={item.checkout_session_id} className="border-stone-200 shadow-sm">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-semibold text-zinc-950">İşlem #{item.checkout_session_id}</h2>
                          <StatusChip label={getOrderLabel(item.order.status)} tone={getOrderTone(item.order.status)} />
                          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600">
                            Kasa kodu: {item.checkout_session_cashier_code || "-"}
                          </span>
                        </div>
                        <p className="text-sm leading-6 text-zinc-600">
                          İşlem zamanı {formatDateTime(item.consumed_at)}. Kasada onaylayan kullanıcı: {item.consumed_by_user_id ?? "-"} · Müşteri hesabı:{" "}
                          {item.customer_user_id ?? "-"}.
                        </p>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[360px]">
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam tahsilat</div>
                          <div className="mt-2 text-xl font-semibold text-zinc-950">
                            <AmountText amount={item.order.total_charged_amount || item.total_payable_amount} />
                          </div>
                        </div>
                        <div className="rounded-2xl bg-emerald-50 p-4">
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">Net işletme tutarı</div>
                          <div className="mt-2 text-xl font-semibold text-emerald-900">
                            <AmountText amount={item.order.business_net_amount || item.earning?.net_amount || 0} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                          <Wallet className="h-3.5 w-3.5" />
                          Menülerin toplamı
                        </div>
                        <div className="mt-2 text-base font-semibold text-zinc-950">
                          <AmountText amount={item.order.subtotal_amount} />
                        </div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                          <Coins className="h-3.5 w-3.5" />
                          Müşteri ücreti
                        </div>
                        <div className="mt-2 text-base font-semibold text-zinc-950">
                          <AmountText amount={item.order.customer_fee_amount} />
                        </div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                          <BadgePercent className="h-3.5 w-3.5" />
                          Platform kesintisi
                        </div>
                        <div className="mt-2 text-base font-semibold text-zinc-950">
                          <AmountText amount={item.order.business_fee_amount} />
                        </div>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
                          <Receipt className="h-3.5 w-3.5" />
                          Hakediş durumu
                        </div>
                        <div className="mt-2 text-sm font-semibold text-zinc-950">{getEarningLabel(item.earning?.status)}</div>
                        <p className="mt-1 text-sm text-zinc-500">
                          Ödemeye esas kalan: <AmountText amount={item.earning?.outstanding_amount ?? item.order.business_net_amount} />
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <p>Sipariş ödeme zamanı: {formatDateTime(item.order.paid_at)}</p>
                        <p>Hakedişin uygun olacağı zaman: {formatDateTime(item.earning?.eligible_at ?? null)}</p>
                      </div>
                      <div className="space-y-1 lg:text-right">
                        <p>
                          Bağlı payout kaydı: {item.earning?.payout?.id ? `#${item.earning.payout.id} · ${item.earning.payout.status}` : "Henüz oluşmadı"}
                        </p>
                        <p>Ürün adedi: {item.item_count}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {item.order.id ? (
                        <Link href={`/isletme/${businessId}/siparisler/${item.order.id}`} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                          Sipariş detayını aç
                        </Link>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              ))}

              <PaginationControls page={page} hasPrevious={Boolean(historyQuery.data.previous)} hasNext={Boolean(historyQuery.data.next)} buildHref={buildPageHref} />

              <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-stone-200">
                  <CardContent className="space-y-3 p-6 text-sm leading-6 text-zinc-600">
                    <p className="font-medium text-zinc-900">Bu sayfa ne için kullanılır?</p>
                    <p>
                      Gün sonu kontrolü yaparken hangi siparişten ne kadar tahsil edildiğini, hangi tutarın platform kesintisi olduğunu ve işletmeye ne kadar
                      net bakiye yazıldığını tek ekranda görebilirsin.
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-stone-200">
                  <CardContent className="space-y-3 p-6 text-sm leading-6 text-zinc-600">
                    <p className="font-medium text-zinc-900">Hakediş ve payout ilişkisi</p>
                    <p>
                      Bir sipariş doğrulandıktan sonra hakediş kaydı oluşur. Bu kayıt önce bekler, ardından ödemeye uygun hale gelir ve payout sürecine
                      alındığında buradaki durum alanlarında görünür.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : null}
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
