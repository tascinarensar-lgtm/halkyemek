"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Clock3, Coffee, Gift, Leaf, PackageOpen, QrCode, ShieldCheck, ShoppingBag, Sparkles, Store, UtensilsCrossed } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { SurpriseDealCheckoutButton } from "@/components/surprise-deals/surprise-deal-checkout-button";
import { SurpriseDealQuickView } from "@/components/surprise-deals/surprise-deal-quick-view";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { useSurpriseDeals } from "@/features/surprise-deals/hooks";
import type { SurpriseDealPublic } from "@/features/surprise-deals/types";
import { useSession } from "@/hooks/use-session";
import { openLoginDrawer } from "@/lib/auth/login-drawer";
import { describeApiError } from "@/lib/api/presentation";

const districtLabels: Record<string, string> = {
  BEYLIKDUZU: "İstanbul/Beylikdüzü",
};

const categoryTiles = [
  { label: "Fırın & Pastane", image: "/cuisines/firin-pastane-tedarik_1.jpg", icon: Leaf },
  { label: "Kafe & Kahve Zincirleri", image: "/cuisines/images.jfif", icon: Coffee },
  { label: "Marketler", image: "/cuisines/1758543987102446430.webp", icon: ShoppingBag },
  { label: "Fast Food Restoranları", image: "/cuisines/lysj-listing.webp", icon: Store },
  { label: "Döner-Kebap İşletmeleri", image: "/cuisines/1738662779653_1000x750.webp", icon: UtensilsCrossed },
];

const howItWorksSteps = [
  { title: "Fırsatı keşfet", icon: Sparkles },
  { title: "Paketini seç", icon: PackageOpen },
  { title: "QR oluştur", icon: QrCode },
  { title: "Teslim saatinde git", icon: Clock3 },
  { title: "Kasada okut", icon: ShieldCheck },
  { title: "İsrafı önle", icon: Leaf },
];

const valueBullets = [
  "İsraf edilecek gıdalar yeniden değerlendirilir",
  "Kullanıcılar daha uygun fiyatlı fırsatlar yakalar",
  "İşletmeler elde kalan ürünlerden gelir elde eder",
  "Daha sürdürülebilir bir yemek ekosistemi oluşur",
];

