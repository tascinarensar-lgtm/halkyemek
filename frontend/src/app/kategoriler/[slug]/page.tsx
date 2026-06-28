"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Heart, Info, MapPin, RefreshCw, ShieldCheck, ShoppingCart, Sparkles, Star, UtensilsCrossed, Wallet } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { getBusinessListingTypeLabel } from "@/features/discovery/business-copy";
import { getCategoryDisplayDescription, getCategoryDisplayName } from "@/features/discovery/category-copy";
import { getCategoryBusinesses, getDiscoveryHome, getPublicBusinessMenu } from "@/features/discovery/api";
import { resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { getBusinessMenuQuotaDisplayText, getBusinessMenuQuotaDisplayTone } from "@/features/discovery/quota-copy";
import { discoveryQueryKeys } from "@/features/discovery/query-keys";
import type { MenuItemSummary, PublicBusinessSummary } from "@/features/discovery/types";
import { useSession } from "@/hooks/use-session";
import { describeApiError } from "@/lib/api/presentation";
import { getIstanbulGreeting } from "@/lib/utils/greeting";
import { repairPotentialMojibake } from "@/lib/utils/text";

type CategoryVisual = {
  title: string;
  description: string;
  image: string;
  accent: string;
};

type CatalogTab = {
  slug: string;
  label: string;
  href: string;
};

type MenuPreview = {
  item: MenuItemSummary;
  business: PublicBusinessSummary;
  categoryName: string;
};

const districtLabels: Record<string, string> = {
  BEYLIKDUZU: "İstanbul/Beylikdüzü",
};

const catalogTabs: CatalogTab[] = [
  { slug: "burger", label: "Burger", href: "/kategoriler/burger" },
  { slug: "pizza", label: "Pizza", href: "/kategoriler/pizza" },
  { slug: "doner", label: "Döner", href: "/kategoriler/doner" },
  { slug: "kebap", label: "Kebap", href: "/kategoriler/kebap" },
];

const valueBullets = [
  "Belirli ürünlerde özel kampanyalar",
  "Sınırlı stok fırsatları",
  "Daha düşük platform maliyetleri",
  "Daha ulaşılabilir yemek seçenekleri",
];

const footerLinks = [
  "Yardım Merkezi",
  "Kullanım Koşulları",
  "S.S.S. ve İşlem Rehberi",
  "Çerez Politikası",
  "İletişim",
  "İş Ortağımız Olun",
  "Kurumsal Site",
  "Aydınlatma Metni",
  "Kişisel Verilerin Korunması ve İşlenmesi ve Gizlilik Politikası",
  "Bilgi Toplumu Hizmetleri",
];

const categoryVisuals: Record<string, CategoryVisual> = {
  burger: {
    title: "Burger",
    description: "Burger menülerini tek sayfada gör, sana uygun seçeneği keşfet.",
    image: "/cuisines/lysj-listing.webp",
    accent: "Burger menüleri",
  },
  pizza: {
    title: "Pizza",
    description: "Pizza menülerini tek katalogda incele, uygun fiyatlı seçenekleri yakala.",
    image: "/cuisines/lu8a-hero.webp",
    accent: "Pizza menüleri",
  },
  doner: {
    title: "Döner",
    description: "Döner menülerini birlikte gör, QR ile hızlı teslim al.",
    image: "/cuisines/i.webp",
    accent: "Döner menüleri",
  },
  kebap: {
    title: "Kebap",
    description: "Kebap menülerini keşfet, bütçene uygun yemeğini seç.",
    image: "/cuisines/1738662779653_1000x750.webp",
    accent: "Kebap menüleri",
  },
};

function normalizeCatalogSlug(slug: string) {
  return slug;
}

function resolveApiCategorySlugs(slug: string) {
  const normalized = normalizeCatalogSlug(slug);
  return ["burger", "pizza", "doner", "kebap"].includes(normalized) ? [normalized] : [];
}

function formatMenuPrice(priceAmount: number) {
  const wholeLira = Math.round(priceAmount / 100);
  return `${wholeLira.toLocaleString("tr-TR")} TL`;
}

function getBusinessCategoryName(business: PublicBusinessSummary) {
  if (!business.primary_marketplace_category) return "Kategori yok";
  return getCategoryDisplayName(business.primary_marketplace_category.slug, business.primary_marketplace_category.name);
}

function menuCategoryMatchesCatalog(item: MenuItemSummary, categorySlug: string | undefined, displaySlug: string) {
  const marketplaceSlugs = item.marketplace_categories?.map((category) => normalizeCatalogSlug(category.slug)) ?? [];
  if (marketplaceSlugs.length > 0) {
    return marketplaceSlugs.includes(displaySlug);
  }

  return normalizeCatalogSlug(categorySlug || "") === displaySlug;
}

function getMenuSectionTitle(categoryTitle: string) {
  return `Tüm ${categoryTitle.toLocaleLowerCase("tr-TR")} menüleri`;
}

function getResultLabel(count: number, loading: boolean) {
  if (loading) return "Sonuçlar yükleniyor";
  return `${count.toLocaleString("tr-TR")} Sonuç Bulundu`;
}

export default function CategoryDetailPage() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const sessionQuery = useSession();
  const district = resolveDistrict(searchParams.get("district"));
  const slug = typeof params.slug === "string" ? params.slug.trim().toLowerCase() : "";
  const displaySlug = normalizeCatalogSlug(slug);
  const apiCategorySlugs = useMemo(() => resolveApiCategorySlugs(slug), [slug]);
  const hasValidSlug = apiCategorySlugs.length > 0;
  const visual = categoryVisuals[displaySlug];
  const categoryTitle = visual?.title || getCategoryDisplayName(slug);
  const categoryDescription = visual?.description || getCategoryDisplayDescription(slug);
  const districtLabel = districtLabels[district] ?? district;
  const displayName =
    repairPotentialMojibake(sessionQuery.data?.user?.username || sessionQuery.data?.user?.google_email?.split("@")[0] || "") ||
    "HalkYemek";
  const [greeting, setGreeting] = useState(() => getIstanbulGreeting());
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const sessionUserId = sessionQuery.data?.user?.id ?? null;

  useEffect(() => {
    const updateGreeting = () => setGreeting(getIstanbulGreeting());

    updateGreeting();
    const intervalId = window.setInterval(updateGreeting, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const homeQuery = useQuery({
    queryKey: discoveryQueryKeys.home(
      district,
      isAuthenticated ? "authenticated" : "public",
      isAuthenticated ? `user:${sessionUserId ?? "pending"}` : "anonymous",
    ),
    queryFn: () => getDiscoveryHome(district, isAuthenticated),
    enabled: !sessionQuery.isPending && (!isAuthenticated || Boolean(sessionUserId)),
  });

  const businessQueries = useQueries({
    queries: apiCategorySlugs.map((apiSlug) => {
      const keyParams = {
        slug: apiSlug,
        district,
        listingType: "",
        featuredFirst: "true",
        page: "1",
        pageSize: "60",
      };

      return {
        queryKey: discoveryQueryKeys.categoryBusinesses(keyParams),
        queryFn: () =>
          getCategoryBusinesses({
            slug: apiSlug,
            district,
            featuredFirst: true,
            page: 1,
            pageSize: 60,
          }),
        enabled: hasValidSlug,
      };
    }),
  });

  const businesses = useMemo(() => {
    const merged = businessQueries.flatMap((query) => query.data?.results ?? []);
    return Array.from(new Map(merged.map((business) => [business.id, business])).values());
  }, [businessQueries]);

  const menuQueries = useQueries({
    queries: businesses.map((business) => ({
      queryKey: discoveryQueryKeys.businessMenu(business.id),
      queryFn: () => getPublicBusinessMenu(business.id),
      enabled: hasValidSlug,
    })),
  });

  const menuItems = useMemo<MenuPreview[]>(() => {
    return menuQueries.flatMap((query, index) => {
      const business = businesses[index];
      if (!business || !query.data) return [];

      return query.data.categories.flatMap((category) =>
        category.menu_items
          .filter((item) => item.is_available && menuCategoryMatchesCatalog(item, category.slug, displaySlug))
          .map((item) => ({
            item,
            business,
            categoryName: repairPotentialMojibake(category.name),
          })),
      );
    });
  }, [businesses, displaySlug, menuQueries]);

  const businessesPending = businessQueries.some((query) => query.isPending);
  const businessesError = businessQueries.find((query) => query.isError)?.error;
  const menusPending = menuQueries.some((query) => query.isPending);
  const resultLabel = getResultLabel(menuItems.length, businessesPending || menusPending);
  const walletBalanceText = homeQuery.data?.wallet_summary ? formatMenuPrice(homeQuery.data.wallet_summary.balance) : "Hazırlanıyor";
  const activeCart = homeQuery.data?.active_cart_summary ?? null;
  const menuSectionTitle = getMenuSectionTitle(categoryTitle);

  return (
    <PageContainer className="space-y-8 bg-white sm:space-y-10">
      <section className="relative min-h-[330px] overflow-hidden rounded-[24px] bg-[#f50555] px-6 pb-6 pt-8 text-white shadow-[0_22px_60px_rgba(244,5,85,0.22)] sm:min-h-[250px] sm:rounded-[28px] sm:px-8 sm:py-8 lg:px-10">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[92%] overflow-hidden sm:w-[58%]">
          <div className="absolute -right-32 top-[64%] h-[440px] w-[440px] -translate-y-1/2 rounded-full bg-white/10 sm:-right-16 sm:top-1/2 sm:h-[430px] sm:w-[430px]" />
          <div className="absolute -right-11 top-[70%] h-[320px] w-[320px] -translate-y-1/2 rounded-full bg-white/12 sm:right-4 sm:top-1/2 sm:h-[310px] sm:w-[310px]" />
          <div className="absolute right-5 top-[76%] h-[210px] w-[210px] -translate-y-1/2 rounded-full bg-white/14 sm:right-16 sm:top-1/2 sm:h-[210px] sm:w-[210px]" />
          <div className="absolute bottom-0 right-5 flex h-[94px] w-[148px] rotate-[10deg] items-center justify-center rounded-[26px] bg-[#ff2f76] text-5xl shadow-[0_20px_46px_rgba(120,0,44,0.22)] sm:right-10 sm:top-1/2 sm:h-[96px] sm:w-[148px] sm:-translate-y-1/2">
            <UtensilsCrossed className="h-11 w-11 text-white sm:h-14 sm:w-14" />
          </div>
        </div>

        <div className="relative z-10 max-w-[285px] sm:max-w-3xl">
          <Link
            href="/#mutfaklar"
            className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 transition hover:bg-white/20"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Mutfaklara dön
          </Link>

          <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
            {sessionQuery.data?.isAuthenticated ? `${greeting} ${displayName}` : `${categoryTitle} kataloğu`}
          </h1>
          <div className="mt-2 flex max-w-[260px] items-start gap-2 text-[23px] font-medium leading-tight sm:max-w-none sm:items-center sm:text-2xl">
            <span>{sessionQuery.data?.isAuthenticated ? "Bugün canınız ne çekiyor?" : categoryDescription}</span>
            <Info className="h-5 w-5 shrink-0" />
          </div>

          <div className="mt-6 flex max-w-[280px] flex-wrap gap-2.5 sm:max-w-none">
            <Link
              href="/#mutfaklar"
              className="inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-zinc-700 shadow-[0_10px_22px_rgba(120,0,44,0.12)] transition hover:-translate-y-0.5 hover:bg-rose-50 hover:text-[#f50555]"
              aria-label="Mutfaklara dön"
            >
              <RefreshCw className="h-4 w-4" />
            </Link>
            {catalogTabs.map((tab) => {
              const active = tab.slug === displaySlug;
              const href = tab.href.startsWith("/kategoriler") ? withSearchParams(tab.href, { district }) : tab.href;

              return (
                <Link
                  key={tab.slug}
                  href={href}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-semibold shadow-[0_10px_22px_rgba(120,0,44,0.12)] transition hover:-translate-y-0.5 ${
                    active ? "bg-zinc-950 text-white" : "bg-white text-zinc-700 hover:bg-rose-50 hover:text-[#f50555]"
                  }`}
                >
                  <Sparkles className={`h-3.5 w-3.5 ${active ? "text-white" : "text-[#f50555]"}`} />
                  {tab.label}
                </Link>
              );
            })}
          </div>

          {isAuthenticated ? (
            <div className="mt-5 grid max-w-[315px] grid-cols-2 gap-2.5 sm:max-w-2xl">
              <Link
                href="/cuzdan"
                className="group rounded-[18px] bg-white/95 p-3 text-zinc-950 shadow-[0_14px_30px_rgba(120,0,44,0.14)] transition hover:-translate-y-0.5 hover:bg-white sm:rounded-2xl sm:p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-[#f50555] sm:h-10 sm:w-10">
                    <Wallet className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 sm:text-xs sm:tracking-[0.14em]">Cüzdan bakiyesi</div>
                    <div className="mt-0.5 text-sm font-semibold leading-tight text-zinc-950 sm:text-lg">{walletBalanceText}</div>
                  </div>
                </div>
              </Link>

              <Link
                href={activeCart ? "/sepet" : "#kategori-menuleri"}
                className="group rounded-[18px] bg-white/95 p-3 text-zinc-950 shadow-[0_14px_30px_rgba(120,0,44,0.14)] transition hover:-translate-y-0.5 hover:bg-white sm:rounded-2xl sm:p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-[#f50555] sm:h-10 sm:w-10">
                    <ShoppingCart className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 sm:text-xs sm:tracking-[0.14em]">Aktif sepet</div>
                    <div className="mt-0.5 text-sm font-semibold leading-tight text-zinc-950 sm:text-lg">
                      {activeCart ? `${activeCart.item_count} ürün · ${formatMenuPrice(activeCart.total_amount)}` : "Sepet boş"}
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      {!hasValidSlug ? (
        <ErrorState
          title="Geçersiz kategori bağlantısı"
          description="Kategori bağlantısı okunamadı. Güvenli şekilde ana sayfadaki mutfaklar bölümüne dönebilirsin."
        />
      ) : null}

      {hasValidSlug && businessesError ? (
        <ErrorState
          title="Kategori işletmeleri yüklenemedi"
          description={describeApiError(businessesError, "Bu kategoriye ait işletmeler şu anda getirilemedi.")}
        />
      ) : null}

      {hasValidSlug && !businessesError ? (
        <>
          <section className="space-y-3">
            <h2 className="hy-market-heading text-[31px] leading-none text-zinc-800 sm:text-[34px]">{resultLabel}</h2>
          </section>

          <section id="kategori-menuleri" className="scroll-mt-32 space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="hy-market-heading text-[31px] leading-none text-zinc-700">{menuSectionTitle}</h3>
              </div>
            </div>

            {businessesPending || menusPending ? (
              <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <LoadingSkeleton key={index} />
                ))}
              </div>
            ) : menuItems.length > 0 ? (
              <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
                {menuItems.map(({ item, business, categoryName }) => {
                  const itemName = repairPotentialMojibake(item.name);
                  const businessName = repairPotentialMojibake(business.business_name);
                  const image = item.image || item.image_url || visual?.image || "";

                  return (
                    <Link
                      key={`${business.id}-${item.id}`}
                      href={withSearchParams(`/isletmeler/${business.id}`, { district })}
                      className="group block"
                    >
                      <article className="space-y-2">
                        <div className="relative aspect-[16/9] overflow-hidden rounded-[14px] border border-zinc-100 bg-zinc-100 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_34px_rgba(15,23,42,0.12)]">
                          {image ? (
                            <Image
                              src={image}
                              alt={itemName}
                              fill
                              unoptimized
                              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                              className="object-cover transition duration-300 group-hover:scale-[1.025]"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-rose-50 text-sm font-semibold text-[#f50555]">
                              HalkYemek
                            </div>
                          )}
                          <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-zinc-800 shadow-sm">
                            <Heart className="h-4 w-4" />
                          </span>
                          {business.is_featured ? (
                            <span className="absolute bottom-2 right-2 rounded-full bg-zinc-950/90 px-2 py-1 text-[10px] font-semibold text-white">
                              Öne Çıkan
                            </span>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 text-zinc-950">{itemName}</h4>
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#ff1f63]">
                              <Star className="h-3.5 w-3.5 fill-current" />
                              {formatMenuPrice(item.price_amount)}
                            </span>
                          </div>
                          <p className="truncate text-[12px] leading-5 text-zinc-600">
                            <span className="font-semibold text-zinc-700">İşletme:</span> {businessName}
                          </p>
                          <p className="truncate text-[12px] leading-5 text-zinc-600">
                            <span className="font-semibold text-zinc-700">Menü grubu:</span> {categoryName}
                          </p>
                          <div className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                            Kasada QR ile teslim
                          </div>
                        </div>
                      </article>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Bu katalog için menü görünmüyor"
                description="İlgili restoran kartlarından menü sayfasına geçerek aktif seçenekleri inceleyebilirsin."
              />
            )}
          </section>

          <section id="kategori-isletmeleri" className="scroll-mt-32 space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="hy-market-heading text-[31px] leading-none text-zinc-700">İlgili restoranlar</h3>
              </div>
            </div>

            {businessesPending ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <LoadingSkeleton key={index} />
                ))}
              </div>
            ) : businesses.length > 0 ? (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {businesses.map((business) => {
                  const businessName = repairPotentialMojibake(business.business_name);
                  const districtName = repairPotentialMojibake(business.district_label) || districtLabel;
                  const categoryName = getBusinessCategoryName(business);
                  const listingTypeLabel = getBusinessListingTypeLabel(business.listing_type, business.listing_type_label);
                  const businessQuotaLabel = getBusinessMenuQuotaDisplayText(business);
                  const businessQuotaTone = getBusinessMenuQuotaDisplayTone(business);
                  const summary =
                    repairPotentialMojibake(business.short_description || business.intro_text) ||
                    `${categoryTitle} kategorisinde uygun fiyatlı menüler sunan HalkYemek işletmesi.`;

                  return (
                    <Link key={business.id} href={withSearchParams(`/isletmeler/${business.id}`, { district })} className="group block">
                      <article className="space-y-2">
                        <div className="relative aspect-[16/9] overflow-hidden rounded-[14px] border border-zinc-100 bg-zinc-100 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_34px_rgba(15,23,42,0.12)]">
                          {business.cover_image ? (
                            <Image
                              src={business.cover_image}
                              alt={businessName}
                              fill
                              unoptimized
                              sizes="(max-width: 768px) 100vw, 33vw"
                              className="object-cover transition duration-300 group-hover:scale-[1.025]"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-rose-50 text-sm font-semibold text-[#f50555]">
                              HalkYemek
                            </div>
                          )}
                          <span className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-zinc-800 shadow-sm">
                            <Heart className="h-4 w-4" />
                          </span>
                          {business.is_featured ? (
                            <span className="absolute bottom-2 right-2 rounded-full bg-zinc-950/90 px-2 py-1 text-[10px] font-semibold text-white">
                              Öne Çıkan
                            </span>
                          ) : null}
                          {businessQuotaLabel ? (
                            <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${businessQuotaTone === "sold_out" ? "bg-zinc-950/90 text-white" : "bg-white/95 text-zinc-900"}`}>
                              {businessQuotaLabel}
                            </span>
                          ) : null}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h4 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 text-zinc-950">{businessName}</h4>
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#ff1f63]">
                              <Star className="h-3.5 w-3.5 fill-current" />
                              {business.is_featured ? "Öne çıkan" : listingTypeLabel}
                            </span>
                          </div>
                          <p className="truncate text-[12px] leading-5 text-zinc-600">
                            <span className="font-semibold text-zinc-700">Bölge:</span> {districtName}
                          </p>
                          <p className="truncate text-[12px] leading-5 text-zinc-600">
                            <span className="font-semibold text-zinc-700">Fiyat aralığı:</span> 140 TL - 198 TL arası · {categoryName}
                          </p>
                          <p className="line-clamp-2 text-[12px] leading-5 text-zinc-500">{summary}</p>
                          {businessQuotaLabel ? (
                            <div className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${businessQuotaTone === "sold_out" ? "bg-zinc-950 text-white" : "bg-rose-50 text-[#f50555]"}`}>
                              Menü kotası: {businessQuotaLabel}
                            </div>
                          ) : null}
                          <div className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                            QR ile kasada kullanım
                          </div>
                        </div>
                      </article>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                title="Bu katalogda restoran görünmüyor"
                description="Farklı bir kataloğa geçerek diğer işletmeleri inceleyebilirsin."
              />
            )}
          </section>
        </>
      ) : null}

      <section className="overflow-hidden rounded-[32px] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfb_100%)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="relative p-5 sm:p-7 lg:p-8">
          <div className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full bg-[#ff1f63]/12 blur-3xl" />
          <div className="relative grid gap-7 lg:grid-cols-[1.18fr_0.82fr] lg:items-stretch">
            <div className="space-y-5">
              <div className="inline-flex rounded-2xl bg-white px-4 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
                <Image src="/logo-halkyemek.png" alt="HalkYemek" width={1100} height={254} className="h-11 w-auto object-contain" />
              </div>

              <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl">
                Daha Uygun Fiyat, Daha Akıllı Sistem
              </h2>
              <p className="max-w-4xl text-[15px] leading-7 text-zinc-700">
                HalkYemek, işletmelerle özel anlaşmalar yaparak kullanıcılara daha avantajlı fiyatlar sunmayı hedefler.
              </p>

              <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {valueBullets.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm font-medium leading-6 text-zinc-800">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#ff1f63]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex min-h-[250px] flex-col justify-between overflow-hidden rounded-[26px] bg-zinc-950 p-6 text-white shadow-[0_18px_46px_rgba(15,23,42,0.22)]">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  HalkYemek manifestosu
                </div>
                <p className="mt-6 text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
                  Gereksiz maliyetleri azaltıyoruz, yemeği herkes için daha ulaşılabilir hale getiriyoruz.
                </p>
              </div>
              <div className="mt-8 h-1.5 w-24 rounded-full bg-[#ff1f63]" />
            </div>
          </div>
        </div>

        <div className="bg-zinc-950 p-5 text-white sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Image src="/logo-halkyemek.png" alt="HalkYemek" width={1100} height={254} className="h-10 w-auto rounded-xl bg-white object-contain px-3 py-1.5" />
              <p className="mt-3 max-w-md text-sm leading-6 text-zinc-300">
                Daha uygun, daha hızlı ve daha erişilebilir yemek deneyimi için HalkYemek.
              </p>
            </div>

            <div className="flex max-w-3xl flex-wrap gap-2">
              {footerLinks.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-full px-3.5 py-2 text-xs font-medium text-zinc-300 transition duration-200 hover:-translate-y-0.5 hover:bg-white/10 hover:text-white"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <Link href="/#mutfaklar" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 hover:text-[#f50555]">
        <ArrowLeft className="h-4 w-4" />
        Mutfaklara dön
      </Link>
    </PageContainer>
  );
}
