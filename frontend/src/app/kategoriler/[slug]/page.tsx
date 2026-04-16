"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpDown, LayoutGrid, MapPin, SlidersHorizontal, Store } from "lucide-react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";

import { BusinessCard } from "@/components/discovery/business-card";
import { DistrictPicker } from "@/components/discovery/district-picker";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { getCategoryDisplayDescription, getCategoryDisplayName } from "@/features/discovery/category-copy";
import { useCategoryBusinesses } from "@/features/discovery/hooks";
import { buildUpdatedSearchParams, parseBooleanParam, resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { describeApiError } from "@/lib/api/presentation";

const districtLabels: Record<string, string> = {
  BEYLIKDUZU: "İstanbul/Beylikdüzü",
};

function getListingLabel(listingType: string) {
  if (listingType === "CONTRACTED") {
    return "Anlaşmalı";
  }

  if (listingType === "VOLUNTEER") {
    return "Gönüllü";
  }

  return "Tümü";
}

export default function CategoryDetailPage() {
  const params = useParams<{ slug: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const slug = typeof params.slug === "string" ? params.slug.trim() : "";
  const rawListingType = String(searchParams.get("listing_type") || "").trim().toUpperCase();
  const listingType = ["CONTRACTED", "VOLUNTEER"].includes(rawListingType) ? rawListingType : "";
  const featuredFirst = parseBooleanParam(searchParams.get("featured_first"), true);
  const hasValidSlug = slug.length > 0;
  const categoryTitle = hasValidSlug ? getCategoryDisplayName(slug) : "Kategori";
  const categoryDescription = hasValidSlug ? getCategoryDisplayDescription(slug) : "";
  const districtLabel = districtLabels[district] ?? district;
  const selectedListingLabel = getListingLabel(listingType);

  const businessesQuery = useCategoryBusinesses({
    slug,
    district,
    listingType: listingType || undefined,
    featuredFirst,
  });

  function updateParams(updates: Record<string, string | boolean | null>) {
    const next = buildUpdatedSearchParams(searchParams, updates);
    const serialized = next.toString();
    router.push(serialized ? `${pathname}?${serialized}` : pathname);
  }

  return (
    <PageContainer className="space-y-10">
      <div className="rounded-[28px] border border-zinc-200 bg-[linear-gradient(135deg,_rgba(248,250,252,0.96),_rgba(255,255,255,1))] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
              <Link href={withSearchParams("/kategoriler", { district })} className="hover:text-zinc-800">
                Kategoriler
              </Link>
              <span className="text-zinc-300">/</span>
              <span className="text-zinc-700">{categoryTitle}</span>
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">{categoryTitle}</h1>
              <p className="max-w-3xl text-sm leading-6 text-zinc-600 sm:text-base">
                Bu kategorideki işletmeleri filtreleyebilir, menülerini inceleyebilir ve sana uygun seçeneğe hızlıca geçebilirsin.
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <DistrictPicker />
          </div>
        </div>
      </div>

      {!hasValidSlug ? (
        <ErrorState
          title="Geçersiz kategori bağlantısı"
          description="Kategori bağlantısı okunamadı. Güvenli şekilde kategori listesine geri dönebilirsin."
        />
      ) : null}

      {hasValidSlug ? (
        <Card className="overflow-hidden border-sky-100 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.22),_transparent_34%),radial-gradient(circle_at_bottom_left,_rgba(14,165,233,0.12),_transparent_30%),linear-gradient(135deg,_rgba(239,246,255,0.98),_rgba(248,250,252,0.98)_48%,_rgba(255,255,255,0.98))] shadow-sm">
          <CardContent className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.08fr_0.92fr] lg:items-start">
            <div className="space-y-5">
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-300 bg-sky-50/90 px-3 py-1 text-xs font-medium text-sky-950 shadow-sm">
                <LayoutGrid className="h-3.5 w-3.5" /> Kategori detay görünümü
              </span>

              <div className="space-y-3">
                <h2 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">{categoryTitle}</h2>
                <p className="max-w-2xl text-sm leading-6 text-zinc-600 sm:text-base">
                  {categoryDescription} Filtreleri değiştirerek işletme tipini daraltabilir, öne çıkan işletmeleri üstte
                  tutabilir ve kategori içindeki seçenekleri daha rahat karşılaştırabilirsin.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-white/90 px-3 py-1.5 text-sm font-medium text-sky-950 ring-1 ring-sky-100 shadow-sm">
                  İşletme Filtresi: {selectedListingLabel}
                </span>
                <span className="rounded-full bg-white/90 px-3 py-1.5 text-sm font-medium text-sky-950 ring-1 ring-sky-100 shadow-sm">
                  Sıralama: {featuredFirst ? "Öne çıkanlar üstte" : "Doğal sıra"}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-3xl border border-sky-200 bg-[radial-gradient(circle_at_top_left,_rgba(186,230,253,0.55),_transparent_44%),linear-gradient(160deg,_rgba(240,249,255,0.98),_rgba(255,255,255,0.96))] p-5 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-sky-950">
                  <MapPin className="h-4 w-4" /> Aktif Bölge
                </div>
                <p className="mt-3 text-xl font-semibold tracking-tight text-sky-950">{districtLabel}</p>
                <p className="mt-2 text-sm leading-6 text-sky-900/80">
                  Bu kategoride gördüğün sonuçlar seçili bölgeye göre listelenir.
                </p>
              </div>

              <div className="rounded-3xl border border-sky-100 bg-white/92 p-5 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-sky-900">
                  <Store className="h-4 w-4" /> İşletme Tipi
                </div>
                <p className="mt-3 text-lg font-semibold text-zinc-950">{selectedListingLabel}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Dilersen yalnızca anlaşmalı ya da gönüllü işletmeleri görüntüleyebilirsin.
                </p>
              </div>

              <div className="rounded-3xl border border-sky-100 bg-white/92 p-5 shadow-sm backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-sky-900">
                  <ArrowUpDown className="h-4 w-4" /> Sıralama
                </div>
                <p className="mt-3 text-lg font-semibold text-zinc-950">{featuredFirst ? "Öne çıkanlar üstte" : "Doğal sıra"}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-600">
                  Öne çıkan işletmeleri istersen en üstte sabit tutabilirsin.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {hasValidSlug ? (
        <Card className="border-stone-200 bg-white shadow-sm">
          <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateParams({ listing_type: null })}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  listingType === "" ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                Tümü
              </button>
              <button
                type="button"
                onClick={() => updateParams({ listing_type: "CONTRACTED" })}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  listingType === "CONTRACTED" ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                Anlaşmalı
              </button>
              <button
                type="button"
                onClick={() => updateParams({ listing_type: "VOLUNTEER" })}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  listingType === "VOLUNTEER" ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                Gönüllü
              </button>
            </div>

            <label className="inline-flex items-center gap-2 rounded-full bg-zinc-50 px-3 py-2 text-sm text-zinc-700 ring-1 ring-zinc-200">
              <SlidersHorizontal className="h-4 w-4" />
              <input
                type="checkbox"
                checked={featuredFirst}
                onChange={(event) => updateParams({ featured_first: String(event.target.checked) })}
              />
              Öne çıkan işletmeleri üstte göster
            </label>
          </CardContent>
        </Card>
      ) : null}

      {hasValidSlug && businessesQuery.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <LoadingSkeleton key={index} />
          ))}
        </div>
      ) : hasValidSlug && businessesQuery.isError ? (
        <ErrorState
          title="Kategori işletmeleri yüklenemedi"
          description={describeApiError(businessesQuery.error, "Bu kategoriye ait işletmeler şu anda getirilemedi.")}
        />
      ) : hasValidSlug && businessesQuery.data?.results.length ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-600">
              Toplam <span className="font-semibold text-zinc-950">{businessesQuery.data.count}</span> işletme bulundu.
            </p>
            <p className="text-sm text-zinc-500">Kartlardan menüye veya işletme detayına geçebilirsin.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {businessesQuery.data.results.map((business) => (
              <BusinessCard key={business.id} business={business} district={district} />
            ))}
          </div>
        </>
      ) : hasValidSlug ? (
        <EmptyState
          title="Bu kategoride işletme görünmüyor"
          description="Filtreleri temizleyebilir ya da farklı bir kategoriye geçerek diğer işletmeleri inceleyebilirsin."
        />
      ) : null}

      <Link
        href={withSearchParams("/kategoriler", { district })}
        className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Kategorilere dön
      </Link>
    </PageContainer>
  );
}
