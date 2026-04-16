"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, ReceiptText, ShieldCheck, Wallet } from "lucide-react";

import { NotificationReadinessBanner } from "@/components/notifications/readiness-banner";
import { NotificationReadinessSummaryCard } from "@/components/notifications/readiness-summary-card";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { getNotificationReadiness } from "@/features/notifications/api";
import { getWalletDetail, getWalletTransactions } from "@/features/wallet/api";
import type { WalletTransaction } from "@/features/wallet/types";
import { getWalletTransactionLabel } from "@/features/wallet/presentation";
import { isNotificationReadinessError } from "@/lib/api/errors";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";

function getWalletHealthMessage(input: { ledgerInSync: boolean; pendingLedgerInSync: boolean }) {
  if (input.ledgerInSync && input.pendingLedgerInSync) {
    return {
      title: "Cüzdan bakiyen güncel görünüyor",
      description: "Kullanılabilir ve bekleyen tutarlar şu an sistemle uyumlu şekilde görüntüleniyor.",
      tone: "success" as const,
    };
  }
  return {
    title: "Cüzdan verileri güncelleniyor",
    description: "Bazı bakiyeler kısa süreli olarak eşitleniyor olabilir. Sayfayı biraz sonra yenileyerek son durumu tekrar görebilirsin.",
    tone: "warning" as const,
  };
}

function getTransactionContext(tx: WalletTransaction) {
  if (tx.order_id) {
    return `Sipariş no: #${tx.order_id}`;
  }
  if (tx.payment_intent_id) {
    return `Yükleme işlemi: #${tx.payment_intent_id}`;
  }
  return "Cüzdan işlemi";
}

