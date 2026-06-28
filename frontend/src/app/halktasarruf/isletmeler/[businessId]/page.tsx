"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Clock3, MapPin, PackageOpen, Sparkles, Store, UtensilsCrossed } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";

import { SurpriseDealCheckoutButton } from "@/components/surprise-deals/surprise-deal-checkout-button";
import { SurpriseDealQuickView } from "@/components/surprise-deals/surprise-deal-quick-view";
import { AmountText } from "@/components/ui/amount-text";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { usePublicBusinessDetail } from "@/features/discovery/hooks";
import { resolveDistrict, resolvePositiveIntegerParam, withSearchParams } from "@/features/discovery/params";
import { useSurpriseDeals } from "@/features/surprise-deals/hooks";
import type { SurpriseDealPublic } from "@/features/surprise-deals/types";
import { useSession } from "@/hooks/use-session";
import { describeApiError, isNotFoundError } from "@/lib/api/presentation";
import { getMapsDirectionsUrl } from "@/lib/maps";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

const districtLabels: Record<string, string> = {
  BEYLIKDUZU: "İstanbul/Beylikdüzü",
};

function getHalkTasarrufPageHref(district: string, hash = "") {
  return `${withSearchParams("/halktasarruf", { district })}${hash}`;
}

function getRemainingLabel(quantityRemaining: number) {
  if (quantityRemaining <= 0) return "Tükendi";
  if (quantityRemaining <= 5) return `Son ${quantityRemaining} adet`;
  return `${quantityRemaining} adet kaldı`;
}

