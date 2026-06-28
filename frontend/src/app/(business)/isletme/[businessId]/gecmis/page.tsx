"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, ReceiptText, ShieldCheck, WalletCards, X } from "lucide-react";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { StatusChip } from "@/components/ui/status-chip";
import { getBusinessConsumeHistory } from "@/features/business-operations/api";
import type { BusinessConsumeHistoryItem } from "@/features/business-operations/types";
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
      return status || "Durum yok";
  }
}

function getDisplayAmount(item: BusinessConsumeHistoryItem) {
  return item.order.total_charged_amount || item.total_payable_amount || item.amount || 0;
}

function HistoryDetailCard({ item, onClose }: { item: BusinessConsumeHistoryItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-8" onClick={onClose}>
      <section
        className="hy-mobile-sheet w-full max-w-2xl overflow-hidden rounded-t-[32px] bg-white shadow-[0_34px_110px_rgba(15,23,42,0.30)] ring-1 ring-white/50 sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative overflow-hidden bg-zinc-950 p-5 text-white sm:p-7">
          <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[#f40046]/30 blur-3xl" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg transition hover:scale-105 hover:bg-rose-50"
            aria-label="Kaydı kapat"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="relative z-10 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/75 ring-1 ring-white/10">
            <ReceiptText className="h-3.5 w-3.5 text-[#ff7a9f]" />
            İşlem kaydı
          </div>
          <h2 className="relative z-10 mt-5 pr-12 text-2xl font-semibold tracking-[-0.05em] sm:text-4xl">Sipariş #{item.order.id ?? item.checkout_session_id}</h2>
          <p className="relative z-10 mt-2 text-sm leading-6 text-white/65">QR/kasa doğrulaması ve tahsilat özeti.</p>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
          <div className="rounded-[22px] border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Durum</p>
            <div className="mt-2">
              <StatusChip label={getOrderLabel(item.order.status)} tone={getOrderTone(item.order.status)} />
            </div>
          </div>
          <div className="rounded-[22px] border border-zinc-100 bg-zinc-950 p-4 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">Tahsilat</p>
            <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
              <AmountText amount={getDisplayAmount(item)} />
            </p>
          </div>
          <div className="rounded-[22px] border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Ürün adedi</p>
            <p className="mt-2 text-lg font-semibold text-zinc-950">{item.item_count}</p>
          </div>
          <div className="rounded-[22px] border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Kasa kodu</p>
            <p className="mt-2 break-all font-semibold tracking-[0.12em] text-zinc-950">{item.checkout_session_cashier_code || "-"}</p>
          </div>
          <div className="rounded-[22px] border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Tahsilat zamanı</p>
            <p className="mt-2 font-semibold text-zinc-950">{formatDateTime(item.order.paid_at)}</p>
          </div>
          <div className="rounded-[22px] border border-zinc-100 bg-zinc-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Teslim zamanı</p>
            <p className="mt-2 font-semibold text-zinc-950">{formatDateTime(item.order.used_at ?? item.consumed_at)}</p>
          </div>
          <div className="rounded-[22px] border border-zinc-100 bg-zinc-50 p-4 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">QR oturum numarası</p>
            <p className="mt-2 break-all font-semibold text-zinc-950">#{item.checkout_session_id}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function BusinessConsumeHistoryPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [selectedItem, setSelectedItem] = useState<BusinessConsumeHistoryItem | null>(null);

  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const pageParam = Number(searchParams.get("page") || "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;

  const historyQuery = useQuery({
    queryKey: ["business-operations", businessId, "consume-history", { page }],
    queryFn: () => getBusinessConsumeHistory(businessId, { page }),
    enabled: hasValidBusinessId,
  });

  const rows = useMemo(() => historyQuery.data?.results ?? [], [historyQuery.data?.results]);

  const summary = useMemo(() => {
    return rows.reduce(
      (accumulator, item) => {
        accumulator.count += 1;
        accumulator.totalCharged += getDisplayAmount(item);
        accumulator.totalItems += item.item_count || 0;
        return accumulator;
      },
      {
        count: 0,
        totalCharged: 0,
        totalItems: 0,
      },
    );
  }, [rows]);

  function buildPageHref(nextPage: number) {
    const next = buildUpdatedSearchParams(searchParams, { page: nextPage });
    const serialized = next.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
  }

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#f40046]">İşletme paneli</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">İşlem geçmişi</h1>
            </div>
            {hasValidBusinessId ? (
              <Link
                href={`/isletme/${businessId}`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 sm:w-fit"
              >
                <ArrowLeft className="h-4 w-4" />
                Panele dön
              </Link>
            ) : null}
          </div>

          {!hasValidBusinessId ? (
            <ErrorState title="Geçersiz işletme" description="URL içindeki işletme bilgisi okunamadı. İşletme paneline güvenli giriş yapıp tekrar dene." />
          ) : null}

          {hasValidBusinessId ? (
            <section className="overflow-hidden rounded-[2rem] border border-zinc-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
              <div className="bg-zinc-950 px-5 py-5 text-white sm:px-7 sm:py-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="max-w-2xl">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Güvenli kayıt
                    </div>
                    <h2 className="mt-4 text-xl font-semibold tracking-tight sm:text-3xl">Kasada tamamlanan işlemler</h2>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">
                      QR veya kasa kodu ile tamamlanan siparişleri ve tahsilat toplamını buradan takip edebilirsin.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2 lg:min-w-[430px]">
                    <div className="rounded-2xl bg-white px-4 py-3 text-zinc-950">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Kayıt</p>
                      <p className="mt-1 text-xl font-semibold">{summary.count}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-zinc-950">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Ürün</p>
                      <p className="mt-1 text-xl font-semibold">{summary.totalItems}</p>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-3 text-zinc-950">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Tahsilat</p>
                      <p className="mt-1 text-lg font-semibold">
                        <AmountText amount={summary.totalCharged} />
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <CardContent className="p-0">
                {historyQuery.isPending ? (
                  <div className="p-5 sm:p-7">
                    <LoadingSkeleton />
                  </div>
                ) : null}

                {historyQuery.isError ? (
                  <div className="p-5 sm:p-7">
                    <ErrorState
                      title="İşlem geçmişi yüklenemedi"
                      description={`${getApiErrorMessage(historyQuery.error)}${getApiRequestId(historyQuery.error) ? ` · request_id: ${getApiRequestId(historyQuery.error)}` : ""}`}
                    />
                  </div>
                ) : null}

                {historyQuery.data && rows.length === 0 ? (
                  <div className="p-5 sm:p-7">
                    <EmptyState title="Henüz işlem yok" description="QR kod kasada doğrulandığında tamamlanan işlemler burada görünür." />
                  </div>
                ) : null}

                {rows.length ? (
                  <div className="divide-y divide-zinc-100">
                    {rows.map((item) => (
                      <article key={item.checkout_session_id} className="group p-5 transition hover:bg-zinc-50/70 sm:p-7">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fff0f5] text-[#f40046]">
                                <ReceiptText className="h-5 w-5" />
                              </div>
                              <div>
                                <h3 className="text-base font-semibold text-zinc-950 sm:text-lg">İşlem #{item.checkout_session_id}</h3>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-medium text-zinc-500">
                                  <span>{formatDateTime(item.consumed_at)}</span>
                                  {item.checkout_session_cashier_code ? <span>· Kasa kodu {item.checkout_session_cashier_code}</span> : null}
                                  <span>· {item.item_count} ürün</span>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <StatusChip label={getOrderLabel(item.order.status)} tone={getOrderTone(item.order.status)} />
                              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-700">
                                <Clock3 className="h-3.5 w-3.5" />
                                Tahsilat: {formatDateTime(item.order.paid_at)}
                              </span>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-sm lg:min-w-[220px]">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Tahsilat</p>
                            <p className="mt-2 text-lg font-semibold text-zinc-950">
                              <AmountText amount={getDisplayAmount(item)} />
                            </p>
                          </div>
                        </div>

                        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
                          <div className="inline-flex items-center gap-2">
                            <WalletCards className="h-4 w-4 text-zinc-400" />
                            <span>Sipariş: #{item.order.id}</span>
                          </div>
                          <button
                              type="button"
                              onClick={() => setSelectedItem(item)}
                              className="inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-sm ring-1 ring-zinc-200 transition hover:bg-[#fff0f5] hover:text-[#f40046] hover:ring-[#ffd1df]"
                            >
                              Kaydı aç
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </CardContent>
            </section>
          ) : null}

          {historyQuery.data ? (
            <PaginationControls page={page} hasPrevious={Boolean(historyQuery.data.previous)} hasNext={Boolean(historyQuery.data.next)} buildHref={buildPageHref} />
          ) : null}

          <Card className="border-zinc-200 bg-white shadow-sm">
            <CardContent className="flex flex-col gap-4 p-5 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-[#fff0f5] p-2 text-[#f40046]">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-semibold text-zinc-950">Sade günlük kontrol</p>
                  <p className="mt-1 leading-6">Tamamlanan QR işlemleri ve tahsilat kayıtları aynı ekranda takip edilir.</p>
                </div>
              </div>
              {hasValidBusinessId ? (
                <Link href={`/isletme/${businessId}`} className="rounded-full bg-zinc-950 px-5 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-zinc-800">
                  Panele dön
                </Link>
              ) : null}
            </CardContent>
          </Card>
          {selectedItem ? <HistoryDetailCard item={selectedItem} onClose={() => setSelectedItem(null)} /> : null}
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
