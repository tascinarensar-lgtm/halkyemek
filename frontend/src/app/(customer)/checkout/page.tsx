"use client";

import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CreditCard, QrCode, ReceiptText, Sparkles, Store, Wallet } from "lucide-react";
import { toast } from "sonner";

import { QrCard } from "@/components/qr/qr-card";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { PendingButton } from "@/components/ui/pending-button";
import { createCheckoutSession, getCheckoutPreview, getCheckoutSession, getLatestCheckoutSession } from "@/features/cart/api";
import type { CartDetail, CartItemSnapshot, CheckoutSessionDetail, CheckoutSessionItem } from "@/features/cart/types";
import { createSurpriseDealCheckoutSession } from "@/features/surprise-deals/api";
import {
  clearPendingSurpriseDealSelection,
  getPendingSurpriseDealSelection,
  type PendingSurpriseDealSelection,
} from "@/features/surprise-deals/pending-selection";
import { getWalletDetail } from "@/features/wallet/api";
import { getApiErrorCode } from "@/lib/api/errors";
import { describeApiError, isConflictError, isNotFoundError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

type DisplayItem = CartItemSnapshot | CheckoutSessionItem;

function getCheckoutTotal(preview: CartDetail) {
  return preview.pricing?.total_payable_amount ?? preview.total_amount;
}

function getItemName(item: DisplayItem, fallback = "Ürün") {
  const raw = "menu_item_name" in item ? item.menu_item_name || item.name : item.name;
  return repairPotentialMojibake(String(raw || fallback));
}

function getItemSnapshot(item: DisplayItem) {
  return item.menu_item_snapshot || {};
}

function getSnapshotString(item: DisplayItem | undefined, key: string) {
  const value = item ? getItemSnapshot(item)[key] : undefined;
  return typeof value === "string" ? repairPotentialMojibake(value) : "";
}

function getItemImage(item: DisplayItem | undefined) {
  if (!item) return "";
  return (
    getSnapshotString(item, "image")
    || getSnapshotString(item, "image_url")
    || getSnapshotString(item, "primary_image_url")
    || getSnapshotString(item, "thumbnail_url")
    || getSnapshotString(item, "cover_image")
  );
}

function getBusinessNameFromPreview(preview: CartDetail) {
  return getSnapshotString(preview.items[0], "business_name") || "Seçtiğin işletme";
}

function getTopupHref(missingAmount: number, next = "/checkout") {
  const amount = Math.max(1, Math.ceil(missingAmount));
  return `/cuzdan?topup=1&amount=${amount}&next=${encodeURIComponent(next)}`;
}

function getSurpriseDealCheckoutErrorMessage(error: unknown) {
  const code = getApiErrorCode(error);

  if (code === "insufficient_wallet_balance") {
    return "Cüzdan bakiyen yetersiz. Önce bakiye yükle.";
  }
  if (code === "active_surprise_deal_reservation_exists") {
    return "Bu fırsat için zaten aktif bir QR rezervasyonun var.";
  }
  if (code === "surprise_deal_sold_out" || code === "menu_item_sold_out") {
    return "Bu fırsat az önce tükendi.";
  }

  return describeApiError(error, "Fırsat için QR hazırlanamadı.");
}

function StatusPill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "danger";
}) {
  const className =
    tone === "success"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
      : tone === "danger"
        ? "bg-red-50 text-red-700 ring-red-100"
        : "bg-zinc-100 text-zinc-700 ring-zinc-200";

  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${className}`}>{children}</span>;
}

function isActiveCheckoutSession(session: CheckoutSessionDetail | null | undefined) {
  return Boolean(session && !["CONSUMED", "EXPIRED", "CANCELLED"].includes(session.status));
}

function OrderCard({
  businessName,
  items,
  itemCount,
  totalAmount,
  currency,
}: {
  businessName: string;
  items: DisplayItem[];
  itemCount: number;
  totalAmount: number;
  currency: string;
}) {
  const primaryItem = items[0];
  const primaryImage = getItemImage(primaryItem);
  const title = items.length === 1 ? getItemName(primaryItem) : `${itemCount} ürünlük sipariş`;

  return (
    <Card className="overflow-hidden border-zinc-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.08)]">
      <CardContent className="p-0">
        <div className="grid gap-0 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="relative min-h-[190px] bg-zinc-100 sm:min-h-[240px] lg:min-h-full">
            {primaryImage ? (
              <Image src={primaryImage} alt={title} fill unoptimized sizes="(max-width: 1024px) 100vw, 420px" className="object-cover" />
            ) : (
              <div className="flex h-full min-h-[190px] items-center justify-center bg-[radial-gradient(circle_at_30%_20%,rgba(245,5,85,0.18),transparent_34%),linear-gradient(135deg,#fff7ed,#f8fafc)] text-zinc-400 sm:min-h-[240px]">
                <Store className="h-16 w-16" />
              </div>
            )}
            <div className="absolute left-4 top-4 rounded-full bg-white/92 px-3 py-1 text-xs font-semibold text-zinc-800 shadow-sm backdrop-blur">
              QR ile teslim
            </div>
          </div>

          <div className="space-y-6 p-5 sm:p-7">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill>{businessName}</StatusPill>
                <StatusPill>{itemCount} adet</StatusPill>
              </div>
              <h1 className="text-3xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-4xl">{title}</h1>
            </div>

            <div className="rounded-[26px] bg-[#f50555] p-5 text-white shadow-[0_18px_46px_rgba(245,5,85,0.24)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">Ödenecek tutar</p>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.06em] sm:text-5xl">
                <AmountText amount={totalAmount} currency={currency} />
              </div>
            </div>

            <div className="space-y-3">
              {items.map((item, index) => (
                <div key={`${item.menu_item_id ?? index}-${index}`} className="flex items-center justify-between gap-4 rounded-2xl bg-zinc-50 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-950">{getItemName(item, `Ürün ${index + 1}`)}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{item.quantity} adet</p>
                  </div>
                  <div className="shrink-0 text-sm font-semibold text-zinc-900">
                    <AmountText amount={item.line_total_amount} currency={currency} />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500">Toplam</p>
              <p className="mt-1 text-lg font-semibold text-zinc-950">
                <AmountText amount={totalAmount} currency={currency} />
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SurpriseSelectionCard({ selection }: { selection: PendingSurpriseDealSelection }) {
  const pickupWindow = `${formatDateTime(selection.pickup_window_start)} - ${formatDateTime(selection.pickup_window_end)}`;

  return (
    <Card className="overflow-hidden border-violet-100 bg-white shadow-[0_22px_70px_rgba(76,29,149,0.08)]">
      <CardContent className="p-0">
        <div className="grid gap-0 lg:grid-cols-[0.86fr_1.14fr]">
          <div className="relative min-h-[210px] bg-[#F5F3FF] sm:min-h-[250px] lg:min-h-full">
            {selection.image_url ? (
              <Image src={selection.image_url} alt={selection.title} fill unoptimized sizes="(max-width: 1024px) 100vw, 420px" className="object-cover" />
            ) : (
              <div className="flex h-full min-h-[210px] items-center justify-center bg-[linear-gradient(145deg,#F5F3FF,#EDE9FE)] text-[#6D28D9] sm:min-h-[250px]">
                <Sparkles className="h-16 w-16" />
              </div>
            )}
            <div className="absolute left-4 top-4 rounded-full bg-white/92 px-3 py-1 text-xs font-semibold text-[#5B21B6] shadow-sm backdrop-blur">
              Son Dakika Fırsatı
            </div>
          </div>

          <div className="space-y-6 p-5 sm:p-7">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill>{selection.business_name}</StatusPill>
                <StatusPill tone={selection.quantity_remaining > 0 ? "success" : "danger"}>
                  {selection.quantity_remaining > 0 ? `${selection.quantity_remaining} adet kaldı` : "Tükendi"}
                </StatusPill>
              </div>
              <h1 className="text-3xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-4xl">{selection.title}</h1>
              <p className="text-sm leading-6 text-zinc-600">
                {selection.description || "Seçtiğin sürpriz paketi burada gözden geçirip QR oluşturma adımına geçebilirsin."}
              </p>
            </div>

            <div className="rounded-[26px] bg-[linear-gradient(135deg,#6D28D9,#7C3AED)] p-5 text-white shadow-[0_18px_46px_rgba(109,40,217,0.24)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Ödenecek tutar</p>
              <div className="mt-2 text-3xl font-semibold tracking-[-0.06em] sm:text-5xl">
                <AmountText amount={selection.sale_price_amount} currency={selection.currency} />
              </div>
              <div className="mt-3 text-sm font-semibold text-violet-100 line-through decoration-2 decoration-violet-100/60">
                <AmountText amount={selection.original_value_amount} currency={selection.currency} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6D28D9]">Teslim aralığı</p>
                <p className="mt-1 text-sm font-semibold text-zinc-950">{pickupWindow}</p>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6D28D9]">Gramaj</p>
                <p className="mt-1 text-sm font-semibold text-zinc-950">{selection.grams ? `${selection.grams} gr` : "Gram bilgisi yok"}</p>
              </div>
              <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6D28D9]">Kalan fırsat</p>
                <p className="mt-1 text-sm font-semibold text-zinc-950">
                  {selection.quantity_remaining > 0 ? `${selection.quantity_remaining} adet kaldı` : "Tükendi"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Minimum içerik</p>
                <p className="mt-1 text-sm leading-6 text-zinc-700">{selection.min_contents_note || "İşletmenin o gün uygun ürünleriyle hazırlanır."}</p>
              </div>
              <div className="rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Alerjen bilgisi</p>
                <p className="mt-1 text-sm leading-6 text-zinc-700">{selection.allergens_note || "Teslim sırasında işletmeden teyit edebilirsin."}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WalletActionCard({
  balance,
  totalAmount,
  missingAmount,
  canPrepareQr,
  isWalletLoading,
  walletProblem,
  onPrepareQr,
  isPending,
  insufficientTitle = "Bakiye yetersiz",
  insufficientDescription,
  readyTitle = "QR kodunu hazırla",
  readyDescription = "Ödeme tutarı cüzdanından kasada QR onayıyla düşer.",
  actionLabel = "QR kodu hazırla",
  topupNext = "/checkout",
}: {
  balance: number;
  totalAmount: number;
  missingAmount: number;
  canPrepareQr: boolean;
  isWalletLoading: boolean;
  walletProblem: string | null;
  onPrepareQr: () => void;
  isPending: boolean;
  insufficientTitle?: string;
  insufficientDescription?: string;
  readyTitle?: string;
  readyDescription?: string;
  actionLabel?: string;
  topupNext?: string;
}) {
  if (isWalletLoading) {
    return (
      <Card className="border-zinc-200">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <LoadingSkeleton />
        </CardContent>
      </Card>
    );
  }

  if (!canPrepareQr) {
    return (
      <Card className="border-red-100 bg-red-50/70">
        <CardContent className="space-y-5 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-red-600 shadow-sm">
              <Wallet className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">QR hazırlanamadı</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-zinc-950">{insufficientTitle}</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {walletProblem || insufficientDescription || "Cüzdan bakiyeni tamamladıktan sonra devam edebilirsin."}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Cüzdan</p>
              <p className="mt-1 text-lg font-semibold text-zinc-950"><AmountText amount={balance} /></p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Gerekli</p>
              <p className="mt-1 text-lg font-semibold text-zinc-950"><AmountText amount={totalAmount} /></p>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Yüklenecek</p>
              <p className="mt-1 text-lg font-semibold text-red-700"><AmountText amount={missingAmount} /></p>
            </div>
          </div>

          <Link href={getTopupHref(missingAmount, topupNext)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(245,5,85,0.22)] transition hover:-translate-y-0.5 hover:bg-[#dc004c]">
            Eksik tutarı cüzdana yükle
            <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden border-rose-100 bg-[radial-gradient(circle_at_top_left,_rgba(245,5,85,0.10),_transparent_34%),linear-gradient(180deg,_#fff,_#fff7fb)] shadow-[0_22px_70px_rgba(245,5,85,0.08)]">
      <CardContent className="space-y-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#f50555] shadow-sm ring-1 ring-rose-100">
            <CreditCard className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f50555]">Bakiye yeterli</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.04em] text-zinc-950">{readyTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{readyDescription}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Cüzdan bakiyesi</p>
            <p className="mt-1 text-xl font-semibold text-zinc-950"><AmountText amount={balance} /></p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Sipariş tutarı</p>
            <p className="mt-1 text-xl font-semibold text-zinc-950"><AmountText amount={totalAmount} /></p>
          </div>
        </div>

        <PendingButton
          type="button"
          onClick={onPrepareQr}
          pending={isPending}
          pendingText="QR hazırlanıyor..."
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#f50555,#ff477f)] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_44px_rgba(245,5,85,0.30)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_54px_rgba(245,5,85,0.36)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {actionLabel}
          <QrCode className="h-4 w-4" />
        </PendingButton>
      </CardContent>
    </Card>
  );
}

function QrReadyCard({ session }: { session: CheckoutSessionDetail }) {
  const businessName = repairPotentialMojibake(session.business.name);

  return (
    <Card className="overflow-hidden border-zinc-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.08)]">
      <CardContent className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="success">QR hazır</StatusPill>
            <StatusPill>{businessName}</StatusPill>
          </div>
          <div>
            <h2 className="text-3xl font-semibold tracking-[-0.05em] text-zinc-950">Kasada bu kartı göster</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-500">QR okunmazsa kasa kodunu söyleyerek aynı siparişi doğrulatabilirsin.</p>
          </div>

          <div className="rounded-[26px] bg-[#f50555] p-5 text-white shadow-[0_18px_46px_rgba(245,5,85,0.24)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">Ödenecek tutar</p>
            <div className="mt-2 text-3xl font-semibold tracking-[-0.06em] sm:text-5xl">
              <AmountText amount={session.total_payable_amount} currency={session.currency} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Ürün adedi</p>
              <p className="mt-1 text-xl font-semibold text-zinc-950">{session.item_count}</p>
            </div>
            <div className="rounded-2xl bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Son geçerlilik</p>
              <p className="mt-1 text-sm font-semibold text-zinc-950">{formatDateTime(session.expires_at)}</p>
            </div>
          </div>

          {session.cashier_code ? (
            <div className="rounded-[24px] border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Kasa kodu</p>
              <p className="mt-2 break-all text-3xl font-semibold tracking-[0.14em] text-zinc-950 sm:text-4xl sm:tracking-[0.22em]">{session.cashier_code}</p>
            </div>
          ) : null}

          <Link href="/siparislerim" className="inline-flex w-full items-center justify-center rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(245,5,85,0.20)] transition hover:-translate-y-0.5 hover:bg-[#dc004c]">
            Siparişlerime git
          </Link>
        </div>

        <div className="flex items-center justify-center rounded-[30px] bg-zinc-50 p-4 sm:p-6">
          <QrCard value={session.token} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function CheckoutPage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [pendingSurpriseSelection, setPendingSurpriseSelection] = useState<PendingSurpriseDealSelection | null>(null);
  const [pendingSurpriseLoaded, setPendingSurpriseLoaded] = useState(false);

  const preferredSource = searchParams.get("source") === "surprise_deal" ? "surprise_deal" : "cart";

  useEffect(() => {
    setPendingSurpriseSelection(getPendingSurpriseDealSelection());
    setPendingSurpriseLoaded(true);
  }, []);

  const previewQuery = useQuery({
    queryKey: ["cart", "checkout-preview"],
    queryFn: getCheckoutPreview,
    retry: 0,
    enabled: preferredSource !== "surprise_deal",
  });

  const walletQuery = useQuery({
    queryKey: ["wallet", "detail"],
    queryFn: getWalletDetail,
    retry: 0,
  });

  const previewMissingCart = preferredSource !== "surprise_deal" && previewQuery.isError && isNotFoundError(previewQuery.error);

  const latestSessionQuery = useQuery({
    queryKey: ["checkout-session", "latest"],
    queryFn: getLatestCheckoutSession,
    retry: 0,
    enabled: !activeToken && (preferredSource === "surprise_deal" || previewMissingCart),
    refetchInterval: (query) => {
      const session = query.state.data;
      return isActiveCheckoutSession(session) ? 5_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const activeSessionQuery = useQuery({
    queryKey: ["checkout-session", activeToken],
    queryFn: () => getCheckoutSession(activeToken || ""),
    enabled: Boolean(activeToken),
    retry: 0,
    refetchInterval: (query) => {
      const session = query.state.data;
      if (!session || ["CONSUMED", "EXPIRED", "CANCELLED"].includes(session.status)) return false;
      return 5_000;
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: createCheckoutSession,
    onSuccess: async (session) => {
      setActiveToken(session.token);
      queryClient.setQueryData(["checkout-session", session.token], session);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart", "detail"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
        queryClient.invalidateQueries({ queryKey: ["checkout-session", "latest"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet", "detail"] }),
      ]);
      toast.success("QR hazır.");
    },
    onError: (error) => {
      if (isConflictError(error)) {
        const code = getApiErrorCode(error);
        const quotaError = code === "menu_item_sold_out" || code === "menu_item_quota_exceeded";

        toast.error(describeApiError(error, "QR hazırlanıyor. Kısa süre sonra tekrar kontrol edin."), {
          description: quotaError ? "Sepetini güncelleyip tekrar dene." : undefined,
        });
        return;
      }

      toast.error(describeApiError(error, "QR hazırlanamadı."));
    },
  });

  const surpriseCheckoutMutation = useMutation({
    mutationFn: (selection: PendingSurpriseDealSelection) => createSurpriseDealCheckoutSession(selection.deal_id, { quantity: 1 }),
    onSuccess: async (response) => {
      clearPendingSurpriseDealSelection();
      setPendingSurpriseSelection(null);
      setActiveToken(response.checkout_session.token);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["checkout-session", "latest"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet", "detail"] }),
        queryClient.invalidateQueries({ queryKey: ["surprise-deals"] }),
      ]);
      toast.success("QR hazırlanıyor.", {
        description: "Sürpriz paketin için teslim kartı oluşturuluyor.",
      });
    },
    onError: (error) => {
      toast.error(getSurpriseDealCheckoutErrorMessage(error), {
        description: getApiErrorCode(error) === "surprise_deal_sold_out" ? "Farklı bir fırsat seçip tekrar deneyebilirsin." : undefined,
      });
    },
  });

  const activeSessionToShow = isActiveCheckoutSession(activeSessionQuery.data) ? activeSessionQuery.data : null;
  const mutationSessionToShow = isActiveCheckoutSession(checkoutMutation.data) ? checkoutMutation.data : null;
  const latestSessionToShow = isActiveCheckoutSession(latestSessionQuery.data) ? latestSessionQuery.data : null;
  const activeSessionReachedFinalStatus = Boolean(activeSessionQuery.data && !isActiveCheckoutSession(activeSessionQuery.data));
  const sessionToShow = activeSessionReachedFinalStatus ? null : activeSessionToShow || mutationSessionToShow || latestSessionToShow || null;

  useEffect(() => {
    if (sessionToShow?.source_type === "SURPRISE_DEAL") {
      clearPendingSurpriseDealSelection();
      setPendingSurpriseSelection(null);
    }
  }, [sessionToShow?.source_type, sessionToShow?.token]);

  const wallet = walletQuery.data;
  const walletBalance = wallet?.balance ?? 0;
  const walletProblem = walletQuery.isError
    ? describeApiError(walletQuery.error, "Cüzdan bakiyesi şu anda okunamadı.")
    : wallet && !wallet.is_active
      ? wallet.restriction_reason || "Cüzdan şu anda işlem için aktif değil."
      : null;

  const surpriseMissingAmount = pendingSurpriseSelection ? Math.max(pendingSurpriseSelection.sale_price_amount - walletBalance, 0) : 0;
  const canPrepareSurpriseQr = Boolean(
    pendingSurpriseSelection && wallet && wallet.is_active && !walletProblem && surpriseMissingAmount <= 0,
  );

  if (activeToken && activeSessionQuery.isPending && !activeSessionQuery.data) {
    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <LoadingSkeleton />
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  if (preferredSource === "surprise_deal" && !pendingSurpriseLoaded && !sessionToShow) {
    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <LoadingSkeleton />
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  if (preferredSource !== "surprise_deal" && previewQuery.isPending && !sessionToShow) {
    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <LoadingSkeleton />
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  if (sessionToShow) {
    const totalAmount = sessionToShow.total_payable_amount;
    const missingAmount = wallet ? Math.max(totalAmount - walletBalance, 0) : totalAmount;
    const canShowQr = Boolean(wallet && wallet.is_active && !walletProblem && missingAmount <= 0);

    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        {canShowQr ? (
          <QrReadyCard session={sessionToShow} />
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
            <OrderCard
              businessName={repairPotentialMojibake(sessionToShow.business.name)}
              items={sessionToShow.items}
              itemCount={sessionToShow.item_count}
              totalAmount={sessionToShow.total_payable_amount}
              currency={sessionToShow.currency}
            />
            <WalletActionCard
              balance={walletBalance}
              totalAmount={totalAmount}
              missingAmount={missingAmount}
              canPrepareQr={false}
              isWalletLoading={walletQuery.isPending}
              walletProblem={walletProblem}
              onPrepareQr={() => undefined}
              isPending={false}
            />
          </div>
        )}
      </PageContainer>
    );
  }

  if (preferredSource === "surprise_deal") {
    if (!pendingSurpriseSelection) {
      return (
        <PageContainer className="space-y-5 bg-white sm:space-y-6">
          <EmptyState
            title="Sepetinde HalkTasarruf fırsatı yok"
            description="Bir fırsat seçip sepete eklediğinde burada gözden geçirip QR oluşturabileceksin."
          />
          <div className="flex flex-wrap gap-3">
            <Link href="/halktasarruf" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#6D28D9] px-5 py-3 text-sm font-semibold text-white hover:bg-[#5B21B6]">
              HalkTasarruf&apos;a dön
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/qrlarim" className="inline-flex items-center justify-center rounded-2xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-200">
              QRlarım
            </Link>
          </div>
        </PageContainer>
      );
    }

    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#6D28D9]">
              <Sparkles className="h-3.5 w-3.5" /> Sürpriz paketini oluştur
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.055em] text-zinc-950 sm:text-4xl">Sepetine eklediğin fırsatı gözden geçir</h1>
          </div>
          <Link href="/qrlarim" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(109,40,217,0.20)] transition hover:-translate-y-0.5 hover:bg-[#5B21B6] sm:w-auto">
            QRlarım
            <QrCode className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
          <SurpriseSelectionCard selection={pendingSurpriseSelection} />

          <div className="space-y-4">
            <WalletActionCard
              balance={walletBalance}
              totalAmount={pendingSurpriseSelection.sale_price_amount}
              missingAmount={surpriseMissingAmount}
              canPrepareQr={canPrepareSurpriseQr}
              isWalletLoading={walletQuery.isPending}
              walletProblem={walletProblem}
              onPrepareQr={() => surpriseCheckoutMutation.mutate(pendingSurpriseSelection)}
              isPending={surpriseCheckoutMutation.isPending}
              insufficientDescription="Bu fırsat için önce cüzdanına eksik tutar kadar bakiye yüklemen gerekiyor."
              readyDescription="Sürpriz paketini ayırdın. Son adımda QR kartını hazırlayıp teslim saatinde kasada okutabilirsin."
              topupNext="/checkout?source=surprise_deal"
            />

            <button
              type="button"
              onClick={() => {
                clearPendingSurpriseDealSelection();
                setPendingSurpriseSelection(null);
                toast.success("Fırsat sepetten çıkarıldı.");
              }}
              className="inline-flex w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              Fırsatı sepetten çıkar
            </button>
          </div>
        </div>
      </PageContainer>
    );
  }

  if (previewMissingCart) {
    if (latestSessionQuery.isPending) {
      return (
        <PageContainer className="space-y-5 bg-white sm:space-y-6">
          <LoadingSkeleton />
        </PageContainer>
      );
    }

    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <EmptyState title="Hazır QR veya sepet yok" description="Yeni QR oluşturmak için önce menülerden ürün ekleyip sepetini hazırlamalısın." />
        <div className="flex flex-wrap gap-3">
          <Link href="/" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
            Menülere dön
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/siparislerim" className="inline-flex items-center justify-center rounded-2xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900 hover:bg-zinc-200">
            Siparişlerim
          </Link>
        </div>
      </PageContainer>
    );
  }

  if (previewQuery.isError) {
    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <ErrorState title="Sipariş sayfası yüklenemedi" description={describeApiError(previewQuery.error, "Sepet ve ödeme bilgileri şu anda getirilemedi.")} />
      </PageContainer>
    );
  }

  const preview = previewQuery.data;
  if (!preview) {
    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  const totalAmount = getCheckoutTotal(preview);
  const missingAmount = wallet ? Math.max(totalAmount - walletBalance, 0) : totalAmount;
  const canPrepareQr = Boolean(wallet && wallet.is_active && !walletProblem && missingAmount <= 0 && preview.item_count > 0);

  if (preview.item_count === 0) {
    return (
      <PageContainer className="space-y-5 bg-white sm:space-y-6">
        <EmptyState title="Sepetin boş" description="QR hazırlamak için önce bir menüyü sepetine eklemelisin." />
        <Link href="/" className="inline-flex w-fit items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
          Menülere dön
          <ArrowRight className="h-4 w-4" />
        </Link>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-5 bg-white sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#f50555]">
            <ReceiptText className="h-3.5 w-3.5" /> Siparişini oluştur
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.055em] text-zinc-950 sm:text-4xl">Siparişini oluştur</h1>
        </div>
        <Link href="/qrlarim" className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(245,5,85,0.20)] transition hover:-translate-y-0.5 hover:bg-[#dc004c] sm:w-auto">
          QRlarım
          <QrCode className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
        <OrderCard
          businessName={getBusinessNameFromPreview(preview)}
          items={preview.items}
          itemCount={preview.item_count}
          totalAmount={totalAmount}
          currency={preview.currency}
        />
        <WalletActionCard
          balance={walletBalance}
          totalAmount={totalAmount}
          missingAmount={missingAmount}
          canPrepareQr={canPrepareQr}
          isWalletLoading={walletQuery.isPending}
          walletProblem={walletProblem}
          onPrepareQr={() => checkoutMutation.mutate()}
          isPending={checkoutMutation.isPending}
        />
      </div>
    </PageContainer>
  );
}
