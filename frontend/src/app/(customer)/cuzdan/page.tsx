"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CreditCard, Loader2, Plus, Settings, Wallet, X } from "lucide-react";

import { CustomerBottomSection } from "@/components/layout/customer-bottom-section";
import { AmountText } from "@/components/ui/amount-text";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { createTopupIntent } from "@/features/payments/api";
import { getWalletDetail, getWalletTransactions } from "@/features/wallet/api";
import { getWalletTransactionLabel } from "@/features/wallet/presentation";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";

const QUICK_AMOUNTS = [100, 250, 500, 1000];
function normalizeAmountInput(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 7);
}

function TopupModal({ initialAmount, onClose }: { initialAmount?: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [amount, setAmount] = useState(() => String(initialAmount && initialAmount > 0 ? initialAmount : 250));
  const [providerUrl, setProviderUrl] = useState<string | null>(null);
  const numericAmount = Number(amount || 0);
  const isValid = Number.isFinite(numericAmount) && numericAmount >= 1;

  const createMutation = useMutation({
    mutationFn: createTopupIntent,
    onSuccess: async (intent) => {
      queryClient.setQueryData(["topup", "intent", intent.id], intent);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["topup"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet"] }),
      ]);

      if (intent.provider_page_url) {
        setProviderUrl(intent.provider_page_url);
        toast.success("Ödeme bağlantısı hazır.");
        return;
      }

      toast.success("Bakiye talebi alındı.", { description: "Onay sonrası cüzdanına yansır." });
      onClose();
      router.replace("/cuzdan", { scroll: false });
    },
    onError: (error) => toast.error(describeApiError(error, "Bakiye yükleme başlatılamadı.")),
  });

  const submitTopup = () => {
    if (!isValid || createMutation.isPending) return;
    createMutation.mutate({ amount: numericAmount });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" onMouseDown={onClose}>
      <div
        className="hy-mobile-sheet w-full max-w-[460px] overflow-hidden rounded-t-[30px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.32)] transition duration-200 sm:rounded-[30px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="topup-modal-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="relative bg-[#f50555] px-6 pb-20 pt-6 text-white">
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white hover:text-zinc-950"
            aria-label="Bakiye yükleme kartını kapat"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
            <CreditCard className="h-6 w-6" />
          </div>
          <h2 id="topup-modal-title" className="mt-5 text-2xl font-semibold tracking-[-0.04em]">
            Bakiye yükle
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-white/86">
            Yüklemek istediğin tutarı seç, ödeme adımını güvenli şekilde başlat.
          </p>
        </div>

        <div className="-mt-12 space-y-5 px-5 pb-6">
          <div className="rounded-[24px] border border-zinc-100 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.12)]">
            <label className="text-sm font-medium text-zinc-600" htmlFor="topup-amount">
              Yüklenecek tutar
            </label>
            <div className="mt-3 flex items-end gap-2">
              <input
                id="topup-amount"
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(normalizeAmountInput(event.target.value))}
                className="min-w-0 flex-1 border-0 bg-transparent text-3xl font-semibold tracking-[-0.06em] text-zinc-950 outline-none placeholder:text-zinc-300 sm:text-4xl"
                placeholder="0"
                disabled={createMutation.isPending}
              />
              <span className="pb-2 text-xl font-semibold text-zinc-500">TL</span>
            </div>
            {!isValid ? <p className="mt-2 text-sm text-red-600">Tutar en az 1 TL olmalı.</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {QUICK_AMOUNTS.map((quickAmount) => {
              const isSelected = numericAmount === quickAmount;
              return (
                <button
                  key={quickAmount}
                  type="button"
                  onClick={() => setAmount(String(quickAmount))}
                  disabled={createMutation.isPending}
                  className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${
                    isSelected
                      ? "border-[#f50555] bg-[#f50555] text-white shadow-[0_12px_28px_rgba(245,5,85,0.24)]"
                      : "border-zinc-200 bg-white text-zinc-700 hover:-translate-y-0.5 hover:border-[#f50555]/35 hover:bg-rose-50 hover:text-[#f50555]"
                  }`}
                >
                  {quickAmount} TL
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={submitTopup}
            disabled={!isValid || createMutation.isPending || Boolean(providerUrl)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-4 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(245,5,85,0.24)] transition hover:-translate-y-0.5 hover:bg-[#dc004c] disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none"
          >
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {createMutation.isPending ? "Ödeme hazırlanıyor" : providerUrl ? "Ödeme bağlantısı hazır" : "Ödeme adımını başlat"}
          </button>

          {providerUrl ? (
            <a
              href={providerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-4 text-sm font-semibold text-zinc-950 transition hover:-translate-y-0.5 hover:border-[#f50555]/35 hover:bg-rose-50 hover:text-[#f50555]"
            >
              Güvenli ödeme ekranını aç
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function WalletPage() {
  const searchParams = useSearchParams();
  const requestedAmountParam = Number(searchParams.get("amount") || 0);
  const requestedAmount = Number.isFinite(requestedAmountParam) && requestedAmountParam > 0 ? Math.ceil(requestedAmountParam) : 0;
  const [isTopupOpen, setIsTopupOpen] = useState(false);
  const walletQuery = useQuery({ queryKey: ["wallet", "detail"], queryFn: getWalletDetail, retry: 0 });
  const transactionsQuery = useQuery({
    queryKey: ["wallet", "transactions", "preview"],
    queryFn: () => getWalletTransactions({ page: 1 }),
    retry: 0,
  });

  const recentTransactions = useMemo(() => transactionsQuery.data?.results.slice(0, 4) ?? [], [transactionsQuery.data]);

  useEffect(() => {
    if (searchParams.get("topup") === "1" || requestedAmount > 0) {
      setIsTopupOpen(true);
    }
  }, [requestedAmount, searchParams]);

  return (
    <PageContainer className="space-y-8 bg-white">
      <section className="overflow-hidden rounded-[30px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.08)] ring-1 ring-zinc-100">
        <div className="bg-[#f50555] px-5 pb-20 pt-6 text-white sm:px-7 sm:pt-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
                <Wallet className="h-6 w-6" />
              </span>
              <h1 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">Cüzdan</h1>
            </div>
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/12 text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-zinc-950"
              aria-label="Cüzdan ayarları"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="-mt-14 px-4 pb-5 sm:px-6 sm:pb-6">
          <div className="rounded-[24px] border border-zinc-100 bg-white p-5 shadow-[0_18px_52px_rgba(15,23,42,0.14)] sm:p-6">
            <p className="text-sm font-medium text-zinc-600">Mevcut Bakiyeniz</p>
            <div className="mt-3 text-4xl font-semibold tracking-[-0.06em] text-zinc-950 sm:text-5xl">
              {walletQuery.data ? <AmountText amount={walletQuery.data.balance} /> : walletQuery.isPending ? "Yükleniyor" : <AmountText amount={0} />}
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() => setIsTopupOpen(true)}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(245,5,85,0.22)] transition hover:-translate-y-0.5 hover:bg-[#dc004c]"
              >
                <Plus className="h-4 w-4" />
                Bakiye yükle
              </button>
            </div>
          </div>
        </div>
      </section>

      {walletQuery.isPending ? <LoadingSkeleton /> : null}
      {walletQuery.isError ? (
        <ErrorState
          title="Cüzdan bilgisi yüklenemedi"
          description={describeApiError(walletQuery.error, "Cüzdan bilgileri şu anda getirilemedi. Lütfen daha sonra tekrar dene.")}
        />
      ) : null}

      {transactionsQuery.isPending ? <LoadingSkeleton /> : null}
      {transactionsQuery.isError ? (
        <ErrorState
          title="Son hareketler yüklenemedi"
          description={describeApiError(transactionsQuery.error, "Cüzdan hareketleri şu anda getirilemedi.")}
        />
      ) : null}

      {recentTransactions.length > 0 ? (
        <section className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_60px_rgba(15,23,42,0.06)] sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-900">Son hareketler</h2>
            <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-500">Cüzdan geçmişi</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900">{getWalletTransactionLabel(tx.transaction_type)}</p>
                  <p className="mt-1 text-xs text-zinc-500">{formatDateTime(tx.created_at)}</p>
                </div>
                <div className="shrink-0 text-sm font-semibold text-zinc-900">
                  <AmountText amount={tx.amount} />
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <CustomerBottomSection />

      {isTopupOpen ? <TopupModal initialAmount={requestedAmount || undefined} onClose={() => setIsTopupOpen(false)} /> : null}
    </PageContainer>
  );
}
