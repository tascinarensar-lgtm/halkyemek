"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, LayoutGrid, MapPin, Percent } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";

import { BusinessHero } from "@/components/discovery/business-hero";
import { OfferCard } from "@/components/discovery/offer-card";
import { DistrictPicker } from "@/components/discovery/district-picker";
import { AmountText } from "@/components/ui/amount-text";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { getBusinessListingTypeLabel } from "@/features/discovery/business-copy";
import { QueryState } from "@/components/ui/query-state";
import { getCategoryDisplayName } from "@/features/discovery/category-copy";
import { getMenuItemDisplayDescription, getMenuItemDisplayImage, getMenuItemDisplayName } from "@/features/discovery/menu-copy";
import { usePublicBusinessDetail, usePublicBusinessMenu } from "@/features/discovery/hooks";
import { resolveDistrict, resolvePositiveIntegerParam, withSearchParams } from "@/features/discovery/params";
import { isNotFoundError } from "@/lib/api/presentation";
import { repairPotentialMojibake } from "@/lib/utils/text";

const districtLabels: Record<string, string> = {
  BEYLIKDUZU: "İstanbul/Beylikdüzü",
};

export default function BusinessDetailPage() {
  const params = useParams<{ businessId: string }>();
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const businessId = resolvePositiveIntegerParam(params.businessId, 0);
  const isValidBusinessId = businessId > 0;
  const detailQuery = usePublicBusinessDetail(businessId);
  const menuQuery = usePublicBusinessMenu(businessId);
  const districtLabel = districtLabels[district] ?? district;
  const currentBusinessName = detailQuery.data ? repairPotentialMojibake(detailQuery.data.business.business_name) : "";

  if (!isValidBusinessId) {
    return (
      <PageContainer className="space-y-6">
        <Card className="border-zinc-200 bg-white">
          <CardContent className="space-y-4 p-6">
            <h1 className="text-2xl font-semibold text-zinc-950">Geçersiz işletme bağlantısı</h1>
            <p className="text-sm leading-6 text-zinc-600">
              İşletme bağlantısı okunamadı. Güvenli şekilde işletme listesine dönerek yeniden seçim yapabilirsin.
            </p>
            <Link
              href={withSearchParams("/isletmeler", { district })}
              className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
            >
              İşletmelere dön
            </Link>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-10">
      <div className="rounded-[28px] border border-zinc-200 bg-[linear-gradient(135deg,_rgba(248,250,252,0.98),_rgba(255,255,255,1))] p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
              <Link href={withSearchParams("/isletmeler", { district })} className="hover:text-zinc-800">
                İşletmeler
              </Link>
              <span className="text-zinc-300">/</span>
              <span className="text-zinc-700">İşletme detayı</span>
            </div>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
                {currentBusinessName ? `HalkYemek ${currentBusinessName} işletmesini yakından incele.` : "HalkYemek işletmesini yakından incele."}
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-zinc-600 sm:text-base">
                Bu sayfada işletmenin öne çıkan yönlerini, menü kategorilerini ve sana özel fırsatlarını görebilir; ardından
                birkaç adımda menüye geçebilirsin.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-sky-50 px-3 py-1.5 text-sm font-medium text-sky-900 ring-1 ring-sky-200">
                Aktif Bölge: {districtLabel}
              </span>
            </div>
          </div>
          <div className="shrink-0">
            <DistrictPicker />
          </div>
        </div>
      </div>

      <QueryState
        isPending={detailQuery.isPending}
        isError={detailQuery.isError}
        error={detailQuery.error}
        data={detailQuery.data}
        errorTitle={detailQuery.isError && isNotFoundError(detailQuery.error) ? "İşletme bulunamadı" : "İşletme detayı yüklenemedi"}
        errorDescription={
          detailQuery.isError && isNotFoundError(detailQuery.error)
            ? "Bu işletme kaydı artık görünmüyor veya bağlantı güncel değil."
            : undefined
        }
        emptyTitle="İşletme detayı alınamadı"
        emptyDescription="İstek tamamlandı ancak gösterilebilir bir işletme verisi dönmedi. Lütfen tekrar deneyin."
      >
        {(detail) => {
          const businessName = repairPotentialMojibake(detail.business.business_name);
          const listingTypeLabel = getBusinessListingTypeLabel(detail.business.listing_type, detail.business.listing_type_label);
          const primaryCategory = detail.business.primary_marketplace_category
            ? getCategoryDisplayName(detail.business.primary_marketplace_category.slug, detail.business.primary_marketplace_category.name)
            : "Kategori bilgisi yakında eklenecek";
          const categoryCount = detail.category_overview.length;
          const offerCount = detail.active_offers.length;
          const menuPreviewCategories =
            menuQuery.data?.categories
              .filter((category) => category.menu_items.length > 0)
              .slice(0, 2) ?? [];

          return (
            <>
              <BusinessHero business={detail.business} media={detail.media} district={district} />

              <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <Card className="border-stone-200 bg-white">
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <h2 className="text-xl font-semibold text-zinc-950">Bu işletmede seni neler bekliyor?</h2>
                      <p className="text-sm leading-6 text-zinc-600">
                        HalkYemek’in amacı, vatandaşımızın istediği yemeğe daha erişilebilir ve özellikle daha ucuz fiyat koşullarında ulaşmasını sağlamaktır.
                        {` ${businessName}`} sayfasında menüye geçerek sana uygun seçenekleri görebilir, sepetini oluşturabilir ve ödeme sonrası QR ile teslim akışına devam edebilirsin.
                      </p>
                    </div>

                    <div className="space-y-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                        <div className="space-y-1">
                          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">Menüden ilk seçenekler</h3>
                          <p className="text-sm leading-6 text-zinc-600">
                            İşletmenin menüsünden birkaç ürünü buradan görebilir, tüm liste için menü ekranına geçebilirsin.
                          </p>
                        </div>
                        <Link
                          href={withSearchParams(`/isletmeler/${businessId}/menu`, { district })}
                          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900"
                        >
                          Tüm menüyü gör
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>

                      {menuQuery.isPending ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          {Array.from({ length: 2 }).map((_, index) => (
                            <div key={index} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                              <div className="h-4 w-32 rounded bg-zinc-200" />
                              <div className="mt-4 space-y-2">
                                <div className="h-3 w-full rounded bg-zinc-200" />
                                <div className="h-3 w-4/5 rounded bg-zinc-200" />
                                <div className="h-3 w-3/5 rounded bg-zinc-200" />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : menuPreviewCategories.length > 0 ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {menuPreviewCategories.map((category) => (
                            <div key={category.id} className="rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4">
                              <div className="space-y-1">
                                <h4 className="font-medium text-zinc-950">{repairPotentialMojibake(category.name)}</h4>
                                <p className="text-sm leading-6 text-zinc-600">
                                  {repairPotentialMojibake(category.description) || "Bu kategorideki ürünlerin tamamını menü ekranında görebilirsin."}
                                </p>
                              </div>
                              <div className="mt-4 space-y-3">
                                {category.menu_items.slice(0, 3).map((item) => (
                                  <div key={item.id} className="rounded-xl border border-white bg-white p-3 shadow-sm">
                                    <div className="grid gap-3 sm:grid-cols-[76px_1fr]">
                                      <div className="aspect-square overflow-hidden rounded-xl bg-zinc-100">
                                        {getMenuItemDisplayImage(item) ? (
                                          <img src={getMenuItemDisplayImage(item)} alt={getMenuItemDisplayName(item)} className="h-full w-full object-cover" />
                                        ) : (
                                          <div className="flex h-full items-center justify-center text-xs text-zinc-400">Görsel yok</div>
                                        )}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex items-start justify-between gap-3">
                                          <p className="font-medium text-zinc-950">{getMenuItemDisplayName(item)}</p>
                                          <div className="shrink-0 text-sm font-semibold text-zinc-950">
                                            <AmountText amount={item.price_amount} />
                                          </div>
                                        </div>
                                        <p className="mt-1 text-sm leading-6 text-zinc-600">
                                          {getMenuItemDisplayDescription(item)}
                                        </p>
                                        <div className="mt-3">
                                          <span
                                            className={`rounded-full px-2.5 py-1 text-xs ${
                                              item.is_available ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-500"
                                            }`}
                                          >
                                            {item.is_available ? "Müsait" : "Şu an kapalı"}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                          <p className="text-sm leading-6 text-zinc-600">
                            Menü önizlemesi şu anda burada gösterilemiyor. Tüm seçenekleri görmek için menü ekranına geçebilirsin.
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">İşletme tipi</div>
                        <p className="mt-2 text-base font-semibold text-zinc-950">{listingTypeLabel}</p>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ana kategori</div>
                        <p className="mt-2 text-base font-semibold text-zinc-950">{primaryCategory}</p>
                      </div>
                      <div className="rounded-2xl bg-zinc-50 p-4">
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Aktif fırsat</div>
                        <p className="mt-2 text-base font-semibold text-zinc-950">{offerCount}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">Menü kategorileri</h3>
                      {detail.category_overview.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          {detail.category_overview.map((category) => (
                            <div key={category.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                              <p className="font-medium text-zinc-950">{repairPotentialMojibake(category.name)}</p>
                              <p className="mt-1 text-sm leading-6 text-zinc-600">
                                {repairPotentialMojibake(category.description) || "Bu kategori altında seni bekleyen ürünleri menü ekranında görebilirsin."}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm leading-6 text-zinc-500">
                          Bu işletme için menü kategorileri henüz paylaşılmamış. Menü ekranına geçtiğinde aktif ürünler doğrudan listelenir.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card className="border-stone-200 bg-[linear-gradient(145deg,_rgba(248,250,252,0.98),_rgba(255,255,255,0.98))]">
                    <CardContent className="space-y-5">
                      <div className="space-y-2">
                        <h2 className="text-xl font-semibold text-zinc-950">HalkYemek ile sipariş akışı</h2>
                        <p className="text-sm leading-6 text-zinc-600">
                          Süreç kısa ve nettir: menüyü incele, uygun seçeneği sepete ekle, ödemeni tamamla ve QR ile hızlıca teslim al.
                        </p>
                      </div>
                      <div className="space-y-3 text-sm text-zinc-700">
                        <div className="flex gap-3">
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white">1</span>
                          <p>İşletmenin menüsünü aç ve sana uygun menüyü seç.</p>
                        </div>
                        <div className="flex gap-3">
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white">2</span>
                          <p>Sepetine ekleyip ödemenin ardından siparişini onayla.</p>
                        </div>
                        <div className="flex gap-3">
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-xs font-semibold text-white">3</span>
                          <p>Kasada QR kodunu göster ve yemeğini hızlıca teslim al.</p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <ButtonLink href={withSearchParams(`/isletmeler/${businessId}/menu`, { district })} className="w-full">
                          Menüye geç
                        </ButtonLink>
                        <ButtonLink href={withSearchParams("/isletmeler", { district })} variant="secondary" className="w-full">
                          Tüm işletmelere dön
                        </ButtonLink>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="border-stone-200 bg-white">
                    <CardContent className="space-y-4">
                      <h3 className="text-base font-semibold text-zinc-950">Hızlı özet</h3>
                      <div className="grid gap-3">
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                            <MapPin className="h-4 w-4" /> Bölge
                          </div>
                          <p className="mt-2 text-base font-semibold text-zinc-950">{repairPotentialMojibake(detail.business.district_label) || districtLabel}</p>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                            <LayoutGrid className="h-4 w-4" /> Menü kategorisi
                          </div>
                          <p className="mt-2 text-base font-semibold text-zinc-950">{categoryCount}</p>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
                            <Percent className="h-4 w-4" /> Fırsat durumu
                          </div>
                          <p className="mt-2 text-base font-semibold text-zinc-950">
                            {offerCount > 0 ? `${offerCount} aktif fırsat` : "Şu anda fırsat görünmüyor"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>

              {detail.active_offers.length > 0 ? (
                <section className="space-y-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                    <div className="space-y-1">
                      <h2 className="text-xl font-semibold text-zinc-950">HalkYemek’e özel fırsatlar</h2>
                      <p className="text-sm leading-6 text-zinc-600">
                        İşletmenin yayındaki fırsatlarını buradan görebilir, istersen doğrudan menü ekranına geçerek tüm seçenekleri inceleyebilirsin.
                      </p>
                    </div>
                    <Link
                      href={withSearchParams(`/isletmeler/${businessId}/menu`, { district })}
                      className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900"
                    >
                      Menüye git
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {detail.active_offers.map((offer) => (
                      <OfferCard key={offer.id} offer={offer} />
                    ))}
                  </div>
                </section>
              ) : null}

              <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,1),_rgba(248,250,252,0.96))]">
                <CardContent className="flex flex-col gap-5 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
                  <div className="space-y-2">
                    <h3 className="text-lg font-semibold text-zinc-950">Hazırsan menüye geç ve siparişini oluştur.</h3>
                    <p className="max-w-2xl text-sm leading-6 text-zinc-600">
                      HalkYemek akışında sonraki adım menü ekranıdır. Buradan ürünleri inceleyebilir, sepetine ekleyebilir ve ödeme sonrası QR teslim sürecine devam edebilirsin.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <ButtonLink href={withSearchParams(`/isletmeler/${businessId}/menu`, { district })}>
                      Menüye geç
                    </ButtonLink>
                    <ButtonLink href="/sepet" variant="secondary">
                      Sepeti aç
                    </ButtonLink>
                  </div>
                </CardContent>
              </Card>

              <Link
                href={withSearchParams("/isletmeler", { district })}
                className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 hover:text-zinc-900"
              >
                <ArrowLeft className="h-4 w-4" />
                İşletmelere dön
              </Link>
            </>
          );
        }}
      </QueryState>
    </PageContainer>
  );
}
