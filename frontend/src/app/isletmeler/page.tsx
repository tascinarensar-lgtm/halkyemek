"use client";

import Link from "next/link";
import { ArrowRight, LayoutGrid, MapPin, ShieldCheck, Store, Wallet } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { CustomerBottomSection } from "@/components/layout/customer-bottom-section";
import { BusinessCard } from "@/components/discovery/business-card";
import { DistrictPicker } from "@/components/discovery/district-picker";
import { Badge } from "@/components/ui/Badge";
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

  return (
    <PageContainer className="space-y-5 bg-white sm:space-y-6">
      <Card className="border-stone-200 bg-[linear-gradient(135deg,_rgba(245,5,85,0.07),_rgba(255,255,255,0.96))] shadow-sm">
        <CardContent className="space-y-4 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2.5">
              <div className="flex flex-wrap gap-2">
                <Badge tone="secondary">Anlaşmalı işletmeler</Badge>
                <Badge tone="primary">Halk fiyatı</Badge>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">Anlaşmalı işletmeleri keşfet</h1>
              <p className="max-w-3xl text-sm leading-6 text-zinc-600">
                Cüzdan bakiyesiyle güvenli ödeme yap, QR ile işletmede hızlı tüketim akışına geç.
              </p>
            </div>
            <Link
              href={withSearchParams("/kategoriler", { district })}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-2.5 text-sm font-medium text-white transition hover:-translate-y-0.5 hover:bg-zinc-800"
            >
              İşletmeleri keşfet
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="border-stone-200 bg-white">
            <CardContent className="space-y-4 p-4 sm:p-5">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-zinc-900">Keşif bölgesi</h2>
                <p className="text-xs leading-5 text-zinc-600">İşletmeler bu bölgeye göre listelenir.</p>
              </div>
              <DistrictPicker />
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-xs text-zinc-500">Toplam</p>
                  <p className="font-semibold text-zinc-950">{totalCount}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <p className="text-xs text-zinc-500">Anlaşmalı</p>
                  <p className="font-semibold text-zinc-950">{businessesQuery.isSuccess ? contractedCount : "-"}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200 bg-white">
            <CardContent className="space-y-3 p-4 sm:p-5">
              <h3 className="text-sm font-semibold text-zinc-900">Nasıl çalışır?</h3>
              <ul className="space-y-2 text-xs leading-5 text-zinc-600">
                <li className="flex items-start gap-2"><Store className="mt-0.5 h-3.5 w-3.5 shrink-0" /> İşletmeni seç, menüyü aç.</li>
                <li className="flex items-start gap-2"><Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Cüzdanla ödemeni tamamla.</li>
                <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> QR kodunu kasada okut.</li>
              </ul>
              {!isAuthenticated ? (
                <Link
                  href="/giris"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:bg-zinc-50"
                >
                  Giriş yap
                </Link>
              ) : null}
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-4">
          <Card className="border-stone-200 bg-white">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">İşletme listesi</h2>
                <p className="text-sm text-zinc-600">{districtLabel} bölgesindeki görünür işletmeler</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>{businessesQuery.isSuccess ? featuredCount : "-"} öne çıkan</span>
              </div>
            </CardContent>
          </Card>

          {businessesQuery.isPending ? (
            <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <LoadingSkeleton key={index} />
              ))}
            </div>
          ) : businessesQuery.isError ? (
            <ErrorState
              title="İşletme listesi alınamadı"
              description={describeApiError(businessesQuery.error, "İşletme listesi şu anda getirilemedi. Bölge veya bağlantı ayarını tekrar kontrol edin.")}
            />
          ) : businesses.length ? (
            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {businesses.map((business) => (
                <BusinessCard key={business.id} business={business} district={district} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="Bu bölgede işletme görünmüyor"
              description="Şu anda listelenen bir işletme bulunamadı. Bölge seçimini kontrol ederek kısa süre sonra yeniden deneyebilirsin."
            />
          )}

          <Card className="border-stone-200 bg-zinc-50">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm text-zinc-700">
                <MapPin className="h-4 w-4" /> {districtLabel}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="primary">QR ile tüketim</Badge>
                <Badge tone="secondary">Cüzdan bakiyesi</Badge>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>

      <CustomerBottomSection />
    </PageContainer>
  );
}
