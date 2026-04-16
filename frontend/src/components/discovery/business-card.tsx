import Link from "next/link";
import { ArrowRight, MapPin, Star, Store } from "lucide-react";

import { getBusinessIntroText, getBusinessListingTypeLabel } from "@/features/discovery/business-copy";
import { Card, CardContent } from "@/components/ui/card";
import { getCategoryDisplayName } from "@/features/discovery/category-copy";
import { withSearchParams } from "@/features/discovery/params";
import type { PublicBusinessSummary } from "@/features/discovery/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

export function BusinessCard({ business, district }: { business: PublicBusinessSummary; district?: string }) {
  const detailHref = withSearchParams(`/isletmeler/${business.id}`, { district });
  const menuHref = withSearchParams(`/isletmeler/${business.id}/menu`, { district });
  const districtLabel = repairPotentialMojibake(business.district_label);
  const listingTypeLabel = getBusinessListingTypeLabel(business.listing_type, business.listing_type_label);
  const categoryName = business.primary_marketplace_category
    ? getCategoryDisplayName(business.primary_marketplace_category.slug, business.primary_marketplace_category.name)
    : "";
  const businessSummary = getBusinessIntroText({
    businessName: business.business_name,
    shortDescription: business.short_description,
    introText: business.intro_text,
  });

  return (
    <Card className="overflow-hidden border-stone-200 bg-white transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[16/9] bg-zinc-100">
        {business.cover_image ? (
          <img src={business.cover_image} alt={business.business_name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">Kapak görseli yok</div>
        )}
        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          {business.badge_text ? (
            <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-zinc-700">{repairPotentialMojibake(business.badge_text)}</span>
          ) : (
            <span />
          )}
          {business.is_featured ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
              <Star className="h-3.5 w-3.5 fill-current" /> Öne çıkan
            </span>
          ) : null}
        </div>
      </div>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-xl bg-zinc-100">
            {business.logo_image ? (
              <img src={business.logo_image} alt={business.business_name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-zinc-400">Logo</div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-zinc-950">{business.business_name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {districtLabel}
              </span>
              <span className="inline-flex items-center gap-1">
                <Store className="h-3.5 w-3.5" /> {listingTypeLabel}
              </span>
            </div>
            {categoryName ? <p className="mt-2 text-xs text-zinc-500">{categoryName}</p> : null}
          </div>
        </div>
        <p className="min-h-10 text-sm leading-6 text-zinc-600">{businessSummary}</p>
        <div className="flex items-center justify-between gap-3">
          <Link href={menuHref} className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 transition hover:bg-zinc-200">
            Menüyü aç
          </Link>
          <Link href={detailHref} className="inline-flex items-center gap-1 text-sm font-medium text-zinc-900 hover:text-zinc-700">
            İşletmeyi incele <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
