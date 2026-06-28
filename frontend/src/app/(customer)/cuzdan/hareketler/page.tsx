"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Filter, History, ReceiptText } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { PaginationControls } from "@/components/shared/pagination-controls";
import { buildUpdatedSearchParams, resolvePageParam } from "@/features/discovery/params";
import { getWalletTransactions } from "@/features/wallet/api";
import { getWalletTransactionLabel } from "@/features/wallet/presentation";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

function getTransactionContext(input: { order_id: number | null; payment_intent_id: number | null }) {
  if (input.order_id) {
    return `Sipariş no: #${input.order_id}`;
  }
  if (input.payment_intent_id) {
    return `Yükleme işlemi: #${input.payment_intent_id}`;
  }
  return "Genel cüzdan işlemi";
}

function getSelectedFilterSummary(filters: { type?: string; payment_intent_id?: string; order_id?: string }) {
  if (filters.type) {
    return getWalletTransactionLabel(filters.type);
  }
  if (filters.order_id) {
    return `Sipariş no: #${filters.order_id}`;
  }
  if (filters.payment_intent_id) {
    return `Yükleme işlemi: #${filters.payment_intent_id}`;
  }
  return "Tüm hareketler";
}

export default function WalletTransactionsPage() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const filters = {
    type: searchParams.get("type") || undefined,
    payment_intent_id: searchParams.get("payment_intent_id") || undefined,
    order_id: searchParams.get("order_id") || undefined,
    page: resolvePageParam(searchParams.get("page"), 1),
  };

  const query = useQuery({
    queryKey: ["wallet", "transactions", filters],
    queryFn: () => getWalletTransactions(filters),
    retry: 0,
  });

  function submit(formData: FormData) {
    const next = buildUpdatedSearchParams(searchParams, {
      type: String(formData.get("type") || ""),
      payment_intent_id: String(formData.get("payment_intent_id") || ""),
      order_id: String(formData.get("order_id") || ""),
      page: 1,
    });
    router.push(`${pathname}?${next.toString()}`);
  }

  function buildHref(page: number) {
    const next = buildUpdatedSearchParams(searchParams, { page });
    const serialized = next.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
  }

  const totalCount = query.data?.count ?? 0;
  const shownCount = query.data?.results.length ?? 0;
  const selectedFilterSummary = getSelectedFilterSummary(filters);

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Cüzdan hareketleri"
        description="Cüzdanında gerçekleşen yükleme, ödeme, iade ve diğer bakiye değişimlerini burada ayrıntılı şekilde takip edebilirsin."
        actions={
          <Link href="/cuzdan" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Cüzdana dön
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                  <History className="h-3.5 w-3.5" /> Hareket geçmişi
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Bakiye değişimlerini tek ekranda izle</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                    Yükleme, sipariş ödemesi, iade ve diğer cüzdan hareketlerini kronolojik olarak inceleyebilir; dilediğinde belirli işlemleri süzerek daha hızlı bulabilirsin.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam kayıt</div>
                  <div className="mt-2 text-2xl font-semibold text-zinc-950">{totalCount}</div>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bu sayfada görünen</div>
                  <div className="mt-2 text-2xl font-semibold text-zinc-950">{shownCount}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Seçili görünüm</div>
                <div className="mt-2 text-sm font-semibold text-zinc-950">{selectedFilterSummary}</div>
              </div>
              <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Filtre kullanımı</div>
                <div className="mt-2 text-sm font-semibold text-zinc-950">İşlem türü, sipariş no veya yükleme no</div>
              </div>
              <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Takip amacı</div>
                <div className="mt-2 text-sm font-semibold text-zinc-950">Bakiye değişimini adım adım görmek</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 bg-zinc-950 text-white">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
              <Filter className="h-4 w-4" /> Filtre rehberi
            </div>
            <div className="space-y-4 text-sm text-zinc-200">
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">1</span>
                <p>İşlem türü alanına örneğin bakiye yükleme veya sipariş ödemesi gibi bir hareket tipi yazabilirsin.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">2</span>
                <p>Belirli bir siparişe ait hareketleri görmek için sipariş numarasını kullanabilirsin.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">3</span>
                <p>Yükleme işlemlerini tek tek ayırmak istersen ilgili yükleme işlem numarasına göre süzebilirsin.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200">
        <CardContent className="space-y-5 p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-zinc-950">Hareketlerini ara ve süz</h2>
            <p className="text-sm leading-6 text-zinc-600">
              Belirli bir işlem türünü, siparişi veya yükleme kaydını ayırarak aradığın hareketi daha hızlı bulabilirsin.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit(new FormData(event.currentTarget));
            }}
            className="grid gap-3 md:grid-cols-4"
          >
            <input
              name="type"
              defaultValue={filters.type || ""}
              placeholder="İşlem türü yaz"
              className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            />
            <input
              name="payment_intent_id"
              defaultValue={filters.payment_intent_id || ""}
              placeholder="Yükleme işlem no"
              className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            />
            <input
              name="order_id"
              defaultValue={filters.order_id || ""}
              placeholder="Sipariş no"
              className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"
            />
            <button className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">Sonuçları göster</button>
          </form>
        </CardContent>
      </Card>

      {query.isPending ? <LoadingSkeleton /> : null}
      {query.isError ? (
        <ErrorState
          title="Hareketler yüklenemedi"
          description={describeApiError(query.error, "Cüzdan hareketleri şu anda getirilemedi. Lütfen daha sonra tekrar dene.")}
        />
      ) : null}
      {query.data && query.data.results.length === 0 ? (
        <EmptyState title="Bu ölçülere uyan hareket bulunamadı" description="Filtrelerini değiştirerek veya temizleyerek tekrar deneyebilirsin." />
      ) : null}

      {query.data?.results.length ? (
        <div className="space-y-4">
          {query.data.results.map((tx) => (
            <Card key={tx.id} className="border-stone-200">
              <CardContent className="space-y-4 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-zinc-950">{getWalletTransactionLabel(tx.transaction_type)}</h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">
                      {repairPotentialMojibake(tx.description || "Bu işlem için ek açıklama bulunmuyor.")}
                    </p>
                  </div>
                  <AmountText amount={tx.amount} />
                </div>

                <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-3">
                  <div className="rounded-2xl bg-zinc-50 p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İşlem öncesi bakiye</div>
                    <div className="mt-2 font-medium text-zinc-900">
                      <AmountText amount={tx.before_balance} />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İşlem sonrası bakiye</div>
                    <div className="mt-2 font-medium text-zinc-900">
                      <AmountText amount={tx.after_balance} />
                    </div>
                  </div>
                  <div className="rounded-2xl bg-zinc-50 p-4">
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İşlem zamanı</div>
                    <div className="mt-2 font-medium text-zinc-900">{formatDateTime(tx.created_at)}</div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                  <span className="rounded-full bg-zinc-100 px-3 py-1.5">{getTransactionContext(tx)}</span>
                  {tx.provider_event_id ? <span className="rounded-full bg-zinc-100 px-3 py-1.5">Sağlayıcı kayıt no: {tx.provider_event_id}</span> : null}
                </div>
              </CardContent>
            </Card>
          ))}

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
              <ArrowRightLeft className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Hareketleri nasıl okursun?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Cüzdan geçmişindeki kayıtlar bakiye değişiminin hangi işlemden kaynaklandığını hızlıca anlaman için burada sade şekilde gösterilir.
                </p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-zinc-700">
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">1</span>
                <p>İşlem öncesi ve işlem sonrası bakiye alanları, cüzdanında ne kadar değişim olduğunu net gösterir.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">2</span>
                <p>Sipariş veya yükleme numarası varsa ilgili kaynağı daha kolay bulmana yardımcı olur.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">3</span>
                <p>İşlem türü başlığı, bu hareketin yükleme mi ödeme mi iade mi olduğunu hızlıca ayırt etmeni sağlar.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <ReceiptText className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Hızlı geçişler</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Cüzdanını yönetirken en sık ihtiyaç duyacağın diğer ekranlara buradan geçebilirsin.
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Link href="/cuzdan" className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Cüzdan özetine dön
              </Link>
              <Link href="/cuzdan?topup=1" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Yeni bakiye yükle
              </Link>
              <Link href="/cuzdan/bekleyen-islemler" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Bekleyen işlemleri incele
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
