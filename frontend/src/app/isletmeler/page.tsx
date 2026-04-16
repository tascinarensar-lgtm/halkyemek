"use client";

import Link from "next/link";
import { ArrowRight, LayoutGrid, MapPin, Star, Store } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { BusinessCard } from "@/components/discovery/business-card";
import { DistrictPicker } from "@/components/discovery/district-picker";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { usePublicBusinesses } from "@/features/discovery/hooks";
import { resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { useSession } from "@/hooks/use-session";
import { describeApiError } from "@/lib/api/presentation";

const districtLabels: Record<string, string> = {
  BEYLIKDUZU: "İstanbul/Beylikdüzü",
};

export default function BusinessesPage() {
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const sessionQuery = useSession();
  const businessesQuery = usePublicBusinesses(district);
  const businesses = businessesQuery.data?.results ?? [];
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const districtLabel = districtLabels[district] ?? district;
  const totalCount = businessesQuery.isSuccess ? businessesQuery.data.count : "-";
  const featuredCount = businesses.filter((business) => business.is_featured).length;
  const contractedCount = businesses.filter((business) => business.listing_type === "CONTRACTED").length;
  const volunteerCount = businesses.filter((business) => business.listing_type === "VOLUNTEER").length;

  return (
    <PageContainer className="space-y-10">
      <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_34%),linear-gradient(135deg,_rgba(248,250,252,0.98),_rgba(255,255,255,0.98))] shadow-sm">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-xs font-medium text-sky-900">
                <Store className="h-3.5 w-3.5" /> İşletme keşif alanı
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
                  HalkYemek özel işletmelere tek ekranda eriş.
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-zinc-600 sm:text-base">
                  Bölgenizdeki HalkYemek işletmelerini tek listede görün, öne çıkanları ayırt edin, menülerine göz atın
                  ve dilediğiniz işletmeye hızlıca geçin.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={withSearchParams("/kategoriler", { district })}
                  className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Kategorilerden başla
                  <ArrowRight className="h-4 w-4" />
                </Link>
                {!isAuthenticated ? (
                  <Link
                    href="/giris"
                    className="inline-flex rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Giriş yap
                  </Link>
                ) : null}
              </div>
            </div>

            <div className="shrink-0">
              <DistrictPicker />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-3xl border border-sky-100 bg-white/92 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-medium text-sky-900">
                <MapPin className="h-4 w-4" /> Aktif Bölge
              </div>
              <p className="mt-3 text-lg font-semibold text-zinc-950">{districtLabel}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">Liste şu anda bu bölgedeki işletmeler üzerinden hazırlanır.</p>
            </div>
            <div className="rounded-3xl border border-white/80 bg-white/92 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                <Store className="h-4 w-4" /> Toplam işletme
              </div>
              <p className="mt-3 text-lg font-semibold text-zinc-950">{totalCount}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">Bölgedeki tüm görünür işletmeler tek ekranda listelenir.</p>
            </div>
            <div className="rounded-3xl border border-white/80 bg-white/92 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                <Star className="h-4 w-4" /> Öne çıkan işletme
              </div>
              <p className="mt-3 text-lg font-semibold text-zinc-950">{businessesQuery.isSuccess ? featuredCount : "-"}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">Öne çıkanlar kartlar arasında daha hızlı fark edilir.</p>
            </div>
            <div className="rounded-3xl border border-white/80 bg-white/92 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                <LayoutGrid className="h-4 w-4" /> İşletme tipi dağılımı
              </div>
              <p className="mt-3 text-lg font-semibold text-zinc-950">
                {businessesQuery.isSuccess ? `${contractedCount} anlaşmalı · ${volunteerCount} gönüllü` : "-"}
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">İşletmeleri yapılarına göre daha kolay karşılaştırabilirsin.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {businessesQuery.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <LoadingSkeleton key={index} />
          ))}
        </div>
      ) : businessesQuery.isError ? (
        <ErrorState
          title="İşletme listesi alınamadı"
          description={describeApiError(businessesQuery.error, "İşletme listesi şu anda getirilemedi. Lütfen bağlantıyı tekrar kontrol edin.")}
        />
      ) : businesses.length ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {businesses.map((business) => (
              <BusinessCard key={business.id} business={business} district={district} />
            ))}
          </div>

          <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,1),_rgba(248,250,252,0.96))]">
            <CardContent className="flex flex-col gap-5 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-zinc-950">Karar vermeyi hızlandırmak istersen önce kategori seç.</h3>
                <p className="max-w-2xl text-sm leading-6 text-zinc-600">
                  Yemek türüne göre ilerlemek istersen kategoriler sayfasından başlayabilir, ardından ilgili işletmelere daha hızlı ulaşabilirsin.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link
                  href={withSearchParams("/kategoriler", { district })}
                  className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Kategorilere geç
                  <ArrowRight className="h-4 w-4" />
                </Link>
                {!isAuthenticated ? (
                  <Link
                    href="/giris"
                    className="inline-flex rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
                  >
                    Giriş yap
                  </Link>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyState
          title="İşletme bulunamadı"
          description="Bu bölgede şu anda listelenen işletme görünmüyor. Bölgeyi kontrol ederek yeniden deneyebilirsin."
        />
      )}
    </PageContainer>
  );
}
