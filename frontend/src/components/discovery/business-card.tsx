import Link from "next/link";
import { ArrowRight, MapPin, ShieldCheck, Star, Wallet } from "lucide-react";
import Image from "next/image";

import { getBusinessIntroText, getBusinessListingTypeLabel, isDemoBusinessCopy } from "@/features/discovery/business-copy";
import { getBusinessMenuQuotaDisplayText, getBusinessMenuQuotaDisplayTone } from "@/features/discovery/quota-copy";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/card";
import { getCategoryDisplayName } from "@/features/discovery/category-copy";
import { withSearchParams } from "@/features/discovery/params";
import type { PublicBusinessSummary } from "@/features/discovery/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

export function BusinessCard({ business, district }: { business: PublicBusinessSummary; district?: string }) {
  const menuHref = withSearchParams(`/isletmeler/${business.id}`, { district });
  const businessName = repairPotentialMojibake(business.business_name);
  const districtLabel = repairPotentialMojibake(business.district_label);
  const listingTypeLabel = getBusinessListingTypeLabel(business.listing_type, business.listing_type_label);
  const categoryName = business.primary_marketplace_category
    ? getCategoryDisplayName(business.primary_marketplace_category.slug, business.primary_marketplace_category.name)
    : "";
  const businessSummary = getBusinessIntroText({
    businessName,
    shortDescription: business.short_description,
    introText: business.intro_text,
  });
  const badgeText = isDemoBusinessCopy(business.badge_text) ? "" : repairPotentialMojibake(business.badge_text);
  const menuQuotaLabel = getBusinessMenuQuotaDisplayText(business);
  const menuQuotaTone = getBusinessMenuQuotaDisplayTone(business);
  const menuQuotaClass = menuQuotaTone === "sold_out" ? "bg-zinc-950/90 text-white" : "bg-white/92 text-zinc-700";

  return (
    <Card className="group overflow-hidden border-stone-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-stone-300 hover:shadow-md">
      <div className="relative aspect-[16/9] overflow-hidden bg-zinc-100">
        {business.cover_image ? (
          <Image
            src={business.cover_image}
            alt={businessName}
            fill
            unoptimized
            sizes="(max-width: 768px) 100vw, 50vw"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,_rgba(249,115,22,0.08),_rgba(20,184,166,0.08))] px-6 text-center text-sm text-zinc-500">
            Bu işletme için kapak görseli yakında eklenecek
          </div>
        )}

        <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(15,23,42,0.08),_rgba(15,23,42,0.12)_45%,_rgba(15,23,42,0.55)_100%)]" />

        <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-white/92 px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm">
              Halk fiyatı
            </span>
            {badgeText ? (
              <span className="rounded-full bg-white/92 px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm">
                {badgeText}
              </span>
            ) : null}
            {menuQuotaLabel ? (
              <span className={`rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${menuQuotaClass}`}>
                {menuQuotaLabel}
              </span>
            ) : null}
          </div>
          {business.is_featured ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700 shadow-sm">
              <Star className="h-3.5 w-3.5 fill-current" /> Öne çıkan
            </span>
          ) : null}
        </div>

        <div className="absolute inset-x-0 bottom-0 p-3">
          <div className="flex items-end gap-3">
            <div className="relative h-14 w-14 overflow-hidden rounded-2xl border border-white/30 bg-white/90 shadow-md backdrop-blur">
              {business.logo_image ? (
                <Image
                  src={business.logo_image}
                  alt={businessName}
                  fill
                  unoptimized
                  sizes="56px"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-zinc-500">Logo</div>
              )}
            </div>
            <div className="min-w-0 flex-1 text-white">
              <h3 className="truncate text-xl font-semibold">{businessName}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/85">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {districtLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {categoryName ? <Badge tone="secondary">{categoryName}</Badge> : null}
            <Badge tone={business.is_featured ? "success" : "neutral"}>{business.is_featured ? "Öne çıkan" : listingTypeLabel}</Badge>
          </div>
          <p className="line-clamp-2 min-h-10 text-sm leading-6 text-zinc-600">{businessSummary}</p>
          {menuQuotaLabel ? (
            <p className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${menuQuotaTone === "sold_out" ? "bg-zinc-950 text-white" : "bg-rose-50 text-[#f50555]"}`}>
              Menü kotası: {menuQuotaLabel}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl bg-zinc-50 px-3.5 py-3">
          <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-zinc-600">
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5" /> Cüzdanla ödeme
            </span>
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5" /> QR ile kullanım
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-zinc-950">QR ile işletmede tüketim</p>
        </div>

        <div className="border-t border-stone-200/80 pt-4">
          <Link
            href={menuHref}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            Menüyü aç
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