export default function WalletPage() {
  const readinessQuery = useQuery({ queryKey: ["notifications", "readiness"], queryFn: getNotificationReadiness, retry: 0 });
  const walletQuery = useQuery({ queryKey: ["wallet", "detail"], queryFn: getWalletDetail, retry: 0 });
  const transactionsQuery = useQuery({
    queryKey: ["wallet", "transactions", "preview"],
    queryFn: () => getWalletTransactions({ page: 1 }),
    retry: 0,
  });

  const walletBlockedByReadiness = walletQuery.isError && isNotificationReadinessError(walletQuery.error);
  const txBlockedByReadiness = transactionsQuery.isError && isNotificationReadinessError(transactionsQuery.error);
  const healthMessage = walletQuery.data
    ? getWalletHealthMessage({
        ledgerInSync: walletQuery.data.ledger_in_sync,
        pendingLedgerInSync: walletQuery.data.pending_ledger_in_sync,
      })
    : null;

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Cüzdan"
        description="Bakiyeni, son hareketlerini ve bekleyen tutarlarını tek ekranda takip edebilir; ihtiyaç halinde yeni yükleme adımına geçebilirsin."
        actions={
          <Link href="/cuzdan/yukle" className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
            Bakiye yükle
          </Link>
        }
      />

      <NotificationReadinessBanner readiness={readinessQuery.data} />

      {walletQuery.isPending ? <LoadingSkeleton /> : null}
      {walletBlockedByReadiness ? (
        <ErrorState
          title="Cüzdan ekranı şu anda hazır değil"
          description="Cüzdan ve ödeme adımlarını sorunsuz kullanabilmek için en az bir aktif ve izinli cihaz gerekiyor."
        />
      ) : null}
      {walletQuery.isError && !walletBlockedByReadiness ? (
        <ErrorState
          title="Cüzdan özeti yüklenemedi"
          description={describeApiError(walletQuery.error, "Cüzdan bilgileri şu anda getirilemedi. Lütfen daha sonra tekrar dene.")}
        />
      ) : null}

      {walletQuery.data ? (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
            <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
              <CardContent className="space-y-5 p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                      <Wallet className="h-3.5 w-3.5" /> HalkYemek cüzdan özeti
                    </div>
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Bakiyen burada hazır</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                        Kullanılabilir tutarını, bekleyen bakiyeni ve son işlemlerini tek yerde görerek sipariş ve yükleme akışını daha rahat yönetebilirsin.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Kullanılabilir bakiye</div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">
                        <AmountText amount={walletQuery.data.balance} />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bekleyen bakiye</div>
                      <div className="mt-2 text-2xl font-semibold text-zinc-950">
                        <AmountText amount={walletQuery.data.pending_balance} />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Cüzdan durumu</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-950">
                      {walletQuery.data.is_active ? "Kullanıma hazır" : "Geçici olarak kısıtlı"}
                    </div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Son güncelleme</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-950">{formatDateTime(walletQuery.data.updated_at)}</div>
                  </div>
                  <div className="rounded-2xl bg-white/80 p-4 shadow-sm">
                    <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Hesap açılışı</div>
                    <div className="mt-2 text-sm font-semibold text-zinc-950">{formatDateTime(walletQuery.data.created_at)}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-stone-200 bg-zinc-950 text-white">
              <CardContent className="space-y-4 p-6">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                  <ShieldCheck className="h-4 w-4" /> Cüzdan durumu
                </div>

                {healthMessage ? (
                  <div
                    className={`rounded-2xl p-4 text-sm leading-6 ${
                      healthMessage.tone === "success"
                        ? "bg-emerald-400/10 text-emerald-100"
                        : "bg-amber-400/10 text-amber-100"
                    }`}
                  >
                    <div className="font-medium">{healthMessage.title}</div>
                    <p className="mt-2">{healthMessage.description}</p>
                  </div>
                ) : null}

                <div className="space-y-4 text-sm text-zinc-200">
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">1</span>
                    <p>Kullanılabilir bakiye siparişlerde hemen kullanabileceğin tutarı gösterir.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">2</span>
                    <p>Bekleyen bakiye kısa süre içinde netleşecek işlemleri ayrı görmeni sağlar.</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">3</span>
                    <p>Hareket geçmişi üzerinden ödeme, yükleme ve iade akışlarını kolayca takip edebilirsin.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <Card className="border-stone-200">
              <CardContent className="space-y-5 p-6">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-950">Son hareketler</h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">
                      Cüzdanındaki son işlemleri burada özet olarak görebilir, istersen tüm hareket geçmişine geçebilirsin.
                    </p>
                  </div>
                  <Link href="/cuzdan/hareketler" className="text-sm font-medium text-zinc-700 hover:text-zinc-950">
                    Tümünü aç
                  </Link>
                </div>

                {transactionsQuery.isPending ? <LoadingSkeleton /> : null}
                {txBlockedByReadiness ? (
                  <ErrorState
                    title="Hareketler şu anda gösterilemiyor"
                    description="İşlem geçmişini görebilmek için bildirim hazırlığının tamamlanması gerekiyor."
                  />
                ) : null}
                {transactionsQuery.isError && !txBlockedByReadiness ? (
                  <ErrorState
                    title="Hareket özeti yüklenemedi"
                    description={describeApiError(transactionsQuery.error, "İşlem geçmişi şu anda getirilemedi. Lütfen daha sonra tekrar dene.")}
                  />
                ) : null}
                {transactionsQuery.data?.results.length === 0 ? (
                  <EmptyState title="Henüz cüzdan hareketi yok" description="Bakiye yüklediğinde veya sipariş verdiğinde işlemler burada görünmeye başlayacak." />
                ) : null}

                {transactionsQuery.data?.results.slice(0, 5).map((tx) => (
                  <div key={tx.id} className="rounded-2xl bg-zinc-50 p-4 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-zinc-950">{getWalletTransactionLabel(tx.transaction_type)}</p>
                        <p className="mt-1 text-zinc-500">{tx.description || "Bu işlem için ek açıklama bulunmuyor."}</p>
                      </div>
                      <AmountText amount={tx.amount} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span className="rounded-full bg-white px-2.5 py-1">İşlem zamanı: {formatDateTime(tx.created_at)}</span>
                      <span className="rounded-full bg-white px-2.5 py-1">{getTransactionContext(tx)}</span>
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap gap-2">
                  <Link href="/cuzdan/hareketler" className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                    Tüm hareketler
                  </Link>
                  <Link href="/cuzdan/bekleyen-islemler" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                    Bekleyen işlemler
                  </Link>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <NotificationReadinessSummaryCard readiness={readinessQuery.data} />

              <Card className="border-stone-200">
                <CardContent className="space-y-5 p-6">
                  <div className="flex items-start gap-3">
                    <ArrowRightLeft className="mt-0.5 h-5 w-5 text-zinc-700" />
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-950">Cüzdanı nasıl kullanırsın?</h2>
                      <p className="mt-1 text-sm leading-6 text-zinc-600">
                        Bakiye yükleme ve sipariş ödemesi arasındaki ilişkiyi tek bakışta anlayabileceğin kısa bir özet.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4 text-sm text-zinc-700">
                    <div className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">1</span>
                      <p>Cüzdanına yüklediğin tutar kullanılabilir bakiyene yansır ve siparişlerde doğrudan kullanılır.</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">2</span>
                      <p>Bekleyen işlemler kısa süre içinde netleşecek hareketleri ayrı tutarak karışıklığı azaltır.</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">3</span>
                      <p>Her sipariş veya yükleme sonrası işlem geçmişini kontrol ederek bakiyendeki değişimi rahatça takip edebilirsin.</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-stone-200">
                <CardContent className="space-y-4 p-6">
                  <div className="flex items-start gap-3">
                    <ReceiptText className="mt-0.5 h-5 w-5 text-zinc-700" />
                    <div>
                      <h2 className="text-lg font-semibold text-zinc-950">Hızlı işlemler</h2>
                      <p className="mt-1 text-sm leading-6 text-zinc-600">
                        İhtiyacın olan sayfalara buradan doğrudan geçebilirsin.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Link href="/cuzdan/yukle" className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                      Yeni bakiye yükle
                    </Link>
                    <Link href="/cuzdan/hareketler" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                      Hareket geçmişini aç
                    </Link>
                    <Link href="/cuzdan/bekleyen-islemler" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                      Bekleyen işlemleri incele
                    </Link>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}
    </PageContainer>
  );
}
