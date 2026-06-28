"use client";

import Link from "next/link";
import { Clock3, Filter, Hourglass, Wallet } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { PaginationControls } from "@/components/shared/pagination-controls";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { buildUpdatedSearchParams, resolvePageParam } from "@/features/discovery/params";
import { getPendingWalletTransactions } from "@/features/wallet/api";
import {
  getPendingWalletTransactionDescription,
  getPendingWalletTransactionEffect,
  getWalletTransactionLabel,
} from "@/features/wallet/presentation";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";

const TYPE_OPTIONS = [
  { value: "", label: "Tüm bekleyen hareketler" },
  { value: "TOPUP_PENDING", label: "Bekleyen bakiye yükleme" },
  { value: "SETTLEMENT_OUT", label: "Cüzdana aktarım hazırlığı" },
  { value: "REVERSAL_OUT", label: "İade ve düzeltme işlemleri" },
];

export default function PendingTransactionsPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const filters = {
    type: searchParams.get("type") || undefined,
    payment_intent_id: searchParams.get("payment_intent_id") || undefined,
    page: resolvePageParam(searchParams.get("page"), 1),
  };

  const query = useQuery({
    queryKey: ["wallet", "pending-transactions", filters],
    queryFn: () => getPendingWalletTransactions(filters),
    retry: 0,
  });

  function submit(formData: FormData) {
    const next = buildUpdatedSearchParams(searchParams, {
      type: String(formData.get("type") || ""),
      payment_intent_id: String(formData.get("payment_intent_id") || ""),
      page: 1,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  function buildHref(page: number) {
    const next = buildUpdatedSearchParams(searchParams, { page });
    return `${pathname}?${next.toString()}`;
  }

  const summary = useMemo(() => {
    const results = query.data?.results ?? [];
    const totalCount = query.data?.count ?? 0;
    const totalPendingAmount = results.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    const positiveCount = results.filter((tx) => Number(tx.amount || 0) > 0).length;
    const negativeCount = results.filter((tx) => Number(tx.amount || 0) < 0).length;

    return {
      totalCount,
      totalPendingAmount,
      positiveCount,
      negativeCount,
    };
  }, [query.data]);

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Bekleyen işlemler"
        description="Cüzdana henüz tamamen yansımamış veya bekleyen bakiyeyi geçici olarak etkileyen hareketleri bu ekrandan takip edebilirsin."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/cuzdan"
              className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
            >
              Cüzdan özetine dön
            </Link>
            <Link
              href="/cuzdan?topup=1"
              className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Bakiye yükle
            </Link>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
          <CardContent className="space-y-5 p-6">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                <Hourglass className="h-3.5 w-3.5" /> Bekleyen bakiye görünümü
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Henüz sonuçlanmamış hareketleri tek ekranda izle</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                  Bu sayfa, ödeme onayı bekleyen veya cüzdana aktarım sürecinde olan hareketleri daha anlaşılır biçimde görmeni sağlar.
                  İşlemler kesinleştiğinde ilgili tutarlar cüzdan özetine ve hareket geçmişine normal şekilde yansır.
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam kayıt</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.totalCount}</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Artıran hareketler</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.positiveCount}</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Sayfadaki net etki</div>
                <div className="mt-2 text-2xl font-semibold text-zinc-950">
                  <AmountText amount={summary.totalPendingAmount} />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-sky-100 bg-[linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(239,246,255,0.92))]">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <Clock3 className="h-4 w-4" /> Bekleyen hareketler nasıl okunur?
            </div>
            <div className="space-y-4 text-sm text-zinc-700">
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">1</span>
                <p>Pozitif tutarlar bekleyen bakiyeyi artırır; yani ödeme alınmış ancak cüzdana tam yansımamış olabilir.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">2</span>
                <p>Negatif tutarlar bekleyen bakiyeden düşen iade, düzeltme veya aktarım hazırlığı hareketlerini gösterir.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">3</span>
                <p>İşlem kesinleştiğinde aynı tutarı cüzdan özetinde ve normal hareket geçmişinde daha net biçimde görürsün.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-start gap-3">
            <Filter className="mt-0.5 h-5 w-5 text-zinc-700" />
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Hareketleri filtrele</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Belirli bir bekleyen işlem türünü ya da ödeme kaydı numarasını arayarak listedeki sonuçları daraltabilirsin.
              </p>
            </div>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(new FormData(event.currentTarget));
            }}
            className="grid gap-3 md:grid-cols-[1.1fr_1fr_auto]"
          >
            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-900">İşlem türü</span>
              <select
                name="type"
                defaultValue={filters.type || ""}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-zinc-900">Ödeme kaydı numarası</span>
              <input
                name="payment_intent_id"
                defaultValue={filters.payment_intent_id || ""}
                placeholder="Örneğin 14"
                className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"
              />
            </label>

            <div className="flex items-end">
              <button className="w-full rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 md:w-auto">
                Sonuçları güncelle
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {query.isPending ? <LoadingSkeleton /> : null}
      {query.isError ? (
        <ErrorState
          title="Bekleyen işlemler getirilemedi"
          description={describeApiError(query.error, "Bekleyen cüzdan hareketleri şu anda yüklenemedi.")}
        />
      ) : null}

      {query.data && query.data.results.length === 0 ? (
        <EmptyState
          title="Bekleyen işlem görünmüyor"
          description="Şu anda bekleyen bakiyeyi etkileyen bir kayıt bulunmuyor. Yeni bir işlem olduğunda bu ekranda görünür."
        />
      ) : null}

      {query.data?.results.length ? (
        <div className="space-y-4">
          {query.data.results.map((tx) => {
            const effectText = getPendingWalletTransactionEffect(tx.amount);
            const effectTone =
              tx.amount > 0
                ? "bg-emerald-50 text-emerald-700"
                : tx.amount < 0
                  ? "bg-amber-50 text-amber-800"
                  : "bg-zinc-100 text-zinc-700";

            return (
              <Card key={tx.id} className="border-stone-200">
                <CardContent className="space-y-5 p-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold text-zinc-950">{getWalletTransactionLabel(tx.transaction_type)}</h2>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${effectTone}`}>{effectText}</span>
                      </div>
                      <p className="max-w-3xl text-sm leading-6 text-zinc-600">
                        {getPendingWalletTransactionDescription(tx.transaction_type, tx.description)}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-zinc-950 px-4 py-3 text-right text-white shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-300">İşlem tutarı</div>
                      <div className="mt-1 text-xl font-semibold">
                        <AmountText amount={tx.amount} />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-3">
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İşlem öncesi bekleyen bakiye</div>
                      <div className="mt-2 font-medium text-zinc-900">
                        <AmountText amount={tx.before_pending} />
                      </div>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İşlem sonrası bekleyen bakiye</div>
                      <div className="mt-2 font-medium text-zinc-900">
                        <AmountText amount={tx.after_pending} />
                      </div>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İşlem zamanı</div>
                      <div className="mt-2 font-medium text-zinc-900">{formatDateTime(tx.created_at)}</div>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Ödeme kaydı numarası</div>
                      <div className="mt-2 font-medium text-zinc-900">{tx.payment_intent_id ?? "-"}</div>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Sağlayıcı işlem kaydı</div>
                      <div className="mt-2 break-all font-medium text-zinc-900">{tx.provider_event_id ?? "-"}</div>
                    </div>
                    <div className="rounded-2xl bg-sky-50 p-4 text-sky-900">
                      <div className="text-xs font-medium uppercase tracking-[0.14em] text-sky-700">Kısa not</div>
                      <div className="mt-2 text-sm leading-6">
                        Bu kayıt geçici cüzdan akışını gösterir. Kesinleşen sonuçlar cüzdan özetine ve hareket geçmişine ayrıca yansır.
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}

          <PaginationControls
            page={filters.page}
            hasPrevious={Boolean(query.data.previous)}
            hasNext={Boolean(query.data.next)}
            buildHref={buildHref}
          />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <Wallet className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Bekleyen işlem neden oluşur?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Bazı ödemeler ve düzeltmeler cüzdana anında kesinleşmez. Banka, ödeme sağlayıcısı veya iç doğrulama adımları tamamlanıncaya kadar
                  hareket bu alanda bekleyen kayıt olarak görünür.
                </p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-zinc-700">
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">1</span>
                <p>Ödeme alındığında tutar önce bekleyen bakiyede izlenebilir.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">2</span>
                <p>Onay tamamlandığında tutar cüzdana aktarılır ve burada görünmez hale gelir.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">3</span>
                <p>İade veya düzeltme varsa ilgili hareket yine önce bu ekranda görünebilir.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <Filter className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Hızlı geçişler</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Cüzdan yönetiminde en sık ihtiyaç duyacağın ekranlara buradan tek adımda geçebilirsin.
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Link
                href="/cuzdan"
                className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Cüzdan özetine dön
              </Link>
              <Link
                href="/cuzdan/hareketler"
                className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
              >
                Hareket geçmişini aç
              </Link>
              <Link
                href="/cuzdan?topup=1"
                className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
              >
                Yeni yükleme başlat
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
