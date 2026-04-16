"use client";

import Link from "next/link";
import { ArrowRight, LayoutGrid, MapPin, Store, UtensilsCrossed } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { BusinessCard } from "@/components/discovery/business-card";
import { CategoryCard } from "@/components/discovery/category-card";
import { DiscoverySection } from "@/components/discovery/discovery-section";
import { DistrictPicker } from "@/components/discovery/district-picker";
import { DiscoverySummaryCards } from "@/components/discovery/summary-cards";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { useDiscoveryHome } from "@/features/discovery/hooks";
import { resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { useSession } from "@/hooks/use-session";
import { describeApiError } from "@/lib/api/presentation";
import { repairPotentialMojibake } from "@/lib/utils/text";

export default function HomePage() {
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const sessionQuery = useSession();
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const homeQuery = useDiscoveryHome(district, isAuthenticated, !sessionQuery.isPending);
  const homeData = homeQuery.data;
  const activeDistrictLabel = repairPotentialMojibake(homeData?.district.label) || "Beylikdüzü";
  const activeDistrictFullLabel = activeDistrictLabel.includes("İstanbul") ? activeDistrictLabel : `İstanbul ${activeDistrictLabel}`;
  const totalBusinessCount = (homeData?.featured_businesses.length ?? 0) + (homeData?.other_businesses.length ?? 0);
  const featuredMenuBusinessId = homeData?.featured_businesses[0]?.id ?? homeData?.other_businesses[0]?.id;

  const heroStats = [
    { label: "Kategori sayısı", value: homeData?.categories.length ?? "-" },
    { label: "İşletme sayısı", value: homeData ? totalBusinessCount : "-" },
  ];

  const orderSteps = isAuthenticated
    ? [
        "Yemek kategorini seç",
        "İşletmeni seç",
        "Özel menünü seç",
        "Sepete ekle",
        "Ödemeni tamamla",
        "QR kodunu oluşturup kasada okut",
        "Yemeğini teslim al",
      ]
    : [
        "Siteye giriş yap",
        "Özel menünü seç",
        "Sepete ekleyip ödemeni tamamla",
        "QR kodunu kasada okut",
        "Yemeğini teslim al",
      ];

  const signedInQuickLinks = [
    {
      title: "Kategoriler",
      description: "Yemek türlerine göre ilerle, sana uygun seçeneğe hızlıca ulaş.",
      href: withSearchParams("/kategoriler", { district }),
      label: "Kategorilere git",
      icon: LayoutGrid,
    },
    {
      title: "İşletmeler",
      description: "Anlaşmalı işletmeleri karşılaştır, dilediğin noktayı doğrudan seç.",
      href: withSearchParams("/isletmeler", { district }),
      label: "İşletmeleri incele",
      icon: Store,
    },
    {
      title: "Özel menüler",
      description: "Aktif menülere geç, sepetini oluştur ve ödeme sonrası QR ile teslim al.",
      href: featuredMenuBusinessId ? withSearchParams(`/isletmeler/${featuredMenuBusinessId}/menu`, { district }) : withSearchParams("/isletmeler", { district }),
      label: "Menülere geç",
      icon: UtensilsCrossed,
    },
  ];

  return (
    <PageContainer className="space-y-12">
      <SectionHeader
        title="HalkYemek'e hoş geldin"
        description="Anlaşmalı işletmeler, özel menüler ve avantajlı fırsatlar ile uygun fiyatlı yemeğe daha kolay ulaşman için buradayız."
        actions={<DistrictPicker />}
      />

      {isAuthenticated ? (
        sessionQuery.isPending || homeQuery.isPending ? (
          <div className="grid gap-4 md:grid-cols-3">
            <LoadingSkeleton />
            <LoadingSkeleton />
            <LoadingSkeleton />
          </div>
        ) : homeData ? (
          <DiscoverySummaryCards
            wallet={homeData.wallet_summary}
            cart={homeData.active_cart_summary}
            notification={homeData.notification_readiness}
          />
        ) : null
      ) : null}

      {isAuthenticated ? (
        <Card className="border-stone-200 bg-white">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Hızlı erişim</h2>
              <p className="text-sm leading-6 text-zinc-600">
                Giriş yaptığın için kategorilere, işletmelere ve özel menülere buradan doğrudan geçebilirsin.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {signedInQuickLinks.map((item) => {
                const Icon = item.icon;

                return (
                  <Link
                    key={item.title}
                    href={item.href}
                    className="group rounded-2xl border border-zinc-200 bg-zinc-50 p-4 transition hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white"
                  >
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-zinc-950">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-600">{item.description}</p>
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-zinc-900">
                      {item.label}
                      <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-stone-200 bg-white">
          <CardContent className="space-y-5 p-5 sm:p-6">
            <div className="space-y-2">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Nasıl kullanılır?</h2>
              <p className="text-sm leading-6 text-zinc-600">
                HalkYemek'te sipariş süreci kısa ve nettir. Aşağıdaki adımlarla sistemin nasıl işlediğini hızlıca görebilirsin.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {orderSteps.map((step, index) => (
                <div key={`${index}-${step}`} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Adım {index + 1}</div>
                  <p className="mt-3 text-sm font-medium leading-6 text-zinc-900">{step}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.14),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.94))]">
        <CardContent className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
              <MapPin className="h-3.5 w-3.5" /> HalkYemek ile uygun fiyatlı özel menüler
            </span>
            <div className="space-y-3">
              <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
                HalkYemek, daha uygun fiyatlı yemek için kuruldu.
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-zinc-600 sm:text-base">
                HalkYemek sistemi, halkımızın zorlaşan hayat şartlarında bir nebze olsun rahatlamasını hedefler.
                Vatandaşımızın uygun fiyatla yemek ihtiyacını karşılayabilmesi için özel menüler ve avantajlı fırsatlar sunar.
                Amaç; vatandaşın yüksek fiyatlar karşısında ezilmeden, gereksiz maliyetler olmadan daha az ödeyip doyabildiği bir sistem kurmaktır.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href={withSearchParams("/kategoriler", { district })}
                className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
              >
                Kategorileri keşfet
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href={withSearchParams("/isletmeler", { district })}
                className="inline-flex rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
              >
                İşletmeleri incele
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
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">Şu an sistemde</h3>
                <p className="mt-1 text-sm text-zinc-600">
                  Şimdilik İstanbul Beylikdüzü bölgesindeki aktif kategori ve işletme sayısını burada görebilirsin.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {heroStats.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/80 bg-white/80 p-4 backdrop-blur">
                    <div className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">{item.label}</div>
                    <div className="mt-2 text-2xl font-semibold text-zinc-950">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="grid gap-4">
            <div className="rounded-3xl border border-zinc-200 bg-white/90 p-5 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                <MapPin className="h-4 w-4" /> Aktif bölgeler
              </div>
              <p className="mt-3 text-2xl font-semibold text-zinc-950">{activeDistrictFullLabel}</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Şimdilik sistem yalnızca İstanbul Beylikdüzü bölgesinde aktif olarak hizmet veriyor.
              </p>
            </div>
            <div className="rounded-3xl border border-zinc-200 bg-zinc-950 p-5 text-white shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Store className="h-4 w-4" /> Sipariş adımları
              </div>
              <div className="mt-4 space-y-4 text-sm text-zinc-200">
                {orderSteps.map((step, index) => (
                  <div key={`hero-step-${index}`} className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold">
                      {index + 1}
                    </span>
                    <p>{step}.</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {sessionQuery.isPending || homeQuery.isPending ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <LoadingSkeleton />
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      ) : homeQuery.isError ? (
        <ErrorState
          title="Ana sayfa verisi yüklenemedi"
          description={describeApiError(homeQuery.error, "Keşif akışı şu anda getirilemedi. Bölge veya bağlantı ayarını tekrar kontrol edin.")}
        />
      ) : homeData ? (
        <>
          {!isAuthenticated ? (
            <Card>
              <CardContent className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                <div className="space-y-3">
                  <h2 className="text-lg font-semibold">Giriş yaptıktan sonra seni neler bekliyor?</h2>
                  <div className="space-y-3 text-sm text-zinc-600">
                    <div className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900">
                        1
                      </span>
                      <p>Anlaşmalı işletmelerde özel ve avantajlı menülere eriş.</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900">
                        2
                      </span>
                      <p>Aynı yemeği daha uygun fiyata sipariş etme imkanını gör.</p>
                    </div>
                    <div className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-900">
                        3
                      </span>
                      <p>QR ile hızlı, kolay ve beklemeden teslim al.</p>
                    </div>
                  </div>
                </div>
                <Link href="/giris" className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                  Giriş yap ve avantajlardan yararlan
                </Link>
              </CardContent>
            </Card>
          ) : null}

          <DiscoverySection
            title="Kategoriler"
            description="Bölgenizdeki yemek seçeneklerini kategori bazında tarayın ve doğrudan ilgili işletmelere geçin."
            actionHref={withSearchParams("/kategoriler", { district })}
            actionLabel="Tüm kategoriler"
          >
            {homeData.categories.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {homeData.categories.map((category) => (
                  <CategoryCard key={category.id} category={category} district={district} />
                ))}
              </div>
            ) : (
              <EmptyState title="Kategori bulunamadı" description="Seçili bölge için gösterilecek kategori bulunamadı." />
            )}
          </DiscoverySection>

          <DiscoverySection
            title="Öne çıkan işletmeler"
            description="Öne çıkan işletmeleri hızlıca karşılaştırın, menülerini görüntüleyin ve detaylarına geçin."
            actionHref={withSearchParams("/isletmeler", { district })}
            actionLabel="Tüm işletmeler"
          >
            {homeData.featured_businesses.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {homeData.featured_businesses.map((business) => (
                  <BusinessCard key={business.id} business={business} district={district} />
                ))}
              </div>
            ) : (
              <EmptyState title="Öne çıkan işletme yok" description="Bu bölge için öne çıkarılmış işletme görünmüyor." />
            )}
          </DiscoverySection>

          <DiscoverySection
            title="Diğer işletmeler"
            description="Bölgedeki diğer işletmeleri ayrı bir blokta inceleyebilir, yeni seçenekler keşfedebilirsiniz."
            actionHref={withSearchParams("/isletmeler", { district })}
            actionLabel="İşletmeleri incele"
          >
            {homeData.other_businesses.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {homeData.other_businesses.map((business) => (
                  <BusinessCard key={business.id} business={business} district={district} />
                ))}
              </div>
            ) : (
              <EmptyState title="Diğer işletme yok" description="Bu bölgede ayrı listelenecek ek işletme bulunamadı." />
            )}
          </DiscoverySection>
        </>
      ) : null}
    </PageContainer>
  );
}
