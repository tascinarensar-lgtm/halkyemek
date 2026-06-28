"use client";

import Image from "next/image";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, Heart, MapPin, Percent, Sparkles, UtensilsCrossed } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { CartSidebar } from "@/components/cart/cart-sidebar";
import { MobileCartBar } from "@/components/cart/mobile-cart-bar";
import { MobileCartSheet } from "@/components/cart/mobile-cart-sheet";
import { MenuItemCard } from "@/components/discovery/menu-item-card";
import { OfferCard } from "@/components/discovery/offer-card";
import { StickyCartSummary } from "@/components/discovery/sticky-cart-summary";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { clearCart, removeCartItem, updateCartItemQuantity } from "@/features/cart/api";
import type { CartItemSnapshot } from "@/features/cart/types";
import { isDemoBusinessCopy } from "@/features/discovery/business-copy";
import { getCategoryDisplayName } from "@/features/discovery/category-copy";
import { useCartSummary, usePublicBusinessDetail, usePublicBusinessMenu } from "@/features/discovery/hooks";
import { resolveDistrict, resolvePositiveIntegerParam } from "@/features/discovery/params";
import { getBusinessMenuQuotaDisplayText } from "@/features/discovery/quota-copy";
import { useSession } from "@/hooks/use-session";
import { describeApiError, isNotFoundError } from "@/lib/api/presentation";
import { getMapsDirectionsUrl } from "@/lib/maps";
import { repairPotentialMojibake } from "@/lib/utils/text";
import { useUiStore } from "@/store/ui-store";

const districtLabels: Record<string, string> = {
  BEYLIKDUZU: "İstanbul/Beylikdüzü",
};

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

const businessFooterHighlights = [
  "Özel fiyatlı menüler",
  "Cüzdanla güvenli ödeme",
  "QR ile hızlı teslim",
  "Bütçe dostu işletmeler",
];

function isSuppressedDemoText(value: string) {
  const normalized = value.toLocaleLowerCase("tr-TR");
  return normalized === "gönüllü" || normalized.includes("demo işletme kaydı") || normalized.includes("gönüllü/uygun fiyatlı demo");
}

function cleanBusinessText(value: string | null | undefined) {
  const text = repairPotentialMojibake(value).trim();
  return isSuppressedDemoText(text) || isDemoBusinessCopy(text) ? "" : text;
}

const categoryHrefBySlug: Record<string, string> = {
  burger: "/kategoriler/burger",
  pizza: "/kategoriler/pizza",
  doner: "/kategoriler/doner",
  kebap: "/kategoriler/kebap",
  "firin-pastane": "/kategoriler/burger",
  "kafe-kahve-zincirleri": "/kategoriler/burger",
  marketler: "/kategoriler/burger",
  "fast-food-restoranlari": "/kategoriler/burger",
  "doner-kebap-isletmeleri": "/kategoriler/doner",
};

function getCategoryHref(slug: string) {
  return categoryHrefBySlug[slug] ?? "";
}

function GoogleMapsLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={className}>
      <path fill="#1A73E8" d="M24 4C15.7 4 9 10.7 9 19c0 10.5 15 25 15 25s15-14.5 15-25C39 10.7 32.3 4 24 4Z" />
      <path fill="#34A853" d="M24 4C15.7 4 9 10.7 9 19c0 4 2.2 8.8 5.1 13.2L24 22V4Z" />
      <path fill="#FBBC04" d="M24 22 14.1 32.2C18.2 38.3 24 44 24 44s5.8-5.7 9.9-11.8L24 22Z" />
      <path fill="#EA4335" d="M24 4v18l9.9 10.2C36.8 27.8 39 23 39 19c0-8.3-6.7-15-15-15Z" />
      <circle cx="24" cy="19" r="5.5" fill="#fff" />
    </svg>
  );
}

