"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Info, LogIn, QrCode, RefreshCw, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Star, UtensilsCrossed, Wallet, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { PendingButton } from "@/components/ui/pending-button";
import { addCartItem } from "@/features/cart/api";
import { getCategoryDisplayName } from "@/features/discovery/category-copy";
import { useDiscoveryHome } from "@/features/discovery/hooks";
import { getMenuItemDisplayDescription } from "@/features/discovery/menu-copy";
import { resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { getBusinessMenuQuotaDisplayText, getBusinessMenuQuotaDisplayTone, getMenuQuotaDisplayText, getMenuQuotaDisplayTone } from "@/features/discovery/quota-copy";
import type { DiscoveryHomeMenuItem } from "@/features/discovery/types";
import { useSession } from "@/hooks/use-session";
import { ApiClientError, getApiErrorMessage } from "@/lib/api/errors";
import { openLoginDrawer } from "@/lib/auth/login-drawer";
import { describeApiError } from "@/lib/api/presentation";
import { getIstanbulGreeting } from "@/lib/utils/greeting";
import { repairPotentialMojibake } from "@/lib/utils/text";

function formatMenuPrice(priceAmount: number) {
  const wholeLira = Math.round(priceAmount / 100);
  return `${wholeLira.toLocaleString("tr-TR")} TL`;
}

function getQuotaBadgeClass(item: DiscoveryHomeMenuItem | null | undefined) {
  if (!item) return "bg-white/95 text-zinc-900 ring-1 ring-zinc-200";
  const tone = getMenuQuotaDisplayTone(item);
  if (tone === "sold_out") {
    return "bg-zinc-950 text-white ring-1 ring-white/20";
  }
  if (tone === "low") {
    return "bg-[#f50555] text-white";
  }
  return "bg-white/95 text-zinc-900 ring-1 ring-zinc-200";
}

function getBusinessQuotaBadgeClass(tone: ReturnType<typeof getBusinessMenuQuotaDisplayTone>) {
  if (tone === "sold_out") return "bg-zinc-950/90 text-white";
  return "bg-white/95 text-zinc-900";
}

type StorySection = {
  title: string;
  body: string[];
  bullets?: string[];
};

const valueBullets = [
  "Belirli ürünlerde özel kampanyalar",
  "Sınırlı stok fırsatları",
  "Daha düşük platform maliyetleri",
  "Daha ulaşılabilir yemek seçenekleri",
];

const storySections: StorySection[] = [
  {
    title: "HalkYemek ile yemek artık daha uygun",
    body: [
      "Dışarıda yemek yemek her geçen gün daha pahalı hale geliyor. HalkYemek, bu soruna çözüm üretmek için kuruldu. Amacımız, anlaşmalı işletmelerle birlikte çalışarak gereksiz maliyetleri azaltmak ve insanlara daha uygun fiyatlı yemek erişimi sunmak.",
      "Bulunduğun bölgedeki anlaşmalı işletmeleri keşfedebilir, bütçene uygun menüleri inceleyebilir ve siparişini saniyeler içinde oluşturabilirsin.",
    ],
  },
  {
    title: "QR ile hızlı ve pratik teslim alma",
    body: [
      "HalkYemek’te klasik yemek sipariş platformlarından farklı olarak siparişin doğrudan işletmede tamamlanır.",
      "Siparişini oluşturduktan sonra sana özel QR kodun hazırlanır. İşletmeye gittiğinde QR kodunu kasada okutarak siparişini hızlıca teslim alabilirsin.",
    ],
    bullets: ["Kurye maliyetlerini ortadan kaldırır", "Bekleme sürelerini azaltır", "Daha düşük fiyat sunulmasını sağlar"],
  },
  {
    title: "Dijital cüzdan ile kolay ödeme",
    body: ["HalkYemek dijital cüzdan altyapısıyla hızlı ödeme deneyimi sunar. Tekrar tekrar kart bilgisi girmene gerek kalmaz."],
    bullets: ["Bakiyeni yükle", "Siparişini oluştur", "QR kodunu göster", "Yemeğini teslim al"],
  },
  {
    title: "Herkes için daha erişilebilir yemek",
    body: [
      "HalkYemek’in vizyonu basit: kaliteli yemeğin yalnızca belirli bir kesime değil, herkese ulaşabilir olması.",
      "HalkYemek, yüksek fiyatların normalleştiği düzene alternatif oluşturmayı hedefler.",
    ],
    bullets: ["Öğrenciler", "Çalışanlar", "Aileler", "Yoğun tempoda yaşayan herkes"],
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

const halkYemekHomeCategories = [
  { slug: "burger", label: "Burger", image: "/cuisines/lysj-listing.webp" },
  { slug: "pizza", label: "Pizza", image: "/cuisines/lu8a-hero.webp" },
  { slug: "doner", label: "Döner", image: "/cuisines/i.webp" },
  { slug: "kebap", label: "Kebap", image: "/cuisines/1738662779653_1000x750.webp" },
] as const;

export default function HomePage() {
  const searchParams = useSearchParams();
  const district = resolveDistrict(searchParams.get("district"));
  const queryClient = useQueryClient();
  const [selectedMenuItem, setSelectedMenuItem] = useState<DiscoveryHomeMenuItem | null>(null);
  const [greeting, setGreeting] = useState(() => getIstanbulGreeting());
  const sessionQuery = useSession();
  const isAuthenticated = sessionQuery.data?.isAuthenticated ?? false;
  const sessionUserId = sessionQuery.data?.user?.id ?? null;
  const homeQuery = useDiscoveryHome(district, isAuthenticated, !sessionQuery.isPending, sessionUserId);
  const homeData = homeQuery.data;
  const displayName =
    repairPotentialMojibake(sessionQuery.data?.user?.username || sessionQuery.data?.user?.google_email?.split("@")[0] || "") ||
    "HalkYemek kullanıcısı";
  const restaurantTiles = homeData
    ? Array.from(new Map([...homeData.featured_businesses, ...homeData.other_businesses].map((business) => [business.id, business])).values())
        .slice(0, 10)
    : [];

  const cuisineImageOverrides: Record<string, string> = Object.fromEntries(
    halkYemekHomeCategories.map((category) => [category.label, category.image]),
  );
  const menuTiles = homeData?.menu_items ?? [];

  const cuisineTiles = halkYemekHomeCategories.map((category) => ({
    key: category.slug,
    label: category.label,
    href: withSearchParams(`/kategoriler/${category.slug}`, { district }),
    image: category.image,
  }));

  const howItWorksSteps = [
    {
      title: "Giriş yap",
      description: "Hesabına girerek sepet, cüzdan ve QR akışını tek adımda aç.",
      icon: LogIn,
    },
    {
      title: "Bakiye yükle",
      description: "Bakiyeni önceden yükle ya da ödeme sırasında anında tamamla.",
      icon: Wallet,
    },
    {
      title: "Menünü seç",
      description: "Anlaşmalı işletmeler arasından bütçene uygun menünü belirle.",
      icon: UtensilsCrossed,
    },
    {
      title: "QR oluştur",
      description: "Ödeme sonrası kullanım QR kodun birkaç saniyede hazır olur.",
      icon: QrCode,
    },
    {
      title: "Kasada okut",
      description: "QR kodunu kasada okutarak siparişini anında doğrula.",
      icon: ShieldCheck,
    },
    {
      title: "Tadını çıkar",
      description: "Uygun fiyatlı yemeğini teslim al ve afiyetle keyfini çıkar.",
      icon: UtensilsCrossed,
    },
  ];
  const walletBalanceText = homeData?.wallet_summary ? formatMenuPrice(homeData.wallet_summary.balance) : "Hazırlanıyor";
  const activeCart = homeData?.active_cart_summary ?? null;
  const selectedItemName = selectedMenuItem ? repairPotentialMojibake(selectedMenuItem.name) : "";
  const selectedItemBusinessName = selectedMenuItem ? repairPotentialMojibake(selectedMenuItem.business_name) : "";
  const selectedItemDescription = selectedMenuItem ? getMenuItemDisplayDescription(selectedMenuItem) : "";
  const selectedItemCategoryName = selectedMenuItem
    ? repairPotentialMojibake(selectedMenuItem.marketplace_category_name || selectedMenuItem.category_name)
    : "";
  const selectedItemImage = selectedMenuItem
    ? selectedMenuItem.image || selectedMenuItem.image_url || cuisineImageOverrides[selectedItemCategoryName] || cuisineImageOverrides.Burger
    : "";
  const selectedQuotaLabel = getMenuQuotaDisplayText(selectedMenuItem);
  const selectedCanAddToCart = Boolean(selectedMenuItem?.can_add_to_cart && selectedMenuItem?.is_available);
  const selectedQuotaBadgeClass = getQuotaBadgeClass(selectedMenuItem);
  const selectedBusinessHref = selectedMenuItem ? withSearchParams(`/isletmeler/${selectedMenuItem.business_id}`, { district }) : "/";
  const addHomeMenuItemMutation = useMutation({
    mutationFn: (menuItemId: number) => addCartItem({ menu_item_id: menuItemId, quantity: 1 }),
    onSuccess: async (nextCart) => {
      queryClient.setQueryData(["cart", "detail"], nextCart);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
      ]);
      toast.success("Sepete eklendi.", { description: selectedItemName || "Ürün" });
    },
    onError: (error) => {
      if (error instanceof ApiClientError && error.envelope?.error?.code === "NOTIFICATION_NOT_READY") {
        toast.error("Bildirim izni gerekiyor.", { description: "Sepete devam etmek için bildirim ayarını tamamlayın." });
        return;
      }
      toast.error(getApiErrorMessage(error, "Ürün sepete eklenemedi."));
    },
  });

  useEffect(() => {
    const updateGreeting = () => setGreeting(getIstanbulGreeting());

    updateGreeting();
    const intervalId = window.setInterval(updateGreeting, 60_000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!selectedMenuItem) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedMenuItem(null);
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedMenuItem]);

  const cravingChips = halkYemekHomeCategories.map((category) => ({
    label: category.label,
    href: withSearchParams(`/kategoriler/${category.slug}`, { district }),
  }));

  function handleAddSelectedMenuItem() {
    if (!selectedMenuItem) return;
    if (!selectedMenuItem.can_add_to_cart || !selectedMenuItem.is_available) return;
    addHomeMenuItemMutation.mutate(selectedMenuItem.id);
  }

  return (
    <PageContainer className="space-y-8 bg-white sm:space-y-10">
      {isAuthenticated ? (
        <section className="relative min-h-[390px] overflow-hidden rounded-[24px] bg-[#f50555] px-6 pb-6 pt-8 text-white shadow-[0_22px_60px_rgba(244,5,85,0.22)] sm:min-h-0 sm:rounded-[28px] sm:px-8 sm:py-8 lg:px-10">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[92%] overflow-hidden sm:w-[52%] md:w-[42%]">
            <div className="absolute -right-32 top-[64%] h-[440px] w-[440px] -translate-y-1/2 rounded-full bg-white/10 sm:-right-12 sm:top-1/2 sm:h-[420px] sm:w-[420px]" />
            <div className="absolute -right-11 top-[70%] h-[320px] w-[320px] -translate-y-1/2 rounded-full bg-white/12 sm:right-12 sm:top-1/2 sm:h-[300px] sm:w-[300px]" />
            <div className="absolute right-5 top-[76%] h-[210px] w-[210px] -translate-y-1/2 rounded-full bg-white/14 sm:right-20 sm:top-1/2 sm:h-[190px] sm:w-[190px]" />
            <div className="absolute bottom-0 right-5 flex h-[94px] w-[148px] rotate-[10deg] items-center justify-center rounded-[26px] bg-[#ff2f76] text-5xl shadow-[0_20px_46px_rgba(120,0,44,0.22)] sm:right-10 sm:top-1/2 sm:h-[96px] sm:w-[148px] sm:-translate-y-1/2">
              <UtensilsCrossed className="h-11 w-11 text-white sm:h-14 sm:w-14" />
            </div>
          </div>

          <div className="relative z-10 max-w-[285px] sm:max-w-3xl">
            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.04em] sm:text-4xl">
              {greeting} {displayName}
            </h1>
            <div className="mt-2 flex max-w-[260px] items-start gap-2 text-[23px] font-medium leading-tight sm:max-w-none sm:items-center sm:text-2xl">
              <span>Bugün HalkYemek’te canınız ne çekiyor?</span>
              <Info className="h-5 w-5" />
            </div>

            <div className="mt-6 flex max-w-[250px] flex-wrap gap-2.5 sm:max-w-none">
              <Link
                href="#mutfaklar"
                className="inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-sm font-semibold text-zinc-700 shadow-[0_10px_22px_rgba(120,0,44,0.12)] transition hover:-translate-y-0.5 hover:bg-rose-50 hover:text-[#f50555]"
                aria-label="Mutfakları göster"
              >
                <RefreshCw className="h-4 w-4" />
              </Link>
              {cravingChips.map((chip) => (
                <Link
                  key={chip.label}
                  href={chip.href}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-semibold text-zinc-700 shadow-[0_10px_22px_rgba(120,0,44,0.12)] transition hover:-translate-y-0.5 hover:bg-rose-50 hover:text-[#f50555]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#f50555]" />
                  {chip.label}
                </Link>
              ))}
            </div>

            <div className="mt-5 grid max-w-[315px] grid-cols-2 gap-2.5 sm:max-w-3xl sm:grid-cols-3">
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
                href={activeCart ? "/sepet" : "#mutfaklar"}
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

              <Link
                href="/qrlarim"
                className="group rounded-[18px] bg-white/95 p-3 text-zinc-950 shadow-[0_14px_30px_rgba(120,0,44,0.14)] transition hover:-translate-y-0.5 hover:bg-white sm:rounded-2xl sm:p-4"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-[#f50555] sm:h-10 sm:w-10">
                    <QrCode className="h-4 w-4 sm:h-5 sm:w-5" />
                  </span>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 sm:text-xs sm:tracking-[0.14em]">QRlarım</div>
                    <div className="mt-0.5 text-sm font-semibold leading-tight text-zinc-950 sm:text-lg">Aktif kodlar</div>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        </section>
      ) : (
        <section>
          <div className="relative min-h-[350px] overflow-hidden rounded-[24px] bg-[#f50555] p-6 shadow-[0_22px_60px_rgba(244,5,85,0.2)] sm:min-h-0 sm:rounded-[28px] sm:p-5 lg:p-6">
            <div className="pointer-events-none absolute inset-y-0 right-0 w-[74%] overflow-hidden sm:w-[52%]">
              <div className="absolute -right-20 top-[62%] h-[420px] w-[420px] -translate-y-1/2 rounded-full bg-white/10 sm:-right-12 sm:top-1/2" />
              <div className="absolute -right-2 top-[68%] h-[315px] w-[315px] -translate-y-1/2 rounded-full bg-white/12 sm:right-12 sm:top-1/2 sm:h-[300px] sm:w-[300px]" />
              <div className="absolute right-7 top-[76%] h-[210px] w-[210px] -translate-y-1/2 rounded-full bg-white/14 sm:right-20 sm:top-1/2 sm:h-[190px] sm:w-[190px]" />
              <div className="absolute bottom-2 right-3 flex h-[84px] w-[132px] rotate-[10deg] items-center justify-center rounded-[24px] bg-[#ff2f76] shadow-[0_20px_46px_rgba(120,0,44,0.22)] sm:right-10 sm:top-1/2 sm:h-[96px] sm:w-[148px] sm:-translate-y-1/2">
                <UtensilsCrossed className="h-12 w-12 text-white sm:h-14 sm:w-14" />
              </div>
            </div>

            <div className="relative z-10 mb-6 max-w-[270px] text-white sm:max-w-xl">
              <h1 className="text-[31px] font-semibold leading-tight tracking-[-0.04em] sm:text-3xl">HalkYemek nasıl çalışır?</h1>
              <p className="mt-2 text-[22px] font-medium leading-tight text-white/95 sm:text-base sm:leading-6">
                Bulunduğun bölgede en ucuz ve en imkanlı yemeği HalkYemek ile yiyeceksin.
              </p>
              <button
                type="button"
                onClick={() => openLoginDrawer("/")}
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#f50555] shadow-[0_14px_30px_rgba(120,0,44,0.16)] transition hover:bg-rose-50"
              >
                <LogIn className="h-4 w-4" />
                Hemen giriş yap
              </button>
            </div>

            <div className="relative z-10 flex max-w-[235px] flex-wrap gap-2.5 sm:grid sm:max-w-[720px] sm:grid-cols-3 sm:gap-3 lg:max-w-none lg:grid-cols-6">
              {howItWorksSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <div
                    key={step.title}
                    className="group relative inline-flex overflow-hidden rounded-full bg-white shadow-[0_12px_26px_rgba(120,0,44,0.14)] transition duration-200 hover:-translate-y-0.5 hover:bg-rose-50 hover:shadow-[0_18px_38px_rgba(120,0,44,0.18)] sm:flex sm:h-full sm:flex-col sm:rounded-[16px] lg:rounded-[18px]"
                  >
                    <div className="relative flex h-full items-center gap-1.5 px-3 py-2 text-left sm:flex-col sm:gap-0 sm:p-3 sm:text-center lg:p-3.5">
                      <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-50 text-[#f50555] sm:h-9 sm:w-9 sm:rounded-[12px] lg:h-10 lg:w-10 lg:rounded-[14px]">
                        <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 lg:h-[18px] lg:w-[18px]" />
                      </span>

                      <div className="relative flex flex-1 items-center gap-1.5 sm:mt-2.5 sm:flex-col sm:gap-0">
                        <div className="hidden rounded-full bg-[#f50555] px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_8px_18px_rgba(255,31,99,0.22)] sm:inline-flex sm:px-2.5 sm:text-[10px]">
                          Adım {index + 1}
                        </div>
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#f50555] px-1.5 text-[10px] font-bold text-white shadow-[0_8px_18px_rgba(255,31,99,0.18)] sm:hidden">
                          {index + 1}
                        </span>
                        <h3 className="text-sm font-semibold leading-none text-zinc-700 sm:mt-2 sm:text-[13px] sm:leading-[1.15rem] sm:text-zinc-950 lg:text-[15px] lg:leading-6">
                          {step.title}
                        </h3>
                        <p className="mt-2 hidden text-[13px] leading-5 text-zinc-600 xl:block">{step.description}</p>
                      </div>

                      <div className="relative mt-2.5 hidden w-full sm:block lg:mt-4">
                        <div className="mx-auto h-1 w-full max-w-[72px] rounded-full bg-rose-100">
                          <div className="h-full rounded-full bg-[#ff1f63]" style={{ width: `${Math.min(100, 24 + index * 14)}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="relative">
        <Link
          href="/halktasarruf"
          className="group relative flex min-h-[172px] w-full overflow-hidden rounded-3xl bg-[linear-gradient(135deg,#2e1065_0%,#5B21B6_46%,#7C3AED_100%)] p-5 text-white shadow-xl shadow-violet-950/18 ring-1 ring-white/10 transition duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_30px_74px_rgba(91,33,182,0.30)] sm:p-7 lg:p-8"
        >
          <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(255,255,255,0.16),transparent_28%),radial-gradient(circle_at_86%_18%,rgba(196,181,253,0.18),transparent_36%)]" />
          <span className="pointer-events-none absolute inset-x-7 top-0 h-px bg-white/26" />
          <span className="pointer-events-none absolute -bottom-28 right-6 h-56 w-56 rounded-full bg-white/9 blur-2xl" />
          <span className="pointer-events-none absolute -right-16 top-8 h-36 w-36 rounded-full border border-white/10" />

          <span className="relative z-10 flex w-full flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <span className="flex min-w-0 flex-col gap-5 lg:max-w-[760px]">
              <span className="inline-flex w-full max-w-[520px] rounded-[24px] border border-white/18 bg-white px-4 py-3 shadow-[0_20px_52px_rgba(31,12,78,0.22)] ring-1 ring-white/30 sm:px-5 sm:py-4">
                <Image
                  src="/halktasarruf-logo.png"
                  alt="HalkTasarruf"
                  width={2063}
                  height={419}
                  className="h-auto w-full object-contain"
                  priority={false}
                />
              </span>

              <span className="block max-w-2xl text-[18px] font-semibold leading-7 text-white/88 sm:text-xl sm:leading-8">
                <span className="font-black text-white">Kafe, fırın ve restoranlardaki</span> israf edilecek gıdaları yeniden kazan.
                <br />
                Son dakika fırsatlarını indirimli yakala.
              </span>
            </span>

            <span className="relative z-10 inline-flex items-center justify-between gap-3 self-start rounded-2xl border border-white/16 bg-white px-5 py-3 text-sm font-black text-[#4c1d95] shadow-[0_16px_36px_rgba(31,12,78,0.20)] transition duration-300 group-hover:bg-violet-50 group-hover:shadow-[0_20px_44px_rgba(31,12,78,0.26)] lg:self-end">
              Hemen Şimdi Başla
              <ArrowRight className="h-4 w-4 transition duration-300 group-hover:translate-x-0.5" />
            </span>
          </span>
        </Link>
      </section>

      {sessionQuery.isPending || homeQuery.isPending ? (
        <section id="mutfaklar" className="scroll-mt-32 space-y-5">
          <div className="h-10 w-40 animate-pulse rounded-2xl bg-zinc-100" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: halkYemekHomeCategories.length }).map((_, index) => (
              <div key={index} className="shrink-0 space-y-3">
                <div className="h-[96px] w-[96px] animate-pulse rounded-[18px] bg-zinc-100 sm:h-[108px] sm:w-[108px]" />
                <div className="mx-auto h-4 w-20 animate-pulse rounded-full bg-zinc-100" />
              </div>
            ))}
          </div>
        </section>
      ) : homeQuery.isError ? (
        <ErrorState
          title="Mutfaklar yüklenemedi"
          description={describeApiError(homeQuery.error, "Kategori şeridi şu anda getirilemedi. Lütfen bağlantıyı tekrar kontrol et.")}
        />
      ) : homeData ? (
        <section id="mutfaklar" className="scroll-mt-32 space-y-5">
          <div className="flex items-center justify-start">
            <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700 sm:text-[31px]">
              Mutfaklar
            </h2>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:justify-center md:gap-x-7 md:gap-y-4 md:overflow-visible md:pb-0 lg:mx-auto lg:max-w-[980px] lg:justify-between">
            {cuisineTiles.map((tile) => (
              <Link key={tile.key} href={tile.href} className="group block w-[96px] shrink-0 sm:w-[108px] lg:w-[124px]">
                <div className="relative overflow-hidden rounded-[18px] border border-zinc-100 bg-zinc-50 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_16px_30px_rgba(15,23,42,0.12)]">
                  <div className="relative aspect-square">
                    {tile.image ? (
                      <Image
                        src={tile.image}
                        alt={tile.label}
                        fill
                        unoptimized
                        sizes="(max-width: 640px) 92px, (max-width: 1024px) 108px, 116px"
                        className="object-cover transition duration-300 group-hover:scale-[1.03]"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center bg-[linear-gradient(135deg,_rgba(255,31,99,0.14),_rgba(255,255,255,0.96))] px-4 text-center text-xs font-medium text-zinc-600">
                        HalkYemek
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-3 min-h-[3rem] text-center text-sm font-medium leading-6 text-[#ff1f63] sm:text-[15px]">
                  {tile.label}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {homeData && restaurantTiles.length > 0 ? (
        <section id="restoranlar" className="scroll-mt-32 space-y-5">
          <div className="flex items-center justify-start">
            <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700 sm:text-[31px]">
              Restoranlar
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:flex sm:gap-4 sm:overflow-x-auto sm:pb-2 sm:[-ms-overflow-style:none] sm:[scrollbar-width:none] sm:[&::-webkit-scrollbar]:hidden">
            {restaurantTiles.map((business) => {
              const businessName = repairPotentialMojibake(business.business_name);
              const category = business.primary_marketplace_category;
              const categoryName =
                business.listing_type === "VOLUNTEER"
                ? "Kategori yok"
                : category
                  ? getCategoryDisplayName(category.slug, category.name)
                    : "Kategori yok";
              const businessHref = withSearchParams(`/isletmeler/${business.id}`, { district });
              const businessQuotaLabel = getBusinessMenuQuotaDisplayText(business);
              const businessQuotaBadgeClass = getBusinessQuotaBadgeClass(getBusinessMenuQuotaDisplayTone(business));

              return (
                <Link key={business.id} href={businessHref} className="group block min-w-0 sm:w-[270px] sm:shrink-0 lg:w-[286px]">
                  <article className="space-y-2">
                    <div className="relative aspect-[16/9] overflow-hidden rounded-[8px] border border-zinc-100 bg-zinc-100 shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_28px_rgba(15,23,42,0.12)]">
                      {business.cover_image ? (
                        <Image
                          src={business.cover_image}
                          alt={businessName}
                          fill
                          unoptimized
                          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 270px, 286px"
                          className="object-cover transition duration-300 group-hover:scale-[1.025]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-zinc-100 px-5 text-center text-sm font-medium text-zinc-500">
                          HalkYemek
                        </div>
                      )}

                      {business.is_featured ? (
                        <span className="absolute bottom-2 right-2 rounded-full bg-zinc-950/90 px-2 py-1 text-[10px] font-semibold text-white">
                          Öne Çıkan
                        </span>
                      ) : null}
                      {businessQuotaLabel ? (
                        <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${businessQuotaBadgeClass}`}>
                          {businessQuotaLabel}
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-[17px] font-semibold leading-5 text-zinc-950">
                          {businessName}
                        </h3>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#ff1f63]">
                          <Star className="h-3.5 w-3.5 fill-current" />
                          {business.is_featured ? "Öne çıkan" : "Yeni"}
                        </span>
                      </div>

                      <div className="space-y-0.5 text-[12px] leading-5 text-zinc-600">
                        <p className="truncate">
                          <span className="font-semibold text-zinc-700">Bölge:</span> İstanbul/Beylikdüzü
                        </p>
                        <p className="truncate">
                          <span className="font-semibold text-zinc-700">Fiyat aralığı:</span> 140 TL - 198 TL arası
                        </p>
                        <p className="truncate">
                          <span className="font-semibold text-zinc-700">Kategori:</span> {categoryName}
                        </p>
                      </div>
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {homeData && menuTiles.length > 0 ? (
        <section className="space-y-5">
          <div className="flex items-center justify-start">
            <h2 className="hy-market-heading text-[31px] leading-none text-zinc-700 sm:text-[31px]">
              Tüm restoran menüleri
            </h2>
          </div>

          <div className="grid gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            {menuTiles.map((item) => {
              const itemName = repairPotentialMojibake(item.name);
              const businessName = repairPotentialMojibake(item.business_name);
              const rawCategoryName = repairPotentialMojibake(item.marketplace_category_name || item.category_name);
              const categoryName = rawCategoryName || "Kategori";
              const description = repairPotentialMojibake(item.description);
              const image = item.image || item.image_url || cuisineImageOverrides[categoryName] || cuisineImageOverrides.Burger;
              const quotaLabel = getMenuQuotaDisplayText(item);
              const quotaBadgeClass = getQuotaBadgeClass(item);
              return (
                <button key={`menu-${item.id}`} type="button" onClick={() => setSelectedMenuItem(item)} className="group block w-full cursor-pointer text-left">
                  <article className={`space-y-2 ${item.is_sold_out ? "opacity-75" : ""}`}>
                    <div className="relative aspect-[16/9] overflow-hidden rounded-[8px] border border-zinc-100 bg-zinc-100 shadow-[0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-[0_14px_28px_rgba(15,23,42,0.12)]">
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
                        <div className="flex h-full items-center justify-center bg-zinc-100 px-5 text-center text-sm font-medium text-zinc-500">
                          HalkYemek
                        </div>
                      )}

                      {item.business_is_featured ? (
                        <span className="absolute bottom-2 right-2 rounded-full bg-zinc-950/90 px-2 py-1 text-[10px] font-semibold text-white">
                          Öne Çıkan
                        </span>
                      ) : null}
                      {quotaLabel ? (
                        <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow-sm ${quotaBadgeClass}`}>
                          {quotaLabel}
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-[18px] font-semibold leading-6 text-zinc-950">
                          {itemName}
                        </h3>
                        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[#ff1f63]">
                          <Star className="h-3.5 w-3.5 fill-current" />
                          {formatMenuPrice(item.price_amount)}
                        </span>
                      </div>

                      <div className="space-y-0.5 text-[12px] leading-5 text-zinc-600">
                        <p className="truncate">
                          <span className="font-semibold text-zinc-700">İşletme:</span> {businessName}
                        </p>
                        <p className="truncate">
                          <span className="font-semibold text-zinc-700">Bölge:</span> İstanbul/Beylikdüzü
                        </p>
                        <p className="truncate">
                          <span className="font-semibold text-zinc-700">Kategori:</span> {categoryName}
                        </p>
                      </div>

                      {description ? <p className="line-clamp-2 text-[12px] leading-5 text-zinc-500">{description}</p> : null}
                      {item.minimum_grams ? (
                        <div className="inline-flex rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-700">
                          Min. {item.minimum_grams} gr
                        </div>
                      ) : null}

                      <div className="inline-flex rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">
                        {quotaLabel || (item.is_sold_out ? "Hepsi tükendi" : "QR ile kasada kullanım")}
                      </div>
                    </div>
                  </article>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="overflow-hidden rounded-[32px] bg-[linear-gradient(180deg,#ffffff_0%,#fbfbfb_100%)] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
        <div className="relative p-5 sm:p-7 lg:p-8">
          <div className="pointer-events-none absolute -right-28 -top-28 h-72 w-72 rounded-full bg-[#ff1f63]/12 blur-3xl" />
          <div className="pointer-events-none absolute bottom-10 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-zinc-950/[0.04] blur-3xl" />

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

              <p className="max-w-4xl text-[15px] leading-7 text-zinc-700">
                Amaç yalnızca yemek satmak değil, insanların bütçesini koruyan sürdürülebilir bir sistem oluşturmaktır.
              </p>
            </div>

            <div className="flex min-h-[260px] flex-col justify-between overflow-hidden rounded-[26px] bg-zinc-950 p-6 text-white shadow-[0_18px_46px_rgba(15,23,42,0.22)]">
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

          <div className="relative mt-9 rounded-[28px] bg-white/70 p-1 sm:p-2">
            <div className="grid gap-x-9 gap-y-8 p-4 sm:p-5 md:grid-cols-2">
            {storySections.map((section) => (
              <article
                key={section.title}
                className="relative pl-4 transition duration-200 hover:translate-x-1"
              >
                <span className="absolute left-0 top-1 h-10 w-1 rounded-full bg-[#ff1f63]" />
                <h3 className="text-xl font-semibold tracking-[-0.03em] text-zinc-950">{section.title}</h3>
                <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700">
                  {section.body.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>

                {section.bullets ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {section.bullets.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-[#ff1f63]"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
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

      {selectedMenuItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/58 px-3 py-4 backdrop-blur-[3px] sm:px-5 sm:py-8"
          role="dialog"
          aria-modal="true"
        >
          <button type="button" aria-label="Menü detayını kapat" className="absolute inset-0 cursor-default" onClick={() => setSelectedMenuItem(null)} />
          <div className="hy-product-modal relative z-10 flex max-h-[calc(100vh-2rem)] w-full max-w-[640px] flex-col overflow-hidden rounded-[28px] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.28)]">
            <button
              type="button"
              aria-label="Menü detayını kapat"
              onClick={() => setSelectedMenuItem(null)}
              className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/96 text-zinc-700 shadow-[0_10px_30px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:text-[#f50555]"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="relative aspect-[16/10] shrink-0 bg-zinc-100 sm:aspect-[16/9]">
              {selectedItemImage ? (
                <Image
                  src={selectedItemImage}
                  alt={selectedItemName}
                  fill
                  unoptimized
                  sizes="(max-width: 768px) 100vw, 640px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 bg-[linear-gradient(145deg,#fafafa,#f4f4f5)] text-center">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">HalkYemek</span>
                  <p className="text-sm text-zinc-500">Menü görseli eklenmemiş</p>
                </div>
              )}
              {selectedQuotaLabel ? (
                <span className={`absolute left-4 top-4 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ${selectedQuotaBadgeClass}`}>
                  {selectedQuotaLabel}
                </span>
              ) : null}
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1.5 text-xs font-semibold text-[#f50555] ring-1 ring-rose-100">
                  <Sparkles className="h-3.5 w-3.5" />
                  HalkYemek özel fiyat
                </div>
                {selectedQuotaLabel ? (
                  <div className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${selectedQuotaBadgeClass}`}>
                    {selectedQuotaLabel}
                  </div>
                ) : null}
                <div className="space-y-1">
                  <h2 className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950">{selectedItemName}</h2>
                  <p className="text-sm font-medium text-zinc-500">{selectedItemBusinessName}</p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <span className="text-2xl font-semibold text-emerald-700">
                    {selectedMenuItem ? formatMenuPrice(selectedMenuItem.price_amount) : ""}
                  </span>
                  <span className="pb-1 text-sm font-medium text-zinc-500">QR ile teslim akışında geçerli</span>
                </div>
                {selectedMenuItem?.minimum_grams ? (
                  <span className="inline-flex rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-700">
                    Min. {selectedMenuItem.minimum_grams} gr
                  </span>
                ) : null}
                {selectedItemDescription ? <p className="text-sm leading-7 text-zinc-600">{selectedItemDescription}</p> : null}
                {selectedItemCategoryName ? (
                  <span className="inline-flex rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-600">
                    {selectedItemCategoryName}
                  </span>
                ) : null}
              </div>

              <div className="grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-2 sm:pt-5">
                {isAuthenticated ? (
                  <PendingButton
                    type="button"
                    onClick={handleAddSelectedMenuItem}
                    pending={addHomeMenuItemMutation.isPending}
                    pendingText="Ekleniyor..."
                    disabled={!selectedCanAddToCart}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(245,5,85,0.22)] transition hover:-translate-y-0.5 hover:bg-[#df044d] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    {selectedMenuItem.is_sold_out ? "Tükendi" : "Sepete ekle"}
                  </PendingButton>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedCanAddToCart) return;
                      openLoginDrawer(selectedBusinessHref);
                    }}
                    disabled={!selectedCanAddToCart}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(245,5,85,0.22)] transition hover:-translate-y-0.5 hover:bg-[#df044d] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    {selectedMenuItem.is_sold_out ? "Tükendi" : "Giriş yapıp ekle"}
                  </button>
                )}

                <Link
                  href={selectedBusinessHref}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-950 shadow-[0_12px_28px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-[#f50555]/30 hover:text-[#f50555]"
                >
                  İşletmeye git
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </PageContainer>
  );
}
