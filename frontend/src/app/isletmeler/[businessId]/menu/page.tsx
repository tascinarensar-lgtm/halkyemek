"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";

import { BusinessHero } from "@/components/discovery/business-hero";
import { MenuItemCard } from "@/components/discovery/menu-item-card";
import { OfferCard } from "@/components/discovery/offer-card";
import { StickyCartSummary } from "@/components/discovery/sticky-cart-summary";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { useCartSummary, usePublicBusinessMenu } from "@/features/discovery/hooks";
import { getMenuCategoryDisplayDescription, getMenuCategoryDisplayName } from "@/features/discovery/menu-copy";
import { resolveDistrict, resolvePositiveIntegerParam, withSearchParams } from "@/features/discovery/params";
import { useSession } from "@/hooks/use-session";
import { describeApiError, isNotFoundError } from "@/lib/api/presentation";

export default function BusinessMenuPage() {
  const params = useParams<{ businessId: string }>();
  const searchParams = useSearchParams();
  const businessId = resolvePositiveIntegerParam(params.businessId, 0);
  const district = resolveDistrict(searchParams.get("district"));
  const activeCategoryId = resolvePositiveIntegerParam(searchParams.get("kategori"), 0);
  const isValidBusinessId = businessId > 0;
  const sessionQuery = useSession();
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const menuQuery = usePublicBusinessMenu(businessId);
  const cartQuery = useCartSummary(isAuthenticated);
  const shouldShowFallbackError = !menuQuery.isPending && !menuQuery.isError && !menuQuery.data;

  const visibleCategories = useMemo(() => {
    const categories = menuQuery.data?.categories ?? [];
    if (!activeCategoryId) return categories;
    return categories.filter((category) => category.id === activeCategoryId);
  }, [activeCategoryId, menuQuery.data?.categories]);

  if (!isValidBusinessId) {
    return (
      <PageContainer className="space-y-6">
        <ErrorState title="Geçersiz menü bağlantısı" description="İşletme bağlantısı okunamadı. Güvenli şekilde işletme listesine dönebilirsiniz." />
        <Link href={withSearchParams("/isletmeler", { district })} className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          İşletmelere dön
        </Link>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-8">
      {menuQuery.isPending ? (
        <LoadingSkeleton />
      ) : menuQuery.isError ? (
        <ErrorState
          title={isNotFoundError(menuQuery.error) ? "İşletme menüsü bulunamadı" : "İşletme menüsü yüklenemedi"}
          description={describeApiError(menuQuery.error, "İşletmenin menü verisi şu anda getirilemedi.")}
        />
      ) : menuQuery.data ? (
        <>
          <BusinessHero business={menuQuery.data.business} showMenuCta={false} district={district} />

          <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              <Card className="border-stone-200 bg-[linear-gradient(145deg,_rgba(248,250,252,0.98),_rgba(255,255,255,0.98))]">
                <CardContent className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-1">
                      <h2 className="text-lg font-semibold text-zinc-950">Menüyü incele ve siparişini oluştur.</h2>
                      <p className="text-sm leading-6 text-zinc-600">
                        Kategoriyi seç, ürünleri incele, sepete ekle ve ödeme sonrası QR ile teslim al. Sipariş akışı bu sayfada kısa ve nettir.
                      </p>
                    </div>
                    <Link href={withSearchParams(`/isletmeler/${businessId}`, { district })} className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900">
                      İşletme detayına dön
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={withSearchParams(`/isletmeler/${businessId}/menu`, { district })}
                      className={`rounded-full px-3 py-1.5 text-sm transition ${!activeCategoryId ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}
                    >
                      Tümü
                    </Link>
                    {menuQuery.data.categories.map((category) => (
                      <Link
                        key={category.id}
                        href={withSearchParams(`/isletmeler/${businessId}/menu`, { district, kategori: category.id })}
                        className={`rounded-full px-3 py-1.5 text-sm transition ${
                          activeCategoryId === category.id ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
                        }`}
                      >
                        {getMenuCategoryDisplayName(category)}
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {menuQuery.data.active_offers.length > 0 ? (
                <section className="space-y-4">
                  <div className="space-y-1">
                    <h2 className="text-xl font-semibold text-zinc-950">HalkYemek fırsatları</h2>
                    <p className="text-sm leading-6 text-zinc-600">Bu işletmede yayında olan fırsatları buradan görebilir, istersen ürünleri menüden seçebilirsin.</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {menuQuery.data.active_offers.map((offer) => (
                      <OfferCard key={offer.id} offer={offer} />
                    ))}
                  </div>
                </section>
              ) : null}

              {visibleCategories.length > 0 ? (
                <div className="space-y-8">
                  {visibleCategories.map((category) => (
                    <section key={category.id} className="space-y-4">
                      <div className="space-y-1">
                        <h2 className="text-xl font-semibold text-zinc-950">{getMenuCategoryDisplayName(category)}</h2>
                        <p className="text-sm leading-6 text-zinc-600">{getMenuCategoryDisplayDescription(category)}</p>
                      </div>
                      {category.menu_items.length > 0 ? (
                        <div className="space-y-4">
                          {category.menu_items.map((item) => (
                            <MenuItemCard key={item.id} item={item} businessId={businessId} cart={cartQuery.data} />
                          ))}
                        </div>
                      ) : (
                        <EmptyState title="Ürün bulunamadı" description="Bu kategoride şu anda gösterilecek aktif ürün görünmüyor." />
                      )}
                    </section>
                  ))}
                </div>
              ) : (
                <EmptyState title="Menü boş görünüyor" description="Seçili filtre için gösterilecek kategori veya ürün bulunamadı." />
              )}
            </div>

            <div className="space-y-4">
              {cartQuery.isError ? (
                <ErrorState title="Sepet özeti alınamadı" description={describeApiError(cartQuery.error, "Sepet özeti şu anda gösterilemiyor.")} />
              ) : null}
              <StickyCartSummary cart={cartQuery.data} businessId={businessId} isAuthenticated={isAuthenticated} />

              <Card className="border-stone-200 bg-white">
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                    <ShoppingBag className="h-4 w-4" /> Sipariş akışı
                  </div>
                  <div className="space-y-3 text-sm text-zinc-600">
                    <p>1. Kategoriden ürününü seç.</p>
                    <p>2. Sepete ekleyip ödemenin ardından siparişini tamamla.</p>
                    <p>3. QR ile kasada hızlı teslim al.</p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : null}

      {shouldShowFallbackError ? <ErrorState title="Menü verisi alınamadı" description="İstek tamamlandı ancak gösterilebilir bir menü verisi dönmedi." /> : null}
    </PageContainer>
  );
}