const storySections = [
  {
    title: "Günün sonunda iyi yemek boşa gitmesin",
    body: [
      "HalkTasarruf, kafe, fırın ve restoranlarda gün sonunda israf olabilecek ürünleri kullanıcılarla avantajlı fiyatlarla buluşturur.",
      "İşletmeler sınırlı sayıda paket yayınlar; kullanıcılar paketi seçer, QR kodunu oluşturur ve teslim saatinde kasada doğrulatır.",
    ],
    bullets: ["Fazla üretim değerlendirilir", "Kullanıcı uygun fiyat yakalar", "Teslim QR ile netleşir"],
  },
  {
    title: "Sürpriz paket, net akış",
    body: [
      "Paket içeriği işletmenin o günkü uygun ürünlerine göre değişebilir; kullanıcı tahmini değer, fiyat, kalan adet ve teslim saatini görür.",
      "QR kodu kasada okutulduğunda teslim tamamlanır ve akış HalkYemek cüzdan sistemiyle güvenli şekilde kapanır.",
    ],
    bullets: ["Kalan adet görünür", "Teslim saati bellidir", "Cüzdanla güvenli ödeme"],
  },
  {
    title: "İşletmeler için sürdürülebilir gelir",
    body: [
      "Elde kalabilecek ürünler kontrollü şekilde fırsata dönüşür. Böylece işletme hem kaybı azaltır hem de yeni müşterilerle temas eder.",
      "Paketler sınırlı stokla çalışır; stok bittiğinde fırsat otomatik olarak satın alınamaz hale gelir.",
    ],
    bullets: ["Sınırlı stok", "Kontrollü yayın", "Daha az fire"],
  },
  {
    title: "Daha bilinçli bir yemek ekosistemi",
    body: [
      "HalkTasarruf, yalnızca indirimli yiyecek alanı değil; iyi yemeğin değerini koruyan daha akıllı bir kullanım alışkanlığıdır.",
      "Amaç, hem kullanıcının bütçesini korumak hem de israfı azaltan sürdürülebilir bir sistem kurmaktır.",
    ],
    bullets: ["Bütçe dostu", "İsraf karşıtı", "Herkes için erişilebilir"],
  },
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

const EMPTY_SURPRISE_DEALS: SurpriseDealPublic[] = [];

function formatAmount(amount: number, currency = "TRY") {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatPickupWindow(deal: SurpriseDealPublic) {
  return `${formatTime(deal.pickup_window_start)} - ${formatTime(deal.pickup_window_end)}`;
}

function getRemainingLabel(deal: SurpriseDealPublic) {
  if (deal.is_sold_out || deal.quantity_remaining <= 0) return "Tükendi";
  if (deal.quantity_remaining <= 5) return "Az kaldı";
  return "Bugün teslim";
}

function getRemainingText(deal: SurpriseDealPublic) {
  if (deal.is_sold_out || deal.quantity_remaining <= 0) return "Tükendi";
  return `${deal.quantity_remaining} adet kaldı`;
}

function getHalkTasarrufHref(district: string, hash = "") {
  return `${withSearchParams("/halktasarruf", { district })}${hash}`;
}

function getHalkTasarrufBusinessHref(district: string, businessId: number, hash = "") {
  return `${withSearchParams(`/halktasarruf/isletmeler/${businessId}`, { district })}${hash}`;
}

function scrollToDealsSection(district: string) {
  const href = getHalkTasarrufHref(district, "#son-dakika-firsatlari");
  window.history.pushState(null, "", href);
  window.requestAnimationFrame(() => {
    document.getElementById("son-dakika-firsatlari")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });
}

function getDealImageAlt(deal: SurpriseDealPublic) {
  return `${deal.business.name} - ${deal.title}`;
}

type HalkTasarrufBusinessTile = {
  id: number;
  name: string;
  district: string;
  shortDescription: string;
  badgeText: string;
  imageUrl: string;
  activeDealCount: number;
  minSalePriceAmount: number;
  currency: string;
  totalRemaining: number;
};

function buildHalkTasarrufBusinesses(deals: SurpriseDealPublic[]) {
  const businesses = new Map<number, HalkTasarrufBusinessTile>();

  for (const deal of deals) {
    const current = businesses.get(deal.business.id);
    if (!current) {
      businesses.set(deal.business.id, {
        id: deal.business.id,
        name: deal.business.name,
        district: deal.business.district,
        shortDescription: deal.business.short_description,
        badgeText: deal.business.badge_text,
        imageUrl: deal.image_url,
        activeDealCount: 1,
        minSalePriceAmount: deal.sale_price_amount,
        currency: deal.currency,
        totalRemaining: Math.max(0, deal.quantity_remaining),
      });
      continue;
    }

    current.activeDealCount += 1;
    current.totalRemaining += Math.max(0, deal.quantity_remaining);
    if (!current.imageUrl && deal.image_url) current.imageUrl = deal.image_url;
    if (deal.sale_price_amount < current.minSalePriceAmount) {
      current.minSalePriceAmount = deal.sale_price_amount;
      current.currency = deal.currency;
    }
  }

  return Array.from(businesses.values()).sort((first, second) => {
    if (second.activeDealCount !== first.activeDealCount) return second.activeDealCount - first.activeDealCount;
    return first.name.localeCompare(second.name, "tr");
  });
}

function HalkTasarrufBusinessCard({ business, district }: { business: HalkTasarrufBusinessTile; district: string }) {
  const districtLabel = districtLabels[business.district] ?? business.district ?? districtLabels[district] ?? district;
  const remainingLabel = business.totalRemaining > 0 ? `${business.totalRemaining} adet kaldı` : "Fırsatlar tükenebilir";

  return (
    <Link href={getHalkTasarrufBusinessHref(district, business.id)} className="group block min-w-0">
      <article className="space-y-2">
        <div className="relative aspect-[16/9] overflow-hidden rounded-[8px] border border-zinc-100 bg-[#F5F3FF] shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_28px_rgba(76,29,149,0.14)]">
          {business.imageUrl ? (
            <Image
              src={business.imageUrl}
              alt={business.name}
              fill
              unoptimized
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover transition duration-300 group-hover:scale-[1.025]"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Store className="h-10 w-10 text-[#6D28D9]" />
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-[#5B21B6] shadow-sm">
            {business.activeDealCount} aktif fırsat
          </span>
          <span className="absolute bottom-2 right-2 rounded-full bg-zinc-950/90 px-3 py-1.5 text-xs font-semibold text-white">
            {formatAmount(business.minSalePriceAmount, business.currency)} başlayan
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 text-zinc-950">{business.name}</h3>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#6D28D9]">
              <Gift className="h-3.5 w-3.5" />
              {remainingLabel}
            </span>
          </div>
          <div className="space-y-0.5 text-[12px] leading-5 text-zinc-600">
            <p className="truncate">
              <span className="font-semibold text-zinc-700">Bölge:</span> {districtLabel}
            </p>
            <p className="truncate">
              <span className="font-semibold text-zinc-700">HalkTasarruf:</span> {business.shortDescription || business.badgeText || "Son dakika paketleri yayında"}
            </p>
          </div>
        </div>
      </article>
    </Link>
  );
}

function DealCard({
  deal,
  isAuthenticated,
  returnHref,
  onSelect,
}: {
  deal: SurpriseDealPublic;
  isAuthenticated: boolean;
  returnHref: string;
  onSelect: (deal: SurpriseDealPublic) => void;
}) {
  const districtLabel = districtLabels[deal.business.district] ?? deal.business.district;

  return (
    <article id={`firsat-${deal.id}`} className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(deal)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(deal);
          }
        }}
        className="group block min-w-0 cursor-pointer text-left outline-none ring-[#6D28D9]/15 transition focus-visible:ring-4"
      >
        <div className="relative aspect-[16/9] overflow-hidden rounded-[8px] border border-zinc-100 bg-zinc-100 shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_28px_rgba(76,29,149,0.14)]">
          {deal.image_url ? (
            <Image
              src={deal.image_url}
              alt={getDealImageAlt(deal)}
              fill
              unoptimized
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className="object-cover transition duration-300 group-hover:scale-[1.025]"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-[#F5F3FF] px-5 text-center">
              <PackageOpen className="h-10 w-10 text-[#6D28D9]" />
            </div>
          )}

          <span className="absolute left-2 top-2 rounded-full bg-[#6D28D9] px-2.5 py-1 text-[11px] font-semibold text-white shadow-sm">
            {getRemainingLabel(deal)}
          </span>
          <span className="absolute bottom-2 right-2 rounded-full bg-zinc-950/90 px-3 py-1.5 text-xs font-semibold text-white">
            {formatPickupWindow(deal)}
          </span>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 text-zinc-950">{deal.title}</h3>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#6D28D9]">
              <Sparkles className="h-3.5 w-3.5 fill-current" />
              {formatAmount(deal.sale_price_amount, deal.currency)}
            </span>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <span className="text-xs font-semibold text-[#E11D48] line-through decoration-2 decoration-[#E11D48]/70">
              {formatAmount(deal.original_value_amount, deal.currency)}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Tahmini değer</span>
          </div>

          <div className="space-y-0.5 text-[12px] leading-5 text-zinc-600">
            <p className="truncate">
              <span className="font-semibold text-zinc-700">İşletme:</span> {deal.business.name}
            </p>
            <p className="truncate">
              <span className="font-semibold text-zinc-700">Bölge:</span> {districtLabel}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {deal.grams ? (
              <span className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700">
                {deal.grams} gr
              </span>
            ) : null}
            <span className="inline-flex rounded-full bg-violet-100 px-2 py-1 text-[11px] font-semibold text-[#5B21B6]">
              {getRemainingText(deal)}
            </span>
          </div>
        </div>
      </div>

      <SurpriseDealCheckoutButton
        deal={deal}
        isAuthenticated={isAuthenticated}
        returnHref={returnHref}
        disabled={deal.is_sold_out || deal.quantity_remaining <= 0}
        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:bg-[#5B21B6] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
        authenticatedLabel={
          <>
            <ShoppingBag className="h-4 w-4" />
            {deal.is_sold_out ? "Tükendi" : "Sepete ekle"}
          </>
        }
        unauthenticatedLabel={
          <>
            <ShoppingBag className="h-4 w-4" />
            {deal.is_sold_out ? "Tükendi" : "Giriş yapıp sepete ekle"}
          </>
        }
      />
    </article>
  );
}
export default function HalkTasarrufPage() {
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const sessionQuery = useSession();
  const dealsQuery = useSurpriseDeals({ district });
  const deals = dealsQuery.data?.results ?? EMPTY_SURPRISE_DEALS;
  const halkTasarrufBusinesses = useMemo(() => buildHalkTasarrufBusinesses(deals), [deals]);
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const [selectedDeal, setSelectedDeal] = useState<SurpriseDealPublic | null>(null);

  const selectedBusinessHref = selectedDeal ? getHalkTasarrufBusinessHref(district, selectedDeal.business.id, `#firsat-${selectedDeal.id}`) : getHalkTasarrufHref(district);
  const selectedReturnHref = selectedDeal ? getHalkTasarrufHref(district, `#firsat-${selectedDeal.id}`) : getHalkTasarrufHref(district);

  return (
    <PageContainer className="space-y-8 bg-white sm:space-y-10">
      <div className="flex justify-start">
        <Link
          href="/"
          aria-label="HalkYemek ana sayfasına dön"
          className="group inline-flex h-14 items-center gap-3 rounded-[22px] border border-zinc-200/80 bg-white px-4 shadow-[0_14px_34px_rgba(17,24,39,0.08)] ring-1 ring-white/80 transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-[0_18px_38px_rgba(76,29,149,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]/35"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F3FF] text-[#6D28D9] transition duration-200 group-hover:bg-[#EDE9FE]">
            <ArrowRight className="h-4 w-4 rotate-180" />
          </span>
          <Image src="/logo-halkyemek.png" alt="HalkYemek" width={1100} height={254} className="h-8 w-auto object-contain" priority />
        </Link>
      </div>

      <section className="relative min-h-[350px] overflow-hidden rounded-[24px] bg-[#6D28D9] p-6 text-white shadow-[0_22px_60px_rgba(109,40,217,0.2)] sm:min-h-0 sm:rounded-[28px] sm:p-5 lg:p-6">
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[74%] overflow-hidden sm:w-[52%]">
          <div className="absolute -right-20 top-[62%] h-[420px] w-[420px] -translate-y-1/2 rounded-full bg-white/10 sm:-right-12 sm:top-1/2" />
          <div className="absolute -right-2 top-[68%] h-[315px] w-[315px] -translate-y-1/2 rounded-full bg-white/12 sm:right-12 sm:top-1/2 sm:h-[300px] sm:w-[300px]" />
          <div className="absolute right-7 top-[76%] h-[210px] w-[210px] -translate-y-1/2 rounded-full bg-white/14 sm:right-20 sm:top-1/2 sm:h-[190px] sm:w-[190px]" />
          <div className="absolute bottom-2 right-3 flex h-[84px] w-[132px] rotate-[10deg] items-center justify-center rounded-[24px] bg-[#7C3AED] shadow-[0_20px_46px_rgba(40,12,95,0.24)] sm:right-10 sm:top-1/2 sm:h-[96px] sm:w-[148px] sm:-translate-y-1/2">
            <UtensilsCrossed className="h-12 w-12 text-white sm:h-14 sm:w-14" />
          </div>
        </div>

        <div className="relative z-10 mb-6 max-w-[285px] text-white sm:max-w-xl">
          <h2 className="text-[31px] font-semibold leading-tight tracking-[-0.04em] sm:text-3xl">HalkTasarruf nasıl çalışır?</h2>
          <p className="mt-3 text-[22px] font-semibold leading-tight sm:text-2xl">
            Kafe, fırın ve restoranlardaki israf edilecek gıdaları yeniden kazan. Son dakika fırsatlarını indirimli yakala.
          </p>
          {!isAuthenticated ? (
            <button
              type="button"
              onClick={() => openLoginDrawer("/halktasarruf")}
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#4C1D95] shadow-[0_14px_30px_rgba(40,12,95,0.18)] transition hover:bg-[#F5F3FF]"
            >
              <Sparkles className="h-4 w-4" />
              Hemen giriş yap
            </button>
          ) : null}
        </div>

        <div className="relative z-10 grid max-w-[250px] gap-2.5 sm:max-w-md">
          {howItWorksSteps.map((step, index) => {
            const Icon = step.icon;
            return (
              <button
                key={step.title}
                type="button"
                className="inline-flex min-h-[42px] items-center gap-2 rounded-full bg-white px-3.5 py-2 text-left text-sm font-semibold text-zinc-950 shadow-[0_12px_28px_rgba(40,12,95,0.14)]"
              >
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 text-[#6D28D9]">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#6D28D9] text-xs font-bold text-white">{index + 1}</span>
                <span>{step.title}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section id="firsat-kategorileri" className="scroll-mt-32 space-y-5">
        <div className="flex items-center justify-start">
          <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700 sm:text-[31px]">Fırsat kategorileri</h2>
        </div>

        <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6 sm:gap-x-5">
          {categoryTiles.map((tile) => {
            const Icon = tile.icon;
            return (
              <Link
                key={tile.label}
                href={getHalkTasarrufHref(district, "#son-dakika-firsatlari")}
                onClick={(event) => {
                  event.preventDefault();
                  scrollToDealsSection(district);
                }}
                className="group text-center"
              >
                <div className="relative mx-auto aspect-square w-full max-w-[96px] overflow-hidden rounded-[14px] bg-[#F5F3FF] shadow-[0_10px_24px_rgba(76,29,149,0.10)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_34px_rgba(76,29,149,0.16)]">
                  <Image src={tile.image} alt={tile.label} fill unoptimized sizes="96px" className="object-cover" />
                  <span className="absolute bottom-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/92 text-[#6D28D9] shadow-sm">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <div className="mt-3 text-sm font-semibold leading-5 text-[#6D28D9]">{tile.label}</div>
              </Link>
            );
          })}
        </div>
      </section>

      <section id="halktasarruf-isletmeleri" className="scroll-mt-32 space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700 sm:text-[31px]">Bütün işletmeler</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              HalkTasarruf&apos;ta aktif ilan yayınlayan kafe, fırın, market ve restoranları burada görebilirsin.
            </p>
          </div>
          <Link
            href={getHalkTasarrufHref(district, "#son-dakika-firsatlari")}
            className="hidden items-center gap-2 text-sm font-semibold text-[#6D28D9] transition hover:text-[#4C1D95] sm:inline-flex"
          >
            Fırsatlara in
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {dealsQuery.isPending ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <LoadingSkeleton key={index} lines={4} />
            ))}
          </div>
        ) : dealsQuery.isError ? (
          <ErrorState
            title="İşletmeler yüklenemedi"
            description={describeApiError(dealsQuery.error, "HalkTasarruf işletmeleri şu anda getirilemedi. Lütfen kısa süre sonra tekrar dene.")}
          />
        ) : halkTasarrufBusinesses.length ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {halkTasarrufBusinesses.map((business) => (
              <HalkTasarrufBusinessCard key={business.id} business={business} district={district} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Henüz ilan veren işletme yok"
            description="Bu bölgede HalkTasarruf ilanı yayınlayan işletme olduğunda burada listelenecek."
            action={
              <Link
                href={getHalkTasarrufHref(district, "#son-dakika-firsatlari")}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#5B21B6]"
              >
                Fırsatları kontrol et
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          />
        )}
      </section>

      <section id="son-dakika-firsatlari" className="scroll-mt-32 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700 sm:text-[31px]">Son dakika fırsatları</h2>
          <Link href={getHalkTasarrufHref(district, "#son-dakika-firsatlari")} className="hidden items-center gap-2 text-sm font-semibold text-[#6D28D9] transition hover:text-[#4C1D95] sm:inline-flex">
            Tümünü gör
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {dealsQuery.isPending ? (
          <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <LoadingSkeleton key={index} lines={5} />
            ))}
          </div>
        ) : dealsQuery.isError ? (
          <ErrorState
            title="Fırsatlar yüklenemedi"
            description={describeApiError(dealsQuery.error, "Son dakika fırsatları şu anda getirilemedi. Lütfen kısa süre sonra tekrar dene.")}
          />
        ) : deals.length ? (
          <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {deals.slice(0, 6).map((deal) => (
              <DealCard key={deal.id} deal={deal} isAuthenticated={isAuthenticated} returnHref={getHalkTasarrufHref(district, `#firsat-${deal.id}`)} onSelect={setSelectedDeal} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Şu an aktif fırsat yok"
            description="Bu bölgede yayınlanmış Son Dakika Fırsatı bulunmuyor. İşletmeler yeni paket eklediğinde burada görünecek."
            action={
              <Link
                href={getHalkTasarrufHref(district, "#son-dakika-firsatlari")}
                className="inline-flex items-center gap-2 rounded-2xl bg-[#6D28D9] px-4 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#5B21B6]"
              >
                Fırsatları kontrol et
                <ArrowRight className="h-4 w-4" />
              </Link>
            }
          />
        )}
      </section>

      <section className="overflow-hidden rounded-[32px] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfb_100%)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="relative p-5 sm:p-7 lg:p-8">
          <div className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full bg-[#6D28D9]/12 blur-3xl" />
          <div className="pointer-events-none absolute bottom-10 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-zinc-950/[0.04] blur-3xl" />

          <div className="relative grid gap-7 lg:grid-cols-[1.18fr_0.82fr] lg:items-stretch">
            <div className="space-y-5">
              <div className="inline-flex rounded-2xl bg-white px-4 py-2 shadow-[0_10px_30px_rgba(15,23,42,0.07)]">
                <Image src="/halktasarruf-logo.png" alt="HalkTasarruf" width={900} height={190} className="h-11 w-auto object-contain" />
              </div>

              <h2 className="max-w-3xl text-3xl font-semibold tracking-[-0.04em] text-zinc-950 sm:text-4xl">
                İsrafı Azaltan, Daha Akıllı Yemek Sistemi
              </h2>
              <p className="max-w-4xl text-[15px] leading-7 text-zinc-700">
                HalkTasarruf, kafe, fırın ve restoranlarda gün sonunda israf olabilecek ürünleri kullanıcılarla avantajlı fiyatlarla buluşturur.
              </p>

              <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {valueBullets.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm font-medium leading-6 text-zinc-800">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#6D28D9]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex min-h-[260px] flex-col justify-between overflow-hidden rounded-[26px] bg-zinc-950 p-6 text-white shadow-[0_18px_46px_rgba(15,23,42,0.22)]">
              <div>
                <div className="inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  HALKTASARRUF MANİFESTOSU
                </div>
                <p className="mt-6 text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
                  İsrafı azaltıyor, iyi yemeği daha ulaşılabilir hale getiriyoruz.
                </p>
              </div>
              <div className="mt-8 h-1.5 w-24 rounded-full bg-[#7C3AED]" />
            </div>
          </div>

          <div className="relative mt-9 rounded-[28px] bg-white/70 p-1 sm:p-2">
            <div className="grid gap-x-9 gap-y-8 p-4 sm:p-5 md:grid-cols-2">
              {storySections.map((section) => (
                <article key={section.title} className="relative pl-4 transition duration-200 hover:translate-x-1">
                  <span className="absolute left-0 top-1 h-10 w-1 rounded-full bg-[#6D28D9]" />
                  <h3 className="text-xl font-semibold tracking-[-0.03em] text-zinc-950">{section.title}</h3>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700">
                    {section.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {section.bullets.map((item) => (
                      <span key={item} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-[#6D28D9]">
                        {item}
                      </span>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-zinc-950 p-5 text-white sm:p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Image src="/halktasarruf-logo.png" alt="HalkTasarruf" width={900} height={190} className="h-10 w-auto rounded-xl bg-white object-contain px-3 py-1.5" />
              <p className="mt-3 max-w-md text-sm leading-6 text-zinc-300">
                İsrafı azaltan, fırsat yiyecekleri daha ulaşılabilir hale getiren HalkTasarruf.
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

      {selectedDeal ? (
        <SurpriseDealQuickView
          businessHref={selectedBusinessHref}
          deal={selectedDeal}
          isAuthenticated={isAuthenticated}
          onClose={() => setSelectedDeal(null)}
          returnHref={selectedReturnHref}
        />
      ) : null}
    </PageContainer>
  );
}