export default function BusinessDetailPage() {
  const params = useParams<{ businessId: string }>();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const isCartDrawerOpen = useUiStore((state) => state.isCartDrawerOpen);
  const setCartDrawerOpen = useUiStore((state) => state.setCartDrawerOpen);
  const district = resolveDistrict(searchParams.get("district"));
  const businessId = resolvePositiveIntegerParam(params.businessId, 0);
  const isValidBusinessId = businessId > 0;
  const sessionQuery = useSession();
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const sessionUserId = sessionQuery.data?.user?.id ?? null;
  const detailQuery = usePublicBusinessDetail(businessId);
  const menuQuery = usePublicBusinessMenu(businessId);
  const cartQuery = useCartSummary(isAuthenticated, sessionUserId);
  const districtLabel = districtLabels[district] ?? district;
  const menuCategories = menuQuery.data?.categories ?? [];
  const menuCategoriesWithItems = menuCategories.filter((category) => category.menu_items.length > 0);
  const menuItemCount = menuCategories.reduce((total, category) => total + category.menu_items.length, 0);
  const hasSameBusinessCart = Boolean(
    isAuthenticated &&
      cartQuery.data &&
      cartQuery.data.item_count > 0 &&
      cartQuery.data.business === businessId,
  );
  const shouldShowMobileSummary = !hasSameBusinessCart;

  const syncCart = async (cart: unknown) => {
    queryClient.setQueryData(["cart", "detail"], cart);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cart"] }),
      queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
    ]);
  };

  const updateMutation = useMutation({
    mutationFn: updateCartItemQuantity,
    onSuccess: async (nextCart) => {
      await syncCart(nextCart);
    },
    onError: (error) => toast.error(describeApiError(error, "Sepetin güncellenemedi.")),
  });

  const removeMutation = useMutation({
    mutationFn: removeCartItem,
    onSuccess: async (nextCart) => {
      await syncCart(nextCart);
    },
    onError: (error) => toast.error(describeApiError(error, "Ürün sepetten çıkarılamadı.")),
  });

  const clearMutation = useMutation({
    mutationFn: clearCart,
    onSuccess: async (nextCart) => {
      await syncCart(nextCart);
    },
    onError: (error) => toast.error(describeApiError(error, "Sepet temizlenemedi.")),
  });

  const isCartMutationPending = updateMutation.isPending || removeMutation.isPending || clearMutation.isPending;

  const handleSelectQuantity = (item: CartItemSnapshot, quantity: number) => {
    updateMutation.mutate({ itemId: item.cart_item_id, quantity });
  };

  const handleDecrease = (item: CartItemSnapshot) => {
    updateMutation.mutate({ itemId: item.cart_item_id, quantity: Math.max(1, item.quantity - 1) });
  };

  const handleIncrease = (item: CartItemSnapshot) => {
    updateMutation.mutate({ itemId: item.cart_item_id, quantity: Math.min(10, item.quantity + 1) });
  };

  const handleRemove = (item: CartItemSnapshot) => {
    removeMutation.mutate(item.cart_item_id);
  };

  if (!isValidBusinessId) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState
          title="Geçersiz işletme bağlantısı"
          description="İşletme bağlantısı okunamadı. Güvenli şekilde ana sayfadaki restoranlara dönebilirsin."
        />
        <Link href="/#restoranlar" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 hover:text-[#f50555]">
          <ArrowLeft className="h-4 w-4" />
          Restoranlara dön
        </Link>
      </PageContainer>
    );
  }

  if (detailQuery.isPending) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <LoadingSkeleton />
        <div className="grid gap-5 lg:grid-cols-3">
          <LoadingSkeleton />
          <LoadingSkeleton />
          <LoadingSkeleton />
        </div>
      </PageContainer>
    );
  }

  if (detailQuery.isError) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <ErrorState
          title={isNotFoundError(detailQuery.error) ? "İşletme bulunamadı" : "İşletme profili yüklenemedi"}
          description={describeApiError(
            detailQuery.error,
            isNotFoundError(detailQuery.error)
              ? "Bu işletme kaydı artık görünmüyor veya bağlantı güncel değil."
              : "İşletme bilgileri şu anda getirilemedi. Lütfen kısa süre sonra tekrar dene.",
          )}
        />
        <Link href="/#restoranlar" className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 hover:text-[#f50555]">
          <ArrowLeft className="h-4 w-4" />
          Restoranlara dön
        </Link>
      </PageContainer>
    );
  }

  if (!detailQuery.data) {
    return (
      <PageContainer className="space-y-6 bg-white">
        <EmptyState title="İşletme profili alınamadı" description="İstek tamamlandı ancak gösterilebilir işletme verisi dönmedi." />
      </PageContainer>
    );
  }

  const detail = detailQuery.data;
  const business = detail.business;
  const businessName = repairPotentialMojibake(business.business_name);
  const cover = business.cover_image || detail.media.find((asset) => asset.asset_role === "COVER")?.url || "";
  const logo = business.logo_image || detail.media.find((asset) => asset.asset_role === "LOGO")?.url || "";
  const primaryCategorySlug = business.primary_marketplace_category?.slug ?? "";
  const primaryCategory = business.primary_marketplace_category
    ? getCategoryDisplayName(primaryCategorySlug, business.primary_marketplace_category.name)
    : "Kategori bilgisi yakında güncellenecek";
  const primaryCategoryHref = getCategoryHref(primaryCategorySlug);
  const badgeText = cleanBusinessText(business.badge_text);
  const mapsUrl = getMapsDirectionsUrl(business);
  const businessQuotaLabel = getBusinessMenuQuotaDisplayText(business);

  return (
    <PageContainer className={`space-y-8 bg-white sm:space-y-10 ${hasSameBusinessCart ? "pb-32 lg:pb-0" : ""}`}>
      <section className="overflow-hidden rounded-[26px] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.1)] sm:rounded-[32px]">
        <div className="relative min-h-[620px] overflow-hidden bg-zinc-950 sm:min-h-[620px] lg:min-h-[500px]">
          {cover ? (
            <Image src={cover} alt={businessName} fill unoptimized priority sizes="100vw" className="object-cover" />
          ) : (
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,31,99,0.3),transparent_36%),linear-gradient(135deg,#18181b,#09090b)]" />
          )}
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,9,11,0.16),rgba(9,9,11,0.44)_42%,rgba(9,9,11,0.86)_100%)]" />

          <div className="absolute left-4 right-4 top-4 z-30 flex items-center justify-between gap-3 sm:left-7 sm:right-7 sm:top-7">
            <Link
              href="/#restoranlar"
              className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white/16 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/24 backdrop-blur transition hover:bg-white/24"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Restoranlara dön
            </Link>
            <button
              type="button"
              aria-label="Favorilere ekle"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/92 text-zinc-800 shadow-[0_12px_26px_rgba(0,0,0,0.16)] transition hover:-translate-y-0.5 hover:bg-white hover:text-[#f50555]"
            >
              <Heart className="h-5 w-5" />
            </button>
          </div>

          <div className="absolute inset-x-0 bottom-0 z-20 p-4 pt-24 sm:p-7 lg:p-8">
            <div className="grid gap-6 lg:grid-cols-[1fr_340px] lg:items-end">
              <div className="max-w-3xl text-white">
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#f50555] shadow-sm">
                    <Sparkles className="h-3.5 w-3.5" />
                    HalkYemek işletmesi
                  </span>
                  {business.is_featured ? (
                    <span className="rounded-full bg-zinc-950/72 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur">
                      Öne çıkan
                    </span>
                  ) : null}
                  {badgeText ? (
                    <span className="rounded-full bg-white/14 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/15 backdrop-blur">
                      {badgeText}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5 flex items-end gap-3 sm:gap-4">
                  <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[22px] border border-white/25 bg-white/92 shadow-[0_18px_40px_rgba(0,0,0,0.22)] sm:h-20 sm:w-20 sm:rounded-[26px]">
                    {logo ? (
                      <Image src={logo} alt={businessName} fill unoptimized sizes="80px" className="object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm font-semibold text-zinc-500">HY</div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-3xl font-semibold tracking-[-0.05em] sm:text-5xl">{businessName}</h1>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-full bg-white/94 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-white/40 transition hover:-translate-y-0.5 hover:bg-white"
                  >
                    <MapPin className="h-4 w-4 text-[#f50555]" />
                    {repairPotentialMojibake(business.district_label) || districtLabel}
                  </button>
                  {primaryCategoryHref ? (
                    <Link
                      href={primaryCategoryHref}
                      className="inline-flex items-center gap-2 rounded-full bg-white/94 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-white/40 transition hover:-translate-y-0.5 hover:bg-white hover:text-[#f50555]"
                    >
                      <UtensilsCrossed className="h-4 w-4 text-[#f50555]" />
                      {primaryCategory}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 rounded-full bg-white/94 px-3 py-2 text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-white/40 transition hover:-translate-y-0.5 hover:bg-white"
                    >
                      <UtensilsCrossed className="h-4 w-4 text-[#f50555]" />
                      {primaryCategory}
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-[24px] bg-white/95 p-4 text-zinc-950 shadow-[0_22px_60px_rgba(0,0,0,0.22)] backdrop-blur sm:rounded-[28px]">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">İşletme özeti</p>
                    <h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Menüye geçmeden önce</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                    <div className="rounded-2xl bg-rose-50 p-3">
                      <p className="text-xs font-semibold text-[#f50555]">Menü</p>
                      <p className="mt-1 text-lg font-semibold">{menuQuery.isPending ? "..." : `${menuItemCount} ürün`}</p>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-xs font-semibold text-zinc-500">Kategori</p>
                      <p className="mt-1 text-base font-semibold leading-6">{primaryCategory}</p>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-3">
                      <p className="text-xs font-semibold text-zinc-500">Menü kotası</p>
                      <p className="mt-1 text-base font-semibold leading-6">
                        {menuQuery.isPending ? "..." : businessQuotaLabel || "Kota tanımlı değil"}
                      </p>
                    </div>
                    {mapsUrl ? (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex min-h-[86px] flex-col justify-between rounded-2xl bg-gradient-to-br from-[#f50555] to-[#d9043a] p-3 text-left text-white shadow-[0_16px_34px_rgba(245,5,85,0.22)] ring-1 ring-white/10 transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(245,5,85,0.32)]"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-xs font-semibold text-white/75">Konum</span>
                          <div className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-zinc-800 shadow-sm ring-1 ring-white/50">
                            <GoogleMapsLogo className="h-4 w-4" />
                            <span className="text-[10px] font-bold tracking-tight">Maps</span>
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-2 text-base font-semibold leading-6 group-hover:gap-3 transition-all">
                          <GoogleMapsLogo className="h-5 w-5 rounded-full bg-white p-0.5" />
                          İşletmeye git
                        </span>
                      </a>
                    ) : (
                      <div className="rounded-2xl bg-zinc-50 p-3">
                        <p className="text-xs font-semibold text-zinc-500">Konum</p>
                        <p className="mt-1 text-base font-semibold leading-6">Konum yakında</p>
                      </div>
                    )}
                  </div>
                  <Link
                    href="#isletme-menuleri"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(245,5,85,0.24)] transition hover:-translate-y-0.5 hover:bg-[#e5044e]"
                  >
                    Menülere git
                    <ArrowDown className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="isletme-menuleri" className="scroll-mt-28">
        {menuQuery.isPending ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <LoadingSkeleton />
              <LoadingSkeleton />
              <LoadingSkeleton />
            </div>
            <LoadingSkeleton />
          </div>
        ) : menuQuery.isError ? (
          <ErrorState title="Menüler alınamadı" description={describeApiError(menuQuery.error, "İşletme menüleri şu anda gösterilemiyor.")} />
        ) : menuCategoriesWithItems.length > 0 ? (
          <div className="grid gap-5 sm:gap-6 lg:grid-cols-[1fr_330px] lg:items-start">
            <div className="space-y-7">
              {menuCategoriesWithItems.map((category) => (
                <section
                  key={category.id}
                  id={`kategori-${category.id}`}
                  className="scroll-mt-32 space-y-4"
                >
                  {category.menu_items.map((item) => (
                    <MenuItemCard key={item.id} item={item} businessId={businessId} cart={cartQuery.data} />
                  ))}
                </section>
              ))}
            </div>

            <div className="space-y-4">
              {cartQuery.isError ? (
                <ErrorState title="Sepet özeti alınamadı" description={describeApiError(cartQuery.error, "Sepet özeti şu anda gösterilemiyor.")} />
              ) : null}

              {shouldShowMobileSummary ? (
                <div className="lg:hidden">
                  <StickyCartSummary cart={cartQuery.data} businessId={businessId} isAuthenticated={isAuthenticated} />
                </div>
              ) : null}

              <CartSidebar
                cart={cartQuery.data}
                businessId={businessId}
                isAuthenticated={isAuthenticated}
                isPending={isCartMutationPending}
                onSelectQuantity={handleSelectQuantity}
                onDecrease={handleDecrease}
                onIncrease={handleIncrease}
                onRemove={handleRemove}
                onClear={() => clearMutation.mutate()}
                clearPending={clearMutation.isPending}
              />
            </div>
          </div>
        ) : (
          <EmptyState title="Menü şu anda boş görünüyor" description="Bu işletmenin aktif menüleri yakında burada görünecek." />
        )}
      </section>

      {detail.active_offers.length > 0 ? (
        <section className="space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700">Aktif fırsatlar</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Bu işletmede yayında olan avantajları inceleyebilirsin.</p>
            </div>
            <span className="inline-flex w-fit items-center gap-2 rounded-full bg-rose-50 px-3 py-2 text-sm font-semibold text-[#f50555]">
              <Percent className="h-4 w-4" />
              {detail.active_offers.length} fırsat
            </span>
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {detail.active_offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>
        </section>
      ) : null}

      {hasSameBusinessCart && cartQuery.data ? (
        <>
          <MobileCartBar
            itemCount={cartQuery.data.item_count}
            totalAmount={cartQuery.data.pricing?.total_payable_amount ?? cartQuery.data.total_amount}
            currency={cartQuery.data.currency}
            onOpen={() => setCartDrawerOpen(true)}
          />
          <MobileCartSheet
            isOpen={isCartDrawerOpen}
            cart={cartQuery.data}
            isPending={isCartMutationPending}
            clearPending={clearMutation.isPending}
            onClose={() => setCartDrawerOpen(false)}
            onSelectQuantity={handleSelectQuantity}
            onDecrease={handleDecrease}
            onIncrease={handleIncrease}
            onRemove={handleRemove}
            onClear={() => clearMutation.mutate()}
          />
        </>
      ) : null}
    </PageContainer>
  );
}
