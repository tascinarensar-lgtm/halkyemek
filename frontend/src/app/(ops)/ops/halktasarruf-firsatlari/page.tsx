"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Box, Clock, PackageOpen, Search, ShieldCheck, Store } from "lucide-react";
import { toast } from "sonner";

import { OpsActionResult, OpsEmpty, OpsErrorCard, OpsMetricCard, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { AmountText } from "@/components/ui/amount-text";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { closeOpsSurpriseDeal, getOpsSurpriseDealDetail, listOpsSurpriseDeals } from "@/features/ops-console/api";
import type { OpsSurpriseDealItem } from "@/features/ops-console/types";
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";
import { formatDateTime } from "@/lib/utils/format";

const STATUS_OPTIONS = [
  { value: "", label: "Tüm durumlar" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "PAUSED", label: "Duraklatılmış" },
  { value: "DRAFT", label: "Taslak" },
  { value: "CLOSED", label: "Kapalı" },
  { value: "EXPIRED", label: "Süresi doldu" },
  { value: "CANCELLED", label: "İptal edildi" },
];

const BOOLEAN_OPTIONS = [
  { value: "", label: "Fark etmez" },
  { value: "true", label: "Evet" },
  { value: "false", label: "Hayır" },
];

function stockLabel(deal: OpsSurpriseDealItem) {
  if (deal.quantity_remaining <= 0) return "Tükendi";
  if (deal.quantity_reserved > 0) return `${deal.quantity_remaining} kaldı, ${deal.quantity_reserved} rezerve`;
  return `${deal.quantity_remaining} kaldı`;
}

function shouldAllowClose(deal: OpsSurpriseDealItem | null | undefined) {
  if (!deal) return false;
  return deal.status !== "CLOSED" && deal.quantity_reserved <= 0;
}

function CompactStat({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: "neutral" | "danger" | "success" | "warning" }) {
  const toneClass = {
    neutral: "bg-zinc-50 text-zinc-700",
    danger: "bg-rose-50 text-[#f50555]",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
  }[tone];

  return (
    <div className={cn("rounded-2xl px-3 py-2", toneClass)}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function DealCard({
  deal,
  selected,
  onSelect,
}: {
  deal: OpsSurpriseDealItem;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-[28px] border bg-white p-4 text-left shadow-[0_14px_40px_rgba(15,23,42,0.052)] transition hover:-translate-y-0.5 hover:border-[#f50555]/25 sm:p-5",
        selected ? "border-[#f50555]/35 ring-4 ring-[#f50555]/10" : "border-zinc-100",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-[#f50555]/10 text-[#f50555]">
              <PackageOpen className="h-4 w-4" />
            </span>
            <OpsStatus label={deal.status} />
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-500">#{deal.id}</span>
          </div>
          <h2 className="mt-3 text-xl font-bold tracking-[-0.045em] text-zinc-950">{deal.title}</h2>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-zinc-600">
            <Store className="h-4 w-4 text-zinc-400" />
            {deal.business_name}
            <span className="text-zinc-300">/</span>
            {deal.district}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[520px]">
          <CompactStat label="Satış" value={<AmountText amount={deal.sale_price_amount} currency={deal.currency} />} />
          <CompactStat label="Değer" value={<AmountText amount={deal.original_value_amount} currency={deal.currency} />} />
          <CompactStat label="Stok" value={stockLabel(deal)} tone={deal.quantity_remaining <= 0 ? "danger" : deal.quantity_reserved > 0 ? "warning" : "success"} />
          <CompactStat label="Sipariş" value={deal.committed_count} tone="neutral" />
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-xs font-semibold text-zinc-500 sm:grid-cols-2">
        <span className="inline-flex items-center gap-2 rounded-2xl bg-zinc-50 px-3 py-2">
          <Clock className="h-3.5 w-3.5 text-zinc-400" />
          Teslim: {formatDateTime(deal.pickup_window_start)} - {formatDateTime(deal.pickup_window_end)}
        </span>
        <span className="inline-flex items-center gap-2 rounded-2xl bg-zinc-50 px-3 py-2">
          <Box className="h-3.5 w-3.5 text-zinc-400" />
          Toplam {deal.quantity_total} / Kalan {deal.quantity_remaining} / Rezerve {deal.quantity_reserved}
        </span>
      </div>
    </button>
  );
}

export default function OpsSurpriseDealsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [district, setDistrict] = useState("");
  const [q, setQ] = useState("");
  const [hasReserved, setHasReserved] = useState("");
  const [hasRemaining, setHasRemaining] = useState("");
  const [selectedDealId, setSelectedDealId] = useState<number | null>(null);

  const params = useMemo(
    () => ({
      status: status || undefined,
      district: district.trim() || undefined,
      q: q.trim() || undefined,
      has_reserved: hasReserved || undefined,
      has_remaining: hasRemaining || undefined,
    }),
    [district, hasRemaining, hasReserved, q, status],
  );

  const dealsQuery = useQuery({
    queryKey: ["ops", "surprise-deals", params],
    queryFn: () => listOpsSurpriseDeals(params),
  });

  const dealResults = dealsQuery.data?.results;
  const deals = useMemo(() => dealResults ?? [], [dealResults]);
  const activeDealId = selectedDealId ?? deals[0]?.id ?? null;
  const selectedDeal = deals.find((deal) => deal.id === activeDealId) ?? null;

  const detailQuery = useQuery({
    queryKey: ["ops", "surprise-deals", activeDealId, "detail"],
    queryFn: () => getOpsSurpriseDealDetail(activeDealId as number),
    enabled: activeDealId !== null,
  });

  const closeMutation = useMutation({
    mutationFn: (dealId: number) => closeOpsSurpriseDeal(dealId),
    onSuccess: async () => {
      toast.success("Sürpriz paket kapatıldı.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ops", "surprise-deals"] }),
        queryClient.invalidateQueries({ queryKey: ["business", "surprise-deals"] }),
      ]);
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Sürpriz paket kapatılamadı.")),
  });

  const summary = useMemo(() => {
    return {
      count: deals.length,
      active: deals.filter((deal) => deal.status === "ACTIVE").length,
      reserved: deals.reduce((total, deal) => total + deal.quantity_reserved, 0),
      committed: deals.reduce((total, deal) => total + deal.committed_count, 0),
    };
  }, [deals]);

  return (
    <OpsPageShell title="Sürpriz Paketler" description="Tüm Son Dakika Fırsatları'nı merkezi olarak izle, rezervasyonları takip et ve gerektiğinde ops kontrolüyle kapat.">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsMetricCard label="Listelenen paket" value={summary.count} hint="Aktif filtrelerle dönen toplam kayıt." />
        <OpsMetricCard label="Aktif paket" value={summary.active} hint="Müşteri tarafında görünmeye aday fırsatlar." />
        <OpsMetricCard label="Rezerve stok" value={summary.reserved} hint="Henüz consume edilmemiş aktif rezervasyon." />
        <OpsMetricCard label="Tamamlanan" value={summary.committed} hint="Consume sonrası tamamlanan sürpriz paketler." />
      </div>

      <Card className="rounded-[28px] border-zinc-100 shadow-[0_16px_48px_rgba(15,23,42,0.055)]">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-bold tracking-[-0.035em] text-zinc-950">Filtreler</h2>
              <p className="mt-1 text-sm text-zinc-500">Paketleri durum, stok ve işletme adına göre hızlıca daralt.</p>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_180px_180px_170px_170px]">
            <label className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Paket veya işletme ara"
                className="h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 pl-11 pr-4 text-sm outline-none transition focus:border-[#f50555]/40 focus:bg-white focus:ring-4 focus:ring-[#f50555]/10"
              />
            </label>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none focus:border-[#f50555]/40 focus:bg-white focus:ring-4 focus:ring-[#f50555]/10">
              {STATUS_OPTIONS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
            <input
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
              placeholder="İlçe"
              className="h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none focus:border-[#f50555]/40 focus:bg-white focus:ring-4 focus:ring-[#f50555]/10"
            />
            <select value={hasReserved} onChange={(event) => setHasReserved(event.target.value)} className="h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none focus:border-[#f50555]/40 focus:bg-white focus:ring-4 focus:ring-[#f50555]/10">
              {BOOLEAN_OPTIONS.map((option) => <option key={`reserved-${option.value || "all"}`} value={option.value}>Rezerve: {option.label}</option>)}
            </select>
            <select value={hasRemaining} onChange={(event) => setHasRemaining(event.target.value)} className="h-12 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-sm outline-none focus:border-[#f50555]/40 focus:bg-white focus:ring-4 focus:ring-[#f50555]/10">
              {BOOLEAN_OPTIONS.map((option) => <option key={`remaining-${option.value || "all"}`} value={option.value}>Stok: {option.label}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {dealsQuery.isPending ? <LoadingSkeleton /> : null}
      {dealsQuery.isError ? <OpsErrorCard title="Sürpriz paketler yüklenemedi" description={getApiErrorMessage(dealsQuery.error)} /> : null}

      {dealsQuery.data ? (
        deals.length > 0 ? (
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_420px]">
            <section className="space-y-3">
              {deals.map((deal) => (
                <DealCard key={deal.id} deal={deal} selected={deal.id === activeDealId} onSelect={() => setSelectedDealId(deal.id)} />
              ))}
            </section>

            <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
              <Card className="rounded-[28px] border-zinc-100 shadow-[0_16px_48px_rgba(15,23,42,0.055)]">
                <CardContent className="space-y-5 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#f50555]">Detay</p>
                      <h2 className="mt-2 text-2xl font-bold tracking-[-0.05em] text-zinc-950">{selectedDeal?.title || "Paket seç"}</h2>
                      {selectedDeal ? <p className="mt-2 text-sm font-semibold text-zinc-500">{selectedDeal.business_name}</p> : null}
                    </div>
                    {selectedDeal ? <OpsStatus label={selectedDeal.status} /> : null}
                  </div>

                  {detailQuery.isPending ? <LoadingSkeleton /> : null}
                  {detailQuery.isError ? <OpsActionResult tone="danger" title="Detay yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}

                  {detailQuery.data ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <CompactStat label="Toplam" value={detailQuery.data.reservation_summary.total} />
                        <CompactStat label="Rezerve" value={detailQuery.data.reservation_summary.reserved} tone={detailQuery.data.reservation_summary.reserved > 0 ? "warning" : "neutral"} />
                        <CompactStat label="Tamamlandı" value={detailQuery.data.reservation_summary.committed} tone="success" />
                        <CompactStat label="Süre/iptal" value={detailQuery.data.reservation_summary.expired + detailQuery.data.reservation_summary.cancelled} tone="danger" />
                      </div>

                      {detailQuery.data.reservation_summary.reserved > 0 ? (
                        <OpsActionResult tone="warning" title="Aktif rezervasyon var" description="V1 güvenlik kuralı gereği aktif RESERVED kayıt varken ops kapatma işlemi engellenir." />
                      ) : null}

                      <Button
                        disabled={!shouldAllowClose(selectedDeal) || closeMutation.isPending}
                        loading={closeMutation.isPending}
                        loadingText="Kapatılıyor"
                        onClick={() => selectedDeal ? closeMutation.mutate(selectedDeal.id) : undefined}
                        className="h-12 w-full rounded-2xl"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        Ops olarak kapat
                      </Button>

                      <div className="space-y-3">
                        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500">Son rezervasyonlar</h3>
                        {detailQuery.data.recent_reservations.length > 0 ? (
                          detailQuery.data.recent_reservations.map((reservation) => (
                            <div key={reservation.id} className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-bold text-zinc-950">#{reservation.id} / {reservation.username || `Kullanıcı ${reservation.user_id}`}</p>
                                <OpsStatus label={reservation.status} />
                              </div>
                              <p className="mt-2 text-xs leading-5 text-zinc-500">
                                Session #{reservation.checkout_session_id || "-"} / Order #{reservation.order_id || "-"} / Son geçerlilik {formatDateTime(reservation.expires_at)}
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-500">Henüz rezervasyon kaydı yok.</p>
                        )}
                      </div>

                      <div className="space-y-3">
                        <h3 className="text-sm font-bold uppercase tracking-[0.14em] text-zinc-500">İlgili siparişler</h3>
                        {detailQuery.data.recent_orders.length > 0 ? (
                          detailQuery.data.recent_orders.map((order) => (
                            <div key={order.id} className="rounded-2xl border border-zinc-100 bg-white p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="font-bold text-zinc-950">Sipariş #{order.id}</p>
                                <OpsStatus label={order.status} />
                              </div>
                              <p className="mt-2 text-sm font-semibold text-zinc-950"><AmountText amount={order.total_charged_amount} /></p>
                              <p className="mt-1 text-xs text-zinc-500">Teslim: {formatDateTime(order.used_at)}</p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-500">Tamamlanmış sipariş yok.</p>
                        )}
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </aside>
          </div>
        ) : (
          <OpsEmpty title="Sürpriz paket bulunamadı" description="Filtreleri temizleyerek tüm fırsatları tekrar görüntüleyebilirsin." />
        )
      ) : null}

      {selectedDeal?.quantity_reserved ? (
        <OpsActionResult
          tone="warning"
          title="Kapatma güvenliği"
          description="Aktif rezervasyon varken paket kapatılamaz. Müşteri consume eder, iptal olur veya süre dolarsa ops kapatma tekrar denenebilir."
        />
      ) : null}

      {closeMutation.isError ? (
        <OpsActionResult tone="danger" title="Kapatma işlemi tamamlanamadı" description={getApiErrorMessage(closeMutation.error)} />
      ) : null}

      <div className="flex items-start gap-3 rounded-[24px] border border-amber-100 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Bu ekran yalnızca ops kontrol yüzeyidir. Müşteri checkout, işletme yönetimi, cüzdan düşümü ve consume akışı bu sayfadan değiştirilmez.</p>
      </div>
    </OpsPageShell>
  );
}
