"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { Clock3, ShoppingBag, Sparkles, X } from "lucide-react";

import { SurpriseDealCheckoutButton } from "@/components/surprise-deals/surprise-deal-checkout-button";
import type { SurpriseDealPublic } from "@/features/surprise-deals/types";

function formatAmount(amount: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function formatPickupDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long" }).format(date);
}

function formatPickupTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatPickupWindow(deal: SurpriseDealPublic) {
  return `${formatPickupTime(deal.pickup_window_start)} - ${formatPickupTime(deal.pickup_window_end)}`;
}

function getRemainingText(deal: SurpriseDealPublic) {
  if (deal.is_sold_out || deal.quantity_remaining <= 0) return "Tükendi";
  return `${deal.quantity_remaining} adet kaldı`;
}

type SurpriseDealQuickViewProps = {
  businessHref: string;
  deal: SurpriseDealPublic;
  isAuthenticated: boolean;
  onClose: () => void;
  returnHref: string;
  secondaryActionLabel?: string;
};

export function SurpriseDealQuickView({
  businessHref,
  deal,
  isAuthenticated,
  onClose,
  returnHref,
  secondaryActionLabel = "İşletmeyi gör",
}: SurpriseDealQuickViewProps) {
  const pickupWindowLabel = `${formatPickupDate(deal.pickup_window_start)} · ${formatPickupWindow(deal)}`;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/58 px-3 py-4 backdrop-blur-[3px] sm:px-5 sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="halktasarruf-deal-modal-title"
    >
      <button type="button" aria-label="Fırsat detayını kapat" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
        <button
          type="button"
          aria-label="Fırsat detayını kapat"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/96 text-zinc-700 shadow-[0_10px_30px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:text-[#6D28D9]"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="relative aspect-[16/10] shrink-0 bg-[#F5F3FF] sm:aspect-[16/9]">
          {deal.image_url ? (
            <Image
              src={deal.image_url}
              alt={`${deal.business.name} - ${deal.title}`}
              fill
              unoptimized
              sizes="(max-width: 768px) 100vw, 640px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-[linear-gradient(145deg,#F5F3FF,#EDE9FE)] text-center">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6D28D9]">HalkTasarruf</span>
              <p className="text-sm text-zinc-600">Fırsat görseli eklenmemiş</p>
            </div>
          )}
          <span className="absolute left-4 top-4 rounded-full bg-[#6D28D9] px-3 py-1.5 text-xs font-semibold text-white shadow-sm">
            {getRemainingText(deal)}
          </span>
          <span className="absolute bottom-4 right-4 rounded-full bg-zinc-950/90 px-3.5 py-2 text-xs font-semibold text-white shadow-sm">
            {pickupWindowLabel}
          </span>
        </div>

        <div className="overflow-y-auto px-5 pb-5 pt-5 sm:px-6 sm:pb-6">
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <span className="inline-flex rounded-full bg-violet-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#5B21B6]">
                    Son Dakika Fırsatı
                  </span>
                  <h2 id="halktasarruf-deal-modal-title" className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950">
                    {deal.title}
                  </h2>
                  <p className="text-sm font-medium text-zinc-500">{deal.business.name}</p>
                </div>

                <div className="rounded-[22px] bg-[#F5F3FF] px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6D28D9]">Ödenecek tutar</p>
                  <p className="mt-1 text-2xl font-semibold text-[#4C1D95]">{formatAmount(deal.sale_price_amount, deal.currency)}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <span className="text-sm font-semibold text-[#E11D48] line-through decoration-2 decoration-[#E11D48]/70">
                  {formatAmount(deal.original_value_amount, deal.currency)}
                </span>
                <span className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-[#6D28D9]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Tahmini değer
                </span>
              </div>

              <p className="text-sm leading-7 text-zinc-600">
                {deal.description || "İşletmenin gün sonuna kalan iyi ürünlerinden hazırlanan sürpriz paketi teslim saatinde alabilirsin."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[22px] border border-violet-100 bg-violet-50/85 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D28D9]">Teslim aralığı</p>
                <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-zinc-950">
                  <Clock3 className="h-4 w-4 text-[#6D28D9]" />
                  {pickupWindowLabel}
                </p>
              </div>
              <div className="rounded-[22px] border border-violet-100 bg-violet-50/85 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D28D9]">Kalan fırsat</p>
                <p className="mt-2 text-sm font-semibold text-zinc-950">{getRemainingText(deal)}</p>
              </div>
              <div className="rounded-[22px] border border-violet-100 bg-violet-50/85 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#6D28D9]">Gramaj</p>
                <p className="mt-2 text-sm font-semibold text-zinc-950">{deal.grams ? `${deal.grams} gr` : "Gram bilgisi yok"}</p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] border border-zinc-100 bg-zinc-50/90 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Minimum içerik</p>
                <p className="mt-1 text-sm leading-6 text-zinc-700">{deal.min_contents_note || "İşletmenin o gün uygun olan ürünlerinden hazırlanır."}</p>
              </div>
              <div className="rounded-[22px] border border-zinc-100 bg-zinc-50/90 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Alerjen bilgisi</p>
                <p className="mt-1 text-sm leading-6 text-zinc-700">{deal.allergens_note || "İçerik bilgisini teslim sırasında işletmeden teyit et."}</p>
              </div>
            </div>

            <div className="rounded-[22px] border border-zinc-100 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
              <div className="flex items-start gap-3">
                <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#F5F3FF] text-[#6D28D9]">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-zinc-950">Önce sepete al, sonra QR hazırla</p>
                  <p className="text-sm leading-6 text-zinc-600">
                    Paketi sepetine eklediğinde stok senin için ayrılır. Sipariş ekranında tekrar kontrol edip QR kodunu orada hazırlarsın.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-2 sm:pt-5">
              <SurpriseDealCheckoutButton
                deal={deal}
                isAuthenticated={isAuthenticated}
                returnHref={returnHref}
                disabled={deal.is_sold_out || deal.quantity_remaining <= 0}
                onSuccess={onClose}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#6D28D9] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(109,40,217,0.24)] transition hover:-translate-y-0.5 hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none"
                authenticatedLabel={
                  <>
                    <ShoppingBag className="h-4 w-4" />
                    {deal.is_sold_out ? "Tükendi" : "Sepete ekle"}
                  </>
                }
                unauthenticatedLabel={
                  <>
                    <ShoppingBag className="h-4 w-4" />
                    {deal.is_sold_out ? "Tükendi" : "Giriş yapıp sepete ekle"}
                  </>
                }
              />

              <Link
                href={businessHref}
                onClick={onClose}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-[#6D28D9]/30 hover:text-[#6D28D9]"
              >
                {secondaryActionLabel}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