export default function HalkTasarrufBusinessDetailPage() {
  const params = useParams<{ businessId: string }>();
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const sessionQuery = useSession();
  const businessId = resolvePositiveIntegerParam(params.businessId, 0);
  const isValidBusinessId = businessId > 0;
  const [selectedDeal, setSelectedDeal] = useState<SurpriseDealPublic | null>(null);

  const detailQuery = usePublicBusinessDetail(businessId);
  const dealsQuery = useSurpriseDeals({ district, business: businessId });

  if (!isValidBusinessId) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState
          title="Geçersiz işletme bağlantısı"
          description="HalkTasarruf işletme bağlantısı okunamadı. Güvenli şekilde fırsatlara geri dönebilirsin."
        />
        <Link href={getHalkTasarrufPageHref(district, "#halktasarruf-isletmeleri")} className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-900">
          <ArrowLeft className="h-4 w-4" />
          HalkTasarruf işletmelerine dön
        </Link>
      </PageContainer>
    );
  }

  if (detailQuery.isPending || dealsQuery.isPending) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <LoadingSkeleton />
        <div className="grid gap-5 lg:grid-cols-3">
          <LoadingSkeleton />
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      </PageContainer>
    );
  }

  if (detailQuery.isError) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState
          title={isNotFoundError(detailQuery.error) ? "İşletme bulunamadı" : "İşletme profili yüklenemedi"}
          description={describeApiError(
            detailQuery.error,
            isNotFoundError(detailQuery.error)
              ? "Bu HalkTasarruf işletmesi artık görünmüyor veya bağlantı güncel değil."
              : "İşletme bilgileri şu anda getirilemedi. Lütfen kısa süre sonra tekrar dene.",
          )}
        />
        <Link href={getHalkTasarrufPageHref(district, "#halktasarruf-isletmeleri")} className="inline-flex items-center gap-2 text-sm font-semibold text-violet-700 hover:text-violet-900">
          <ArrowLeft className="h-4 w-4" />
          HalkTasarruf işletmelerine dön
        </Link>
      </PageContainer>
    );
  }

  if (!detailQuery.data) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <EmptyState title="İşletme profili alınamadı" description="İstek tamamlandı ancak gösterilebilir işletme verisi dönmedi." />
      </PageContainer>
    );
  }

  const detail = detailQuery.data;
  const business = detail.business;
  const deals = dealsQuery.data?.results ?? [];
  const businessName = repairPotentialMojibake(business.business_name);
  const cover = business.cover_image || detail.media.find((asset) => asset.asset_role === "COVER")?.url || "";
  const logo = business.logo_image || detail.media.find((asset) => asset.asset_role === "LOGO")?.url || "";
  const districtLabel = repairPotentialMojibake(business.district_label) || districtLabels[district] || district;
  const shortDescription = repairPotentialMojibake(business.short_description || "") || "Son dakika fırsatlarını aynı gün teslim alabileceğin HalkTasarruf işletmesi.";
  const mapsUrl = getMapsDirectionsUrl(business);
  const activeDealCount = deals.length;
  const totalRemaining = deals.reduce((sum, item) => sum + Math.max(0, item.quantity_remaining), 0);
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const minPriceDeal = deals.reduce<(typeof deals)[number] | null>((current, item) => {
    if (!current) return item;
    return item.sale_price_amount < current.sale_price_amount ? item : current;
  }, null);

  return (
    <PageContainer className="space-y-8 bg-white sm:space-y-10">
      <section className="overflow-hidden rounded-[28px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.1)]">
        <div className="relative min-h-[560px] overflow-hidden bg-[#4C1D95] sm:min-h-[560px] lg:min-h-[500px]">
          {cover ? (
            <Image src={cover} alt={businessName} fill unoptimized priority sizes="100vw" className="object-cover" />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.28),transparent_34%),linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,24,39,0.14),rgba(17,24,39,0.42)_42%,rgba(17,24,39,0.82)_100%)]" />

          <div className="absolute left-4 right-4 top-4 z-30 flex items-center justify-between gap-3 sm:left-7 sm:right-7 sm:top-7">
            <Link
              href={getHalkTasarrufPageHref(district, "#halktasarruf-isletmeleri")}
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/16 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/24 backdrop-blur transition hover:bg-white/24"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              HalkTasarruf işletmelerine dön
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              HalkTasarruf işletmesi
            </span>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 p-4 pt-24 sm:p-7 lg:p-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-end">
              <div className="max-w-3xl text-white">
                <div className="mt-5 flex items-end gap-3 sm:gap-4">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[22px] border border-white/25 bg-white/92 shadow-[0_18px_40px_rgba(0,0,0,0.22)] sm:h-20 sm:w-20 sm:rounded-[26px]">
                    {logo ? (
                      <Image src={logo} alt={businessName} fill unoptimized sizes="80px" className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-violet-700">HT</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-3xl font-semibold tracking-[-0.05em] sm:text-5xl">{businessName}</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-violet-50/92 sm:text-base">{shortDescription}</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2.5">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/94 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-white/40">
                    <MapPin className="h-4 w-4 text-violet-700" />
                    {districtLabel}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/94 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-white/40">
                    <UtensilsCrossed className="h-4 w-4 text-violet-700" />
                    {repairPotentialMojibake(business.primary_marketplace_category?.name || business.badge_text || "HalkTasarruf işletmesi")}
                  </span>
                </div>
              </div>

              <div className="rounded-[24px] bg-white/95 p-4 text-zinc-950 shadow-[0_22px_60px_rgba(0,0,0,0.22)] backdrop-blur sm:rounded-[28px]">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">İşletme özeti</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Fırsatları keşfetmeden önce</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    <div className="rounded-2xl bg-violet-50 p-3">
                      <p className="text-xs font-semibold text-violet-700">Aktif paket</p>
                      <p className="mt-1 text-lg font-semibold">{activeDealCount}</p>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-xs font-semibold text-zinc-500">Kalan toplam</p>
                      <p className="mt-1 text-lg font-semibold">{totalRemaining} adet</p>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-xs font-semibold text-zinc-500">Başlayan fiyat</p>
                      <p className="mt-1 text-base font-semibold leading-6">
                        {minPriceDeal ? <AmountText amount={minPriceDeal.sale_price_amount} currency={minPriceDeal.currency} /> : "-"}
                      </p>
                    </div>
                    {mapsUrl ? (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex min-h-[86px] flex-col justify-between rounded-2xl bg-gradient-to-br from-[#6D28D9] to-[#4C1D95] p-3 text-left text-white shadow-[0_16px_34px_rgba(109,40,217,0.22)] ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(109,40,217,0.32)]"
                      >
                        <span className="text-xs font-semibold text-white/75">Konum</span>
                        <span className="inline-flex items-center gap-2 text-base font-semibold leading-6 transition-all group-hover:gap-3">
                          <MapPin className="h-5 w-5 rounded-full bg-white/16 p-0.5" />
                          İşletmeye git
                        </span>
                      </a>
                    ) : (
                      <div className="rounded-2xl bg-zinc-50 p-3">
                        <p className="text-xs font-semibold text-zinc-500">Konum</p>
                        <p className="mt-1 text-base font-semibold leading-6">Konum yakında</p>
                      </div>
                    )}
                  </div>
                  <Link
                    href="#surpriz-paketler"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#6D28D9] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(109,40,217,0.24)] transition hover:-translate-y-0.5 hover:bg-[#5B21B6]"
                  >
                    Paketlere git
                    <PackageOpen className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="surpriz-paketler" className="scroll-mt-28 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700 sm:text-[31px]">Aktif sürpriz paketler</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              Bu işletmenin bugün yayında olan fırsat paketlerini burada görebilirsin.
            </p>
          </div>
          <Link
            href={getHalkTasarrufPageHref(district, "#son-dakika-firsatlari")}
            className="hidden items-center gap-2 text-sm font-semibold text-violet-700 transition hover:text-violet-900 sm:inline-flex"
          >
            Tüm fırsatlara dön
            <PackageOpen className="h-4 w-4" />
          </Link>
        </div>

        {dealsQuery.isError ? (
          <ErrorState title="Paketler yüklenemedi" description={describeApiError(dealsQuery.error, "Bu işletmenin fırsat paketleri şu anda getirilemedi.")} />
        ) : deals.length > 0 ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {deals.map((deal) => (
              <article id={`firsat-${deal.id}`} key={deal.id} className="space-y-3">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedDeal(deal)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedDeal(deal);
                    }
                  }}
                  className="group overflow-hidden rounded-[22px] border border-zinc-100 bg-white text-left shadow-[0_12px_30px_rgba(15,23,42,0.06)] outline-none ring-violet-200/40 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(76,29,149,0.12)] focus-visible:ring-4"
                >
                  <div className="relative aspect-[16/9] overflow-hidden bg-[#F5F3FF]">
                    {deal.image_url ? (
                      <Image
                        src={deal.image_url}
                        alt={repairPotentialMojibake(deal.title)}
                        fill
                        unoptimized
                        sizes="(max-width: 1024px) 100vw, 50vw"
                        className="object-cover transition duration-300 group-hover:scale-[1.025]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <PackageOpen className="h-10 w-10 text-violet-700" />
                      </div>
                    )}
                    <span className="absolute left-3 top-3 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-sm">
                      {getRemainingLabel(deal.quantity_remaining)}
                    </span>
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-lg font-semibold tracking-[-0.04em] text-zinc-950">{repairPotentialMojibake(deal.title)}</h3>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">{repairPotentialMojibake(deal.description || deal.min_contents_note || "Günün uygun ürünlerinden hazırlanan sürpriz fırsat paketi.")}</p>
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <span className="text-sm font-semibold text-[#E11D48] line-through decoration-2 decoration-[#E11D48]/70">
                            <AmountText amount={deal.original_value_amount} currency={deal.currency} />
                          </span>
                          <span className="inline-flex items-center gap-2 rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700">
                            <Sparkles className="h-3.5 w-3.5" />
                            Tahmini değer
                          </span>
                        </div>
                      </div>
                      <div className="rounded-2xl bg-zinc-950 px-4 py-3 text-white">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">Ödenecek tutar</p>
                        <p className="mt-1 text-lg font-semibold">
                          <AmountText amount={deal.sale_price_amount} currency={deal.currency} />
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-zinc-100 bg-zinc-50/90 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Teslim aralığı</p>
                        <p className="mt-2 text-sm font-semibold text-zinc-950">
                          <Clock3 className="mr-1 inline h-3.5 w-3.5 text-violet-700" />
                          {formatDateTime(deal.pickup_window_start)}
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">{formatDateTime(deal.pickup_window_end)}</p>
                      </div>
                      <div className="rounded-2xl border border-violet-100 bg-violet-50 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">Kalan fırsat</p>
                        <p className="mt-2 text-sm font-semibold text-zinc-950">{getRemainingLabel(deal.quantity_remaining)}</p>
                      </div>
                      <div className="rounded-2xl border border-zinc-100 bg-zinc-50/90 px-4 py-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Gramaj</p>
                        <p className="mt-2 text-sm font-semibold text-zinc-950">{deal.grams ? `${deal.grams} gr` : "Gram bilgisi yok"}</p>
                      </div>
                    </div>

                    {deal.allergens_note ? (
                      <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                        <span className="font-semibold">Alerjen notu:</span> {repairPotentialMojibake(deal.allergens_note)}
                      </div>
                    ) : null}
                  </div>
                </div>

                <SurpriseDealCheckoutButton
                  deal={deal}
                  isAuthenticated={isAuthenticated}
                  returnHref={`${withSearchParams(`/halktasarruf/isletmeler/${businessId}`, { district })}#firsat-${deal.id}`}
                  disabled={deal.is_sold_out || deal.quantity_remaining <= 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
                  authenticatedLabel={
                    <>
                      <PackageOpen className="h-4 w-4" />
                      {deal.is_sold_out ? "Tükendi" : "Sepete ekle"}
                    </>
                  }
                  unauthenticatedLabel={
                    <>
                      <PackageOpen className="h-4 w-4" />
                      {deal.is_sold_out ? "Tükendi" : "Giriş yapıp sepete ekle"}
                    </>
                  }
                />
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Bu işletmede şu an aktif paket yok"
            description="Yeni sürpriz paket yayınlandığında burada otomatik olarak görünecek."
            action={
              <Link
                href={getHalkTasarrufPageHref(district, "#son-dakika-firsatlari")}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#5B21B6]"
              >
                Diğer fırsatlara dön
                <Sparkles className="h-4 w-4" />
              </Link>
            }
          />
        )}
      </section>

      {selectedDeal ? (
        <SurpriseDealQuickView
          businessHref={`${withSearchParams(`/halktasarruf/isletmeler/${businessId}`, { district })}#firsat-${selectedDeal.id}`}
          deal={selectedDeal}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelectedDeal(null)}
          returnHref={`${withSearchParams(`/halktasarruf/isletmeler/${businessId}`, { district })}#firsat-${selectedDeal.id}`}
          secondaryActionLabel="Pakete dön"
        />
      ) : null}
    </PageContainer>
  );
}





