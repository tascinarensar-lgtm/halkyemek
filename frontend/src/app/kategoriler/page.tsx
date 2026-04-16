"use client";

import Link from "next/link";
import { ArrowRight, LayoutGrid, MapPin, Store } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { CategoryCard } from "@/components/discovery/category-card";
import { DistrictPicker } from "@/components/discovery/district-picker";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { useDiscoveryCategories, usePublicBusinesses } from "@/features/discovery/hooks";
import { resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { useSession } from "@/hooks/use-session";
import { describeApiError } from "@/lib/api/presentation";

const districtLabels: Record<string, { inline: string; display: string }> = {
  BEYLIKDUZU: {
    inline: "İstanbul/Beylikdüzü",
    display: "İSTANBUL/BEYLİKDÜZÜ",
  },
};

export default function CategoriesPage() {
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const sessionQuery = useSession();
  const categoriesQuery = useDiscoveryCategories(district);
  const businessesQuery = usePublicBusinesses(district);
  const categories = categoriesQuery.data?.results ?? [];
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const districtLabel = districtLabels[district] ?? {
    inline: district,
    display: district.toUpperCase(),
  };
  const categoryCount = categoriesQuery.isSuccess ? categoriesQuery.data.count : "-";
  const businessCount = businessesQuery.isSuccess ? businessesQuery.data.count : "-";

  return (
    <PageContainer className="space-y-10">
      <SectionHeader
        title="Kategoriler"
        description="Bölgenizdeki HalkYemek özel yemek seçeneklerini kategoriler eşliğinde tarayın ve dilediğiniz işletmelere hızla geçin."
        actions={<DistrictPicker />}
      />

      <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_32%),linear-gradient(135deg,_rgba(255,251,235,0.96),_rgba(255,255,255,0.98))] shadow-sm">
        <CardContent className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-white/90 px-3 py-1 text-xs font-medium text-amber-900">
              <LayoutGrid className="h-3.5 w-3.5" /> Kategori keşif alanı
            </span>
            <div className="space-y-3">
              <h2 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
                İhtiyacına uygun yemek kategorisini seç.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-zinc-600 sm:text-base">
                Her kategori, seni doğrudan ilgili işletmelere götürür. Böylece önce ne yemek istediğine karar verip
                sonra menü ve işletme detaylarına rahatça geçebilirsin.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={withSearchParams("/", { district })}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Ana sayfaya dön
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

          <div className="grid gap-3">
            <div className="rounded-3xl border border-amber-200/70 bg-[linear-gradient(145deg,_rgba(255,248,220,0.98),_rgba(255,255,255,0.94))] p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <MapPin className="h-4 w-4" /> Aktif Bölge: {districtLabel.inline}
              </div>
              <p className="mt-3 text-xl font-semibold tracking-[0.12em] text-zinc-950">{districtLabel.display}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                HalkYemek şu anda bu bölgede aktif olarak hizmet veriyor.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/80 bg-white/90 p-4">
                <div className="text-sm font-medium text-zinc-700">Görünen kategori sayısı</div>
                <p className="mt-2 text-lg font-semibold text-zinc-950">{categoryCount}</p>
                <p className="mt-1 text-sm text-zinc-600">Liste, bölge seçimine göre otomatik yenilenir.</p>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/90 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                  <Store className="h-4 w-4" /> İşletme sayısı
                </div>
                <p className="mt-2 text-lg font-semibold text-zinc-950">{businessCount}</p>
                <p className="mt-1 text-sm text-zinc-600">Seçili bölgedeki aktif işletmeler burada özetlenir.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {categoriesQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <LoadingSkeleton key={index} />
          ))}
        </div>
      ) : categoriesQuery.isError ? (
        <ErrorState
          title="Kategori listesi alınamadı"
          description={describeApiError(categoriesQuery.error, "Kategori verisi şu anda getirilemedi. Lütfen bağlantıyı tekrar kontrol edin.")}
        />
      ) : categories.length ? (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-600">
              Toplam <span className="font-semibold text-zinc-950">{categoriesQuery.data.count}</span> kategori bulundu.
            </p>
            <p className="text-sm text-zinc-500">Bir kategori seçerek ilgili işletmeleri görebilirsin.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {categories.map((category) => (
              <CategoryCard key={category.id} category={category} district={district} />
            ))}
          </div>
          <Card className="border-stone-200 bg-zinc-50/80">
            <CardContent className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-zinc-950">Aradığın kategori farklıysa sorun değil.</h3>
                <p className="text-sm leading-6 text-zinc-600">
                  Kategorilerden birini seçerek işletmelere geçebilir ya da tüm işletmeleri tek ekranda ayrıca inceleyebilirsin.
                </p>
              </div>
              <Link
                href={withSearchParams("/isletmeler", { district })}
                className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-100"
              >
                İşletmeleri incele
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </>
      ) : (
        <EmptyState title="Kategori bulunamadı" description="Seçtiğiniz bölge için gösterilecek aktif kategori bulunamadı." />
      )}
    </PageContainer>
  );
}
