import { MapPin, Sparkles, Store } from "lucide-react";

import Image from "next/image";
import { ButtonLink } from "@/components/ui/button-link";
import { getBusinessIntroText, getBusinessListingTypeLabel } from "@/features/discovery/business-copy";
import { getCategoryDisplayName } from "@/features/discovery/category-copy";
import { withSearchParams } from "@/features/discovery/params";
import type { MediaAssetSummary, PublicBusinessSummary } from "@/features/discovery/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

export function BusinessHero({
  business,
  media,
  showMenuCta = true,
  district,
}: {
  business: PublicBusinessSummary;
  media?: MediaAssetSummary[];
  showMenuCta?: boolean;
  district?: string;
}) {
  const businessName = repairPotentialMojibake(business.business_name);
  const cover = business.cover_image || media?.find((asset) => asset.asset_role === "COVER")?.url || "";
  const districtLabel = repairPotentialMojibake(business.district_label);
  const listingTypeLabel = getBusinessListingTypeLabel(business.listing_type, business.listing_type_label);
  const primaryCategory = business.primary_marketplace_category
    ? getCategoryDisplayName(business.primary_marketplace_category.slug, business.primary_marketplace_category.name)
    : "";
  const introText = getBusinessIntroText({
    businessName,
    shortDescription: business.short_description,
    introText: business.intro_text,
  });
  const badgeText = repairPotentialMojibake(business.badge_text);

  return (
    <section className="overflow-hidden rounded-[30px] border border-zinc-200 bg-white shadow-sm">
      <div className="relative aspect-[16/7] bg-zinc-100">
        {cover ? (
          <Image src={cover} alt={businessName} fill unoptimized sizes="100vw" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">Kapak görseli yok</div>
        )}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(15,23,42,0.12),_rgba(15,23,42,0.22)_40%,_rgba(15,23,42,0.75)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex items-end gap-4">
              <div className="relative h-20 w-20 overflow-hidden rounded-3xl border border-white/25 bg-white/90 shadow-lg backdrop-blur">
                {business.logo_image ? (
                  <Image
                    src={business.logo_image}
                    alt={businessName}
                    fill
                    unoptimized
                    sizes="80px"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-zinc-500">Logo</div>
                )}
              </div>
              <div className="space-y-3 text-white">
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                    <Sparkles className="h-3.5 w-3.5" /> HalkYemek işletmesi
                  </span>
                  {badgeText ? (
                    <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                      {badgeText}
                    </span>
                  ) : null}
                  {business.is_featured ? (
                    <span className="rounded-full border border-amber-200/50 bg-amber-300/20 px-3 py-1 text-xs font-medium text-amber-50 backdrop-blur">
                      Öne çıkan işletme
                    </span>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{businessName}</h1>
                  <p className="max-w-3xl text-sm leading-6 text-white/85 sm:text-base">{introText}</p>
                </div>
              </div>
            </div>
            {showMenuCta ? (
              <ButtonLink href={withSearchParams(`/isletmeler/${business.id}`, { district })} className="bg-white text-zinc-950 hover:bg-zinc-100">
                Menüye geç
              </ButtonLink>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700">
            <MapPin className="h-4 w-4" /> {districtLabel}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700">
            <Store className="h-4 w-4" /> {listingTypeLabel}
          </span>
          {primaryCategory ? (
            <span className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 ring-1 ring-sky-100">
              {primaryCategory}
            </span>
          ) : null}
        </div>
        <p className="max-w-xl text-sm leading-6 text-zinc-600">
          HalkYemek sisteminde bu işletmenin menülerini inceleyip, dilediğiniz menüyü seçip ödeme sonrası QR ile teslim alabilirsiniz.
        </p>
      </div>
    </section>
  );
}
