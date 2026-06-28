"use client";

import Link from "next/link";
import Image from "next/image";
import { Bell, ChevronDown, CircleHelp, CreditCard, Globe, Heart, LayoutGrid, LogOut, MapPin, PackageOpen, Plus, QrCode, ReceiptText, Search, ShieldCheck, ShoppingCart, Store, Trash2, UserRound, X, type LucideIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { toast } from "sonner";

import { LoginDrawer } from "@/components/auth/LoginDrawer";
import { getRoleLabel, isManagementRole } from "@/components/business/business-role";
import { getCart, removeCartItem, updateCartItemQuantity } from "@/features/cart/api";
import type { CartItemSnapshot } from "@/features/cart/types";
import { searchDiscovery } from "@/features/discovery/api";
import { getBusinessMenuQuotaDisplayText, getMenuQuotaDisplayText } from "@/features/discovery/quota-copy";
import type { DiscoverySearchResponse } from "@/features/discovery/types";
import { resolveDistrict, withSearchParams } from "@/features/discovery/params";
import { useSession } from "@/hooks/use-session";
import { OPEN_LOGIN_DRAWER_EVENT, type OpenLoginDrawerDetail } from "@/lib/auth/login-drawer";
import { finalizeClientLogout, requestLogout } from "@/lib/auth/logout";
import { formatCurrency } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

const publicNavigation = [
  { href: "/#mutfaklar", label: "Kategoriler", icon: LayoutGrid },
  { href: "/#restoranlar", label: "Restoranlar", icon: Store },
];

const authenticatedCustomerNavigation = [
  { href: "/cuzdan", label: "Cüzdan", icon: CreditCard },
];
const SEARCH_RECENTS_KEY = "hy_search_recent_v1";
const POPULAR_SEARCHES = ["burger", "pizza", "döner", "kebap"];

type HeaderMenuItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  featured?: boolean;
  logoSrc?: string;
};

type CustomerNavItem = HeaderMenuItem & {
  requiresAuth: boolean;
};

function dedupeHeaderMenuItems<T extends { href: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.href)) {
      return false;
    }
    seen.add(item.href);
    return true;
  });
}

const publicCustomerPrimaryNavigation: CustomerNavItem[] = [
  { href: "/#mutfaklar", label: "Kategoriler", icon: LayoutGrid, requiresAuth: false },
  { href: "/#restoranlar", label: "Restoranlar", icon: Store, requiresAuth: false },
  { href: "/halktasarruf", label: "HalkTasarruf", icon: PackageOpen, requiresAuth: false, logoSrc: "/halktasarruf-logo.png" },
];

const halkTasarrufNavigation: HeaderMenuItem[] = [
  { href: "/halktasarruf#firsat-kategorileri", label: "Kategoriler", icon: LayoutGrid },
  { href: "/halktasarruf#halktasarruf-isletmeleri", label: "Restoranlar", icon: Store },
];

const halkTasarrufCustomerPrimaryNavigation: CustomerNavItem[] = [
  { href: "/halktasarruf#firsat-kategorileri", label: "Kategoriler", icon: LayoutGrid, requiresAuth: false },
  { href: "/halktasarruf#halktasarruf-isletmeleri", label: "Restoranlar", icon: Store, requiresAuth: false },
];

function getSnapshotString(item: CartItemSnapshot | undefined, key: string) {
  const value = item?.menu_item_snapshot?.[key];
  return typeof value === "string" ? repairPotentialMojibake(value) : "";
}

function getCartItemImage(item: CartItemSnapshot) {
  return (
    getSnapshotString(item, "image") ||
    getSnapshotString(item, "image_url") ||
    getSnapshotString(item, "primary_image_url") ||
    getSnapshotString(item, "thumbnail_url") ||
    getSnapshotString(item, "cover_image")
  );
}

function isActiveRoute(pathname: string, href: string) {
  if (href.includes("#")) return false;
  const pathOnly = href.split("#")[0]?.split("?")[0] || href;
  return pathname === pathOnly || pathname.startsWith(`${pathOnly}/`);
}

function isBusinessRoute(pathname: string) {
  return pathname === "/isletme" || pathname.startsWith("/isletme/") || pathname === "/halktasarruf/isletme" || pathname.startsWith("/halktasarruf/isletme/");
}

function isHalkTasarrufBusinessRoute(pathname: string) {
  return pathname === "/halktasarruf/isletme" || pathname.startsWith("/halktasarruf/isletme/");
}

export function AppHeader() {
  const session = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isLoginDrawerOpen, setIsLoginDrawerOpen] = useState(false);
  const [loginNextPath, setLoginNextPath] = useState<string | undefined>(undefined);
  const [searchText, setSearchText] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<DiscoverySearchResponse | null>(null);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [isCartPanelOpen, setIsCartPanelOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [selectedCartItem, setSelectedCartItem] = useState<CartItemSnapshot | null>(null);
  const searchPanelRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const mobileProfileMenuRef = useRef<HTMLDivElement | null>(null);

  const isAuthenticated = session.data?.isAuthenticated ?? false;
  const isBusinessMode = isBusinessRoute(pathname);
  const isHalkTasarrufBusinessMode = isHalkTasarrufBusinessRoute(pathname);
  const isHalkTasarrufMode = pathname === "/halktasarruf" || pathname.startsWith("/halktasarruf/");
  const username = session.data?.user?.username?.trim() || "";
  const district = resolveDistrict(searchParams.get("district"));

  const halkYemekBusinesses = session.data?.businesses.filter((item) => item.supports_halkyemek && item.access_halkyemek) ?? [];
  const halkTasarrufBusinesses = session.data?.businesses.filter((item) => item.supports_halktasarruf && item.access_halktasarruf) ?? [];
  const activeHalkYemekBusiness =
    halkYemekBusinesses.find((item) => item.id === session.data?.activeBusinessId) ?? halkYemekBusinesses[0] ?? null;
  const activeHalkTasarrufBusiness =
    halkTasarrufBusinesses.find((item) => item.id === session.data?.activeHalkTasarrufBusinessId) ?? halkTasarrufBusinesses[0] ?? null;
  const activeBusiness = isHalkTasarrufBusinessMode ? activeHalkTasarrufBusiness : activeHalkYemekBusiness;
  const activeBusinessId = activeBusiness?.id ?? null;
  const activeBusinessRole = activeBusiness?.member_role ?? null;
  const canManageActiveBusiness = isManagementRole(activeBusinessRole);
  const isOpsAdmin = session.data?.user?.role === "ADMIN";
  const canAccessHalkYemekPanel = Boolean(halkYemekBusinesses.length || isOpsAdmin);
  const canAccessHalkTasarrufPanel = Boolean(halkTasarrufBusinesses.length || isOpsAdmin);
  const halkYemekPanelShortcut: HeaderMenuItem =
    isOpsAdmin && !halkYemekBusinesses.length
      ? { href: "/ops/isletmeler", label: "HalkYemek İşletmeleri", icon: Store }
      : { href: "/isletme", label: "HalkYemek İş Ortağı Paneli", icon: Store };
  const halkTasarrufPanelShortcut: HeaderMenuItem =
    isOpsAdmin && !halkTasarrufBusinesses.length
      ? { href: "/ops/surpriz-paketler", label: "HalkTasarruf İşletmeleri", icon: PackageOpen }
      : { href: "/halktasarruf/isletme", label: "HalkTasarruf İş Ortağı Paneli", icon: PackageOpen };
  const accessiblePartnerPanels = dedupeHeaderMenuItems([
    ...(canAccessHalkYemekPanel ? [halkYemekPanelShortcut] : []),
    ...(canAccessHalkTasarrufPanel ? [halkTasarrufPanelShortcut] : []),
  ]);
  const primaryBusinessPanelShortcut = isHalkTasarrufMode ? halkTasarrufPanelShortcut : halkYemekPanelShortcut;
  const currentPublicNavigation = isHalkTasarrufMode ? halkTasarrufNavigation : publicNavigation;
  const currentCustomerPrimaryNavigation = isHalkTasarrufMode ? halkTasarrufCustomerPrimaryNavigation : publicCustomerPrimaryNavigation;
  const brandLogo = isHalkTasarrufMode
    ? { href: "/halktasarruf", src: "/halktasarruf-logo.png", alt: "HalkTasarruf", mobileClassName: "h-[34px] w-auto object-contain", desktopClassName: "h-[44px] w-auto object-contain" }
    : { href: "/", src: "/logo-halkyemek.png", alt: "HalkYemek", mobileClassName: "h-[42px] w-auto object-contain", desktopClassName: "h-[56px] w-auto object-contain" };
  const signupCtaClassName = isHalkTasarrufMode
    ? "hidden rounded-xl bg-[linear-gradient(135deg,#6D28D9,#7C3AED)] px-4 py-2 text-sm font-semibold text-white shadow-[0_12px_26px_rgba(109,40,217,0.22)] transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(109,40,217,0.28)] md:inline-flex"
    : "hidden rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-rose-700 hover:shadow-md md:inline-flex";
  const customerPrimaryNavigation = dedupeHeaderMenuItems([
    ...currentCustomerPrimaryNavigation,
    ...(isOpsAdmin
      ? [
          { href: "/ops/bildirimler/yayinla", label: "Bildirimleri yönet", icon: Bell, requiresAuth: true },
          { href: "/ops/isletmeler", label: "HalkYemek işletmeleri", icon: Store, requiresAuth: true },
          { href: "/ops/surpriz-paketler", label: "HalkTasarruf işletmeleri", icon: PackageOpen, requiresAuth: true },
        ]
      : []),
  ]);
  const mobileCustomerPrimaryNavigation = currentCustomerPrimaryNavigation;

  const defaultNavigation = dedupeHeaderMenuItems([
    ...currentPublicNavigation,
    ...(isAuthenticated ? authenticatedCustomerNavigation : []),
    ...((isHalkTasarrufMode ? canAccessHalkTasarrufPanel : canAccessHalkYemekPanel) ? [primaryBusinessPanelShortcut] : []),
    ...(isOpsAdmin
      ? [
          { href: "/ops/isletmeler", label: "HalkYemek İşletmeleri", icon: ShieldCheck },
          { href: "/ops/surpriz-paketler", label: "HalkTasarruf İşletmeleri", icon: PackageOpen },
        ]
      : []),
  ]);

  const businessNavigation = dedupeHeaderMenuItems([
    { href: isHalkTasarrufBusinessMode ? "/halktasarruf/isletme" : "/isletme", label: isHalkTasarrufBusinessMode ? "HalkTasarruf Alanı" : "İşletme Alanı", icon: Store },
    ...(activeBusinessId
      ? [
          { href: `${isHalkTasarrufBusinessMode ? "/halktasarruf/isletme" : "/isletme"}/${activeBusinessId}`, label: canManageActiveBusiness ? "Yönetim Özeti" : "Operasyon Özeti", icon: LayoutGrid },
          { href: `${isHalkTasarrufBusinessMode ? "/halktasarruf/isletme" : "/isletme"}/${activeBusinessId}/gecmis`, label: "İşlem Geçmişi", icon: ReceiptText },
          { href: `${isHalkTasarrufBusinessMode ? "/halktasarruf/isletme" : "/isletme"}/${activeBusinessId}/profil`, label: "İşletme Profili", icon: UserRound },
          ...(canManageActiveBusiness
            ? [
                {
                  href: isHalkTasarrufBusinessMode
                    ? `/halktasarruf/isletme/${activeBusinessId}/surpriz-paketler`
                    : `/isletme/${activeBusinessId}?panel=menu`,
                  label: isHalkTasarrufBusinessMode ? "Sürpriz Paketler" : "Menü Yönetimi",
                  icon: isHalkTasarrufBusinessMode ? PackageOpen : Store,
                },
              ]
            : []),
        ]
      : []),
    ...(isOpsAdmin
      ? [
          { href: "/ops/isletmeler", label: "HalkYemek İşletmeleri", icon: ShieldCheck },
          { href: "/ops/surpriz-paketler", label: "HalkTasarruf İşletmeleri", icon: PackageOpen },
        ]
      : []),
  ]);

  const navigation = isBusinessMode ? businessNavigation : defaultNavigation;
  const cartQuery = useQuery({
    queryKey: ["cart", "detail"],
    queryFn: getCart,
    enabled: isAuthenticated && !isBusinessMode,
    retry: 0,
    staleTime: 15_000,
  });
  const cart = cartQuery.data;
  const cartItemCount = cart?.item_count ?? 0;
  const cartSubtotal = cart?.pricing?.subtotal_amount ?? cart?.subtotal_amount ?? 0;
  const cartBusinessName = getSnapshotString(cart?.items[0], "business_name") || "Sepetindeki işletme";
  const profileMenuItems: HeaderMenuItem[] = dedupeHeaderMenuItems([
    { href: "/siparislerim", label: "Önceki Siparişlerim", icon: ReceiptText, featured: true },
    { href: "/qrlarim", label: "QRlarım", icon: QrCode },
    { href: "/cuzdan", label: "Cüzdan", icon: CreditCard },
    { href: "/bildirimler", label: "Bildirimler", icon: Bell },
    ...accessiblePartnerPanels,
    ...(isOpsAdmin ? [{ href: "/ops/bildirimler/yayinla", label: "Bildirimleri yönet", icon: Bell }] : []),
    ...(isOpsAdmin ? [{ href: "/ops/isletmeler", label: "HalkYemek işletmeleri", icon: Store }] : []),
    ...(isOpsAdmin ? [{ href: "/ops/surpriz-paketler", label: "HalkTasarruf işletmeleri", icon: PackageOpen }] : []),
  ]);

  function openLogin(nextPath?: string) {
    setLoginNextPath(nextPath);
    setIsLoginDrawerOpen(true);
  }

  function closeHeaderOverlays() {
    setIsProfileMenuOpen(false);
    setIsCartPanelOpen(false);
    setIsSearchOpen(false);
    setIsLoginDrawerOpen(false);
    setSelectedCartItem(null);
  }

  function navigateFromHeader(href: string) {
    closeHeaderOverlays();
    router.push(href);
  }

  function handleSamePageHashNavigation(href: string) {
    if (!href.includes("#") || typeof window === "undefined") return false;

    const targetUrl = new URL(href, window.location.origin);
    if (targetUrl.pathname !== pathname) return false;

    const targetId = targetUrl.hash.slice(1);
    if (!targetId) return false;

    closeHeaderOverlays();
    window.history.pushState(null, "", `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`);
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
    return true;
  }

  function handleHeaderAnchorClick(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (handleSamePageHashNavigation(href)) {
      event.preventDefault();
    }
  }

  function handleProtectedNavigation(href: string, requiresAuth: boolean) {
    if (href === "/sepet") {
      handleCartButtonClick();
      return;
    }

    if (requiresAuth && !isAuthenticated) {
      closeHeaderOverlays();
      openLogin(href);
      return;
    }

    navigateFromHeader(href);
  }

  function handleCartButtonClick() {
    if (!isAuthenticated) {
      closeHeaderOverlays();
      openLogin("/?cart=open");
      return;
    }
    closeHeaderOverlays();
    setIsCartPanelOpen(true);
  }

  function openCartItemDetail(item: CartItemSnapshot) {
    setSelectedCartItem(item);
  }

  const removeCartItemMutation = useMutation({
    mutationFn: removeCartItem,
    onSuccess: async (nextCart) => {
      queryClient.setQueryData(["cart", "detail"], nextCart);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
      ]);
      if (nextCart.item_count <= 0) {
        setIsCartPanelOpen(false);
      }
    },
  });

  const updateCartItemQuantityMutation = useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: number; quantity: number }) =>
      updateCartItemQuantity({ itemId, quantity }),
    onSuccess: async (nextCart) => {
      queryClient.setQueryData(["cart", "detail"], nextCart);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["cart", "checkout-preview"] }),
      ]);
    },
  });

  function increaseCartItemQuantity(item: CartItemSnapshot) {
    updateCartItemQuantityMutation.mutate({
      itemId: item.cart_item_id,
      quantity: Math.max(1, item.quantity + 1),
    });
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SEARCH_RECENTS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecentSearches(parsed.filter((item): item is string => typeof item === "string").slice(0, 6));
      }
    } catch {
      setRecentSearches([]);
    }
  }, []);

  function persistRecentSearch(term: string) {
    const clean = term.trim();
    if (!clean) return;
    const next = [clean, ...recentSearches.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
    setRecentSearches(next);
    try {
      localStorage.setItem(SEARCH_RECENTS_KEY, JSON.stringify(next));
    } catch {
      // noop
    }
  }

  function clearRecentSearch(term: string) {
    const next = recentSearches.filter((item) => item !== term);
    setRecentSearches(next);
    try {
      localStorage.setItem(SEARCH_RECENTS_KEY, JSON.stringify(next));
    } catch {
      // noop
    }
  }

  function submitSearch(term?: string) {
    const query = (term ?? searchText).trim();
    if (!query) return;
    if (term !== undefined) {
      setSearchText(query);
    }
    persistRecentSearch(query);
    setIsSearchOpen(true);
  }

  useEffect(() => {
    if (!isSearchOpen) return;
    const handle = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const data = await searchDiscovery({ q: searchText.trim(), district, limit: 16 });
        setSearchResults(data);
      } catch {
        setSearchResults(null);
      } finally {
        setSearchLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [isSearchOpen, searchText, district]);

  useEffect(() => {
    if (!isSearchOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!searchPanelRef.current) return;
      const target = event.target as Node;
      if (!searchPanelRef.current.contains(target)) {
        setIsSearchOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!isProfileMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const isInsideDesktopMenu = profileMenuRef.current?.contains(target) ?? false;
      const isInsideMobileMenu = mobileProfileMenuRef.current?.contains(target) ?? false;
      if (!isInsideDesktopMenu && !isInsideMobileMenu) {
        setIsProfileMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [isProfileMenuOpen]);

  useEffect(() => {
    setIsProfileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleOpenLoginDrawer(event: Event) {
      const detail = (event as CustomEvent<OpenLoginDrawerDetail>).detail;
      openLogin(detail?.nextPath);
    }

    window.addEventListener(OPEN_LOGIN_DRAWER_EVENT, handleOpenLoginDrawer);
    return () => window.removeEventListener(OPEN_LOGIN_DRAWER_EVENT, handleOpenLoginDrawer);
  }, []);

  useEffect(() => {
    if (isAuthenticated || searchParams.get("auth") !== "login") {
      return;
    }

    openLogin(searchParams.get("next") ?? undefined);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("auth");
    nextParams.delete("next");
    router.replace(`${pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`, { scroll: false });
  }, [isAuthenticated, pathname, router, searchParams]);

  useEffect(() => {
    if (isBusinessMode || session.isPending || searchParams.get("cart") !== "open") {
      return;
    }

    if (!isAuthenticated) {
      openLogin("/?cart=open");
    } else {
      setIsProfileMenuOpen(false);
      setIsCartPanelOpen(true);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("cart");
    router.replace(`${pathname}${nextParams.toString() ? `?${nextParams.toString()}` : ""}`, { scroll: false });
  }, [isAuthenticated, isBusinessMode, pathname, router, searchParams, session.isPending]);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    closeHeaderOverlays();

    let logoutRequestFailed = false;

    try {
      await requestLogout();
    } catch {
      logoutRequestFailed = true;
    }

    try {
      if (logoutRequestFailed) {
        toast.warning("Çıkış tamamlanıyor.", { description: "Sunucu yanıtı gecikti, oturum bilgilerin güvenli şekilde temizleniyor." });
      } else {
        toast.success("Çıkış yapıldı.");
      }
      await finalizeClientLogout({ queryClient, router });
    } catch {
      if (typeof window !== "undefined") {
        window.location.replace("/");
        return;
      }
      toast.success("Çıkış yapıldı.");
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 bg-white shadow-[0_1px_0_rgba(15,23,42,0.025)] transition-shadow duration-300">
      <div className="mx-auto flex max-w-6xl flex-col gap-2.5 px-4 py-2 sm:px-6 lg:px-8">
        {isBusinessMode ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link href={isHalkTasarrufBusinessMode ? "/halktasarruf/isletme" : "/isletme"} className="flex min-w-0 items-center gap-3">
                <Image
                  src={isHalkTasarrufBusinessMode ? "/halktasarruf-logo.png" : "/logo-halkyemek.png"}
                  alt={isHalkTasarrufBusinessMode ? "HalkTasarruf" : "HalkYemek"}
                  width={1100}
                  height={254}
                  className="h-10 w-auto shrink-0 object-contain"
                  priority
                />
                <span className="hidden rounded-full bg-zinc-950 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-white shadow-[0_10px_28px_rgba(9,9,11,0.14)] md:inline-flex">
                  {isHalkTasarrufBusinessMode ? "HalkTasarruf işletme" : "İşletme"}
                </span>
              </Link>
              <div className="flex max-w-full min-w-0 items-center rounded-full border border-zinc-200/80 bg-white/90 p-1 shadow-[0_16px_45px_rgba(15,23,42,0.08)] backdrop-blur">
                {activeBusiness ? (
                  <span className="hidden max-w-[280px] items-center gap-2 truncate rounded-full bg-zinc-950 px-3.5 py-2 text-sm font-semibold text-white lg:inline-flex">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#f50555]/18 text-[#ff8aad]">
                      <Store className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate">{repairPotentialMojibake(activeBusiness.name)}</span>
                    <span className="h-1 w-1 shrink-0 rounded-full bg-white/30" />
                    <span className="shrink-0 text-white/68">{getRoleLabel(activeBusinessRole)}</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => navigateFromHeader(isHalkTasarrufBusinessMode ? "/halktasarruf" : "/")}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-rose-50 hover:text-[#f50555] sm:px-3.5"
                >
                  <Globe className="h-4 w-4" />
                  <span className="hidden sm:inline">{isHalkTasarrufBusinessMode ? "HalkTasarruf alanı" : "Müşteri alanı"}</span>
                  <span className="sm:hidden">Müşteri</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold text-zinc-500 transition hover:bg-zinc-950 hover:text-white disabled:pointer-events-none disabled:opacity-55 sm:px-3.5"
                >
                  <LogOut className="h-4 w-4" />
                  <span>{isLoggingOut ? "Çıkış yapılıyor" : "Çıkış"}</span>
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2 lg:hidden">
              <div className="flex items-center justify-between">
                {isAuthenticated && username ? (
                  <button
                    type="button"
                    onClick={() => setIsProfileMenuOpen((current) => !current)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-700 transition hover:bg-zinc-100"
                    aria-label="Hesap menüsü"
                    aria-expanded={isProfileMenuOpen}
                    aria-haspopup="menu"
                  >
                    <UserRound className="h-5 w-5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openLogin()}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-700 transition hover:bg-zinc-100"
                    aria-label="Giriş"
                  >
                    <UserRound className="h-5 w-5" />
                  </button>
                )}

                <Link href={brandLogo.href} className="-ml-[6px] inline-flex items-center transition-transform duration-200 hover:scale-[1.01]">
                  <Image src={brandLogo.src} alt={brandLogo.alt} width={1100} height={254} className={brandLogo.mobileClassName} priority />
                </Link>

                {isAuthenticated ? (
                  <button
                    type="button"
                    onClick={handleCartButtonClick}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200 hover:text-zinc-700 hover:shadow-sm"
                    aria-label="Sepet"
                  >
                    <span className="relative inline-flex">
                      <ShoppingCart className="h-4 w-4" />
                      {cartItemCount > 0 ? (
                        <span className="absolute -right-2.5 -top-2.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff1f63] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                          {cartItemCount}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openLogin("/?cart=open")}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200 hover:text-zinc-700 hover:shadow-sm"
                    aria-label="Sepet"
                  >
                    <ShoppingCart className="h-4 w-4" />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-2 pb-0">
                <form
                  className="w-full"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitSearch();
                  }}
                >
                  <label className="inline-flex min-h-11 w-full items-center gap-2 rounded-full border border-zinc-200 bg-zinc-100 px-4 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition duration-200 hover:border-zinc-300 hover:bg-zinc-50 focus-within:border-zinc-300 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(24,24,27,0.08)]">
                    <Search className="h-4 w-4 shrink-0 text-zinc-400" />
                    <input
                      value={searchText}
                      onChange={(event) => setSearchText(event.target.value)}
                      onFocus={() => setIsSearchOpen(true)}
                      placeholder="Yemek, mutfak veya restoran arayın"
                      className="w-full bg-transparent text-zinc-700 placeholder:text-zinc-500 outline-none"
                    />
                  </label>
                </form>

                <nav className="hy-scrollbar-none flex w-full items-center gap-2 overflow-x-auto pl-0">
                  {mobileCustomerPrimaryNavigation.map((item) => {
                    const Icon = item.icon;
                    const active = isActiveRoute(pathname, item.href);
                    const isLogoItem = Boolean(item.logoSrc);
                    const navClass = `inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold leading-none tracking-[0.01em] transition-colors ${
                          active
                            ? "bg-zinc-100 text-zinc-900 shadow-sm"
                            : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                        }`;
                    const logoNavClass = `inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold leading-none tracking-[0.01em] transition-colors ${
                      active ? "bg-zinc-100 text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                    }`;

                    if (isLogoItem && item.logoSrc) {
                      return (
                        <Link key={`mobile-${item.href}`} href={item.href} className={logoNavClass} aria-label={item.label}>
                          <Image src={item.logoSrc} alt={item.label} width={420} height={92} className="h-5 w-auto object-contain" />
                        </Link>
                      );
                    }

                    if (item.requiresAuth && !isAuthenticated) {
                      return (
                        <button key={`mobile-${item.href}`} type="button" onClick={() => handleProtectedNavigation(item.href, true)} className={navClass}>
                          <Icon className="h-[16px] w-[16px] shrink-0" />
                          <span className="whitespace-nowrap">{item.label}</span>
                        </button>
                      );
                    }

                    return (
                      <Link
                        key={`mobile-${item.href}`}
                        href={item.href}
                        onClick={(event) => handleHeaderAnchorClick(event, item.href)}
                        className={navClass}
                      >
                        <Icon className="h-[16px] w-[16px] shrink-0" />
                        <span className="whitespace-nowrap">{item.label}</span>
                      </Link>
                    );
                  })}
                </nav>
              </div>
            </div>

            <div className="hidden flex-col gap-2 lg:flex lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                <Link href={brandLogo.href} className="-ml-[6px] inline-flex items-center transition-transform duration-200 hover:scale-[1.01]">
                  <Image src={brandLogo.src} alt={brandLogo.alt} width={1100} height={254} className={brandLogo.desktopClassName} priority />
                </Link>
              </div>

              <div className="hidden min-w-0 flex-1 justify-center px-4 lg:flex">
                <button
                  type="button"
                  className="inline-flex min-w-0 max-w-[460px] items-center gap-2.5 rounded-full border border-zinc-200 bg-zinc-50/90 px-4 py-2.5 text-zinc-700 shadow-[0_8px_22px_rgba(15,23,42,0.045)] transition duration-200 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-white hover:shadow-[0_16px_30px_rgba(15,23,42,0.075)]"
                >
                  <MapPin className="h-[17px] w-[17px] shrink-0 text-zinc-800" />
                  <span className="truncate text-[14px] font-semibold leading-5 text-zinc-700">
                    {"Aktif B\u00F6lge: \u0130stanbul/Beylikd\u00FCz\u00FC"}
                  </span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                {isAuthenticated && username ? (
                  <div ref={profileMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setIsProfileMenuOpen((current) => !current)}
                      className="inline-flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-semibold text-zinc-900 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-50 hover:shadow-sm"
                      aria-expanded={isProfileMenuOpen}
                      aria-haspopup="menu"
                    >
                      <UserRound className="h-5 w-5" />
                      <span>{username}</span>
                      <ChevronDown className={`h-4 w-4 text-[#ff1f63] transition duration-200 ${isProfileMenuOpen ? "rotate-180" : ""}`} />
                    </button>

                    {isProfileMenuOpen ? (
                      <div
                        className="absolute right-0 top-[calc(100%+10px)] z-50 w-[312px] overflow-hidden rounded-[16px] border border-zinc-100 bg-white p-3 shadow-[0_24px_70px_rgba(15,23,42,0.18)] animate-[fadeIn_.16s_ease-out]"
                        role="menu"
                      >
                        <div className="space-y-1">
                          {profileMenuItems.map((item) => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.href}
                                type="button"
                                onClick={() => navigateFromHeader(item.href)}
                                className={`flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm font-semibold transition duration-150 hover:bg-rose-50 hover:text-zinc-950 ${
                                  item.featured ? "bg-rose-50 text-zinc-950" : "text-zinc-700"
                                }`}
                                role="menuitem"
                              >
                                <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${item.featured ? "bg-[#ff1f63] text-white" : "bg-white text-zinc-700"}`}>
                                  <Icon className="h-5 w-5" />
                                </span>
                                {item.label}
                              </button>
                            );
                          })}
                        </div>

                        <div className="my-2 h-px bg-zinc-100" />

                        <button
                          type="button"
                          className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm font-semibold text-zinc-700 transition duration-150 hover:bg-zinc-50 hover:text-zinc-950"
                          role="menuitem"
                        >
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-zinc-700">
                            <CircleHelp className="h-5 w-5" />
                          </span>
                          Yardım Merkezi
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsProfileMenuOpen(false);
                            handleLogout();
                          }}
                          disabled={isLoggingOut}
                          className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm font-semibold text-zinc-700 transition duration-150 hover:bg-zinc-50 hover:text-zinc-950 disabled:pointer-events-none disabled:opacity-55"
                          role="menuitem"
                        >
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-zinc-700">
                            <LogOut className="h-5 w-5" />
                          </span>
                          {isLoggingOut ? "Çıkış yapılıyor" : "Çıkış yap"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openLogin()}
                    className="rounded-xl border border-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-50 hover:shadow-sm"
                  >
                    Giriş Yap
                  </button>
                )}
                {!isAuthenticated ? (
                  <button
                    type="button"
                    onClick={() => openLogin()}
                    className={signupCtaClassName}
                  >
                    Minimum fiyatlar için kaydolun
                  </button>
                ) : null}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-xl px-2 py-2 text-sm text-zinc-800 transition duration-200 hover:bg-zinc-100"
                >
                  <Globe className="h-5 w-5" /> TR
                  <ChevronDown className="h-4 w-4 text-[#ff1f63]" />
                </button>
                {isAuthenticated ? (
                  <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full text-zinc-800 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-100 hover:shadow-sm"
                    aria-label="Favoriler"
                  >
                    <Heart className="h-5 w-5" />
                  </button>
                ) : null}
                {isAuthenticated ? (
                  <button
                    type="button"
                    onClick={handleCartButtonClick}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200 hover:text-zinc-700 hover:shadow-sm"
                    aria-label="Sepet"
                  >
                    <span className="relative inline-flex">
                      <ShoppingCart className="h-4 w-4" />
                      {cartItemCount > 0 ? (
                        <span className="absolute -right-2.5 -top-2.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff1f63] px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                          {cartItemCount}
                        </span>
                      ) : null}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openLogin("/?cart=open")}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition duration-200 hover:-translate-y-0.5 hover:bg-zinc-200 hover:text-zinc-700 hover:shadow-sm"
                    aria-label="Sepet"
                  >
                    <ShoppingCart className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="hidden flex-col gap-2 pb-0 lg:flex lg:flex-row lg:items-center lg:justify-between">
              <nav className="flex items-center gap-2 overflow-x-auto pl-0 sm:gap-3">
                {customerPrimaryNavigation.map((item) => {
                  const Icon = item.icon;
                  const isCartItem = item.href === "/sepet";
                  const active = isCartItem ? isCartPanelOpen : isActiveRoute(pathname, item.href);
                  const isLogoItem = Boolean(item.logoSrc);
                  const navClass = `inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold leading-none tracking-[0.01em] transition-colors sm:text-[15px] ${
                        active
                          ? "bg-zinc-100 text-zinc-900 shadow-sm"
                          : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                      }`;
                  const logoNavClass = `inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold leading-none tracking-[0.01em] transition-colors sm:text-[15px] ${
                    active ? "bg-zinc-100 text-zinc-900 shadow-sm" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
                  }`;

                  if (isLogoItem && item.logoSrc) {
                    return (
                      <Link key={item.href} href={item.href} className={logoNavClass} aria-label={item.label}>
                        <Image src={item.logoSrc} alt={item.label} width={420} height={92} className="h-6 w-auto object-contain" />
                      </Link>
                    );
                  }

                  if (isCartItem) {
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={handleCartButtonClick}
                        className={navClass}
                      >
                        <Icon className="h-[16px] w-[16px] shrink-0" /> {item.label}
                      </button>
                    );
                  }

                  if (item.requiresAuth && !isAuthenticated) {
                    return (
                      <button
                        key={item.href}
                        type="button"
                        onClick={() => handleProtectedNavigation(item.href, true)}
                        className={navClass}
                      >
                        <Icon className="h-4 w-4" /> {item.label}
                      </button>
                    );
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={(event) => handleHeaderAnchorClick(event, item.href)}
                      className={navClass}
                    >
                      <Icon className="h-[16px] w-[16px] shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <form
                className="w-full lg:w-[390px]"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSearch();
                }}
              >
                <label className="inline-flex min-h-11 w-full items-center gap-2 rounded-full border border-zinc-200 bg-zinc-100 px-4 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition duration-200 hover:border-zinc-300 hover:bg-zinc-50 focus-within:border-zinc-300 focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(24,24,27,0.08)] lg:min-h-12">
                  <Search className="h-4 w-4 text-zinc-400" />
                  <input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onFocus={() => setIsSearchOpen(true)}
                    placeholder="Yemek, mutfak veya restoran arayın"
                    className="w-full bg-transparent text-zinc-700 placeholder:text-zinc-500 outline-none"
                  />
                </label>
              </form>
            </div>
          </>
        )}
      </div>

      {!isBusinessMode && isAuthenticated && isCartPanelOpen ? (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/20 backdrop-blur-[1px]"
          onClick={() => setIsCartPanelOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsCartPanelOpen(false);
          }}
        >
          <aside
            className="absolute right-0 top-0 flex h-dvh w-full max-w-[390px] flex-col bg-white shadow-[0_28px_90px_rgba(15,23,42,0.24)] animate-[fadeIn_.16s_ease-out]"
            onClick={(event) => event.stopPropagation()}
            aria-label="Sepet paneli"
          >
            <div className="flex items-center justify-between px-5 py-5">
              <h2 className="text-xl font-semibold tracking-[-0.035em] text-zinc-700">Tüm sepetler</h2>
              <button
                type="button"
                onClick={() => setIsCartPanelOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-600 shadow-[0_10px_26px_rgba(15,23,42,0.12)] transition hover:-translate-y-0.5 hover:text-zinc-950"
                aria-label="Sepeti kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-6">
              {cartQuery.isPending ? (
                <div className="rounded-2xl border border-zinc-200 p-4">
                  <div className="h-5 w-40 animate-pulse rounded-full bg-zinc-100" />
                  <div className="mt-4 h-20 animate-pulse rounded-2xl bg-zinc-100" />
                </div>
              ) : cart && cart.item_count > 0 ? (
                <div className="rounded-[18px] border border-zinc-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.08)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-lg font-semibold leading-6 text-zinc-950">{cartBusinessName}</h3>
                      <p className="mt-1 text-sm font-semibold leading-5 text-emerald-600">QR ile teslim</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => cart.items.forEach((item) => removeCartItemMutation.mutate(item.cart_item_id))}
                      disabled={removeCartItemMutation.isPending}
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-zinc-600 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-50"
                      aria-label="Sepeti temizle"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {cart.items.map((item) => {
                      const itemImage = getCartItemImage(item);
                      return (
                        <div key={item.cart_item_id} className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => openCartItemDetail(item)}
                            className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 text-left transition hover:-translate-y-0.5 hover:border-[#ff1f63]/35 hover:shadow-sm"
                            aria-label={`${repairPotentialMojibake(item.name)} detayını aç`}
                          >
                            {itemImage ? (
                              <Image src={itemImage} alt={repairPotentialMojibake(item.name)} fill unoptimized sizes="48px" className="object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold text-zinc-400">HY</div>
                            )}
                          </button>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={() => openCartItemDetail(item)}
                              className="max-w-full truncate text-left text-sm font-semibold text-zinc-950 transition hover:text-[#ff1f63]"
                            >
                              {repairPotentialMojibake(item.name)}
                            </button>
                            <div className="mt-0.5 text-xs text-zinc-500">
                              {item.quantity} adet · {formatCurrency(item.line_total_amount, cart.currency)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              increaseCartItemQuantity(item);
                            }}
                            disabled={updateCartItemQuantityMutation.isPending}
                            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-700 transition hover:-translate-y-0.5 hover:border-[#ff1f63]/35 hover:bg-rose-50 hover:text-[#ff1f63] disabled:pointer-events-none disabled:opacity-50"
                            aria-label="Sepetteki ürün adedini artır"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-4 text-sm">
                    <span className="font-semibold text-zinc-900">Ara Toplam</span>
                    <span className="font-semibold text-zinc-950">{formatCurrency(cartSubtotal, cart.currency)}</span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsCartPanelOpen(false);
                      router.push("/checkout");
                    }}
                    className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-950 shadow-[0_8px_18px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-[#ff1f63]/35 hover:bg-rose-50 hover:text-[#ff1f63] hover:shadow-[0_14px_28px_rgba(255,31,99,0.12)]"
                  >
                    Ödemeye geçin
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-zinc-200 p-5 text-sm text-zinc-600">
                  Sepetin şu anda boş.
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {!isBusinessMode && isAuthenticated && selectedCartItem ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/45 p-4 backdrop-blur-[3px]"
          onClick={() => setSelectedCartItem(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setSelectedCartItem(null);
          }}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-[28px] bg-white shadow-[0_30px_100px_rgba(15,23,42,0.34)] animate-[fadeIn_.16s_ease-out]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="relative h-56 bg-zinc-100">
              {getCartItemImage(selectedCartItem) ? (
                <Image
                  src={getCartItemImage(selectedCartItem)}
                  alt={repairPotentialMojibake(selectedCartItem.name)}
                  fill
                  unoptimized
                  sizes="(max-width: 640px) 100vw, 448px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-zinc-400">HalkYemek</div>
              )}
              <button
                type="button"
                onClick={() => setSelectedCartItem(null)}
                className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-700 shadow-[0_10px_30px_rgba(15,23,42,0.18)] transition hover:-translate-y-0.5 hover:text-zinc-950"
                aria-label="Ürün detayını kapat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-5">
              <span className="inline-flex rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-[#ff1f63]">
                HalkYemek özel fiyat
              </span>
              <div>
                <h3 className="text-2xl font-semibold tracking-[-0.04em] text-zinc-950">
                  {repairPotentialMojibake(selectedCartItem.name)}
                </h3>
                <p className="mt-2 text-sm text-zinc-500">
                  Sepette {selectedCartItem.quantity} adet · toplam {formatCurrency(selectedCartItem.line_total_amount, cart?.currency ?? "TRY")}
                </p>
              </div>
              <div className="flex items-center justify-between rounded-2xl bg-zinc-50 p-4">
                <span className="text-sm font-semibold text-zinc-600">Birim fiyat</span>
                <span className="text-lg font-semibold text-emerald-700">
                  {formatCurrency(selectedCartItem.unit_price_amount, cart?.currency ?? "TRY")}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!isBusinessMode && isAuthenticated && isProfileMenuOpen ? (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/20 p-3 backdrop-blur-[2px] lg:hidden"
          onClick={() => setIsProfileMenuOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsProfileMenuOpen(false);
          }}
        >
          <div
            ref={mobileProfileMenuRef}
            className="hy-mobile-sheet mt-14 w-full rounded-[18px] bg-white p-3 shadow-[0_28px_90px_rgba(15,23,42,0.22)] animate-[fadeIn_.16s_ease-out]"
            onClick={(event) => event.stopPropagation()}
            role="menu"
          >
            <div className="space-y-1">
              {profileMenuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={`mobile-profile-${item.href}`}
                    type="button"
                    onClick={() => navigateFromHeader(item.href)}
                    className={`flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm font-semibold transition duration-150 hover:bg-rose-50 hover:text-zinc-950 ${
                      item.featured ? "bg-rose-50 text-zinc-950" : "text-zinc-700"
                    }`}
                    role="menuitem"
                  >
                    <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${item.featured ? "bg-[#ff1f63] text-white" : "bg-white text-zinc-700"}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="my-2 h-px bg-zinc-100" />

            <button
              type="button"
              className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm font-semibold text-zinc-700 transition duration-150 hover:bg-zinc-50 hover:text-zinc-950"
              role="menuitem"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-zinc-700">
                <CircleHelp className="h-5 w-5" />
              </span>
              Yardım Merkezi
            </button>
            <button
              type="button"
              onClick={() => {
                setIsProfileMenuOpen(false);
                handleLogout();
              }}
              disabled={isLoggingOut}
              className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-sm font-semibold text-zinc-700 transition duration-150 hover:bg-zinc-50 hover:text-zinc-950 disabled:pointer-events-none disabled:opacity-55"
              role="menuitem"
            >
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white text-zinc-700">
                <LogOut className="h-5 w-5" />
              </span>
              {isLoggingOut ? "Çıkış yapılıyor" : "Çıkış yap"}
            </button>
          </div>
        </div>
      ) : null}

      {!isBusinessMode && isSearchOpen ? (
        <div
          className="fixed inset-0 z-50 bg-zinc-950/10 p-3 sm:p-4"
          onClick={() => setIsSearchOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setIsSearchOpen(false);
          }}
        >
          <div
            ref={searchPanelRef}
            className="hy-mobile-sheet mx-auto w-full max-w-5xl rounded-2xl border border-zinc-200 bg-white shadow-[0_30px_120px_rgba(0,0,0,0.28)] transition-all duration-200 animate-[fadeIn_.18s_ease-out]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-zinc-200 p-3 sm:p-4">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSearch();
                }}
                className="inline-flex min-h-12 w-full items-center gap-2 rounded-full border border-zinc-300 bg-zinc-50 px-4 text-sm text-zinc-500 focus-within:border-zinc-400 focus-within:bg-white"
              >
                <Search className="h-4 w-4 text-zinc-400" />
                <input
                  autoFocus
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Yemek, mutfak veya restoran arayın"
                  className="w-full bg-transparent text-zinc-800 placeholder:text-zinc-500 outline-none"
                />
              </form>
            </div>
            <div className="max-h-[58vh] overflow-y-auto p-4 sm:p-5">
              {searchLoading ? <p className="text-sm text-zinc-500">Aranıyor...</p> : null}

              {searchText.trim().length > 0 && !searchLoading && searchResults ? (
                <div className="mb-5 space-y-2">
                  <h3 className="text-lg font-semibold text-zinc-900">Sonuçlar</h3>
                  <div className="grid gap-2">
                    {searchResults.businesses.slice(0, 4).map((biz) => {
                      const quotaLabel = getBusinessMenuQuotaDisplayText(biz);
                      return (
                        <button
                          key={`biz-${biz.id}`}
                          type="button"
                          onClick={() => {
                            persistRecentSearch(searchText || biz.business_name);
                            setIsSearchOpen(false);
                            router.push(withSearchParams(`/isletmeler/${biz.id}`, { district }));
                          }}
                          className="group rounded-xl border border-zinc-200 px-3 py-2 text-left transition duration-150 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-sm"
                        >
                          <div className="text-sm font-semibold text-zinc-900">{biz.business_name}</div>
                          <div className="text-xs text-zinc-500">
                            {biz.primary_marketplace_category?.name ?? "İşletme"}{quotaLabel ? ` · ${quotaLabel}` : ""}
                          </div>
                        </button>
                      );
                    })}
                    {searchResults.categories.slice(0, 4).map((category) => (
                      <button
                        key={`category-${category.id}`}
                        type="button"
                        onClick={() => {
                          persistRecentSearch(searchText || category.name);
                          setIsSearchOpen(false);
                          router.push(withSearchParams(`/kategoriler/${category.slug}`, { district }));
                        }}
                        className="group rounded-xl border border-rose-100 bg-rose-50/60 px-3 py-2 text-left transition duration-150 hover:-translate-y-0.5 hover:border-rose-200 hover:bg-rose-50 hover:shadow-sm"
                      >
                        <div className="text-sm font-semibold text-zinc-900">{category.name}</div>
                        <div className="text-xs text-rose-700">Kategori</div>
                      </button>
                    ))}
                    {searchResults.menu_items.slice(0, 6).map((item) => {
                      const quotaLabel = getMenuQuotaDisplayText(item);
                      return (
                        <button
                          key={`menu-${item.id}`}
                          type="button"
                          onClick={() => {
                            persistRecentSearch(searchText || item.name);
                            setIsSearchOpen(false);
                            router.push(withSearchParams(`/isletmeler/${item.business_id}`, { district }));
                          }}
                          className="group rounded-xl border border-zinc-200 px-3 py-2 text-left transition duration-150 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-50 hover:shadow-sm"
                        >
                          <div className="text-sm font-semibold text-zinc-900">{item.name}</div>
                          <div className="text-xs text-zinc-500">
                            {item.business_name} · {item.category_name}{quotaLabel ? ` · ${quotaLabel}` : ""}
                          </div>
                        </button>
                      );
                    })}
                    {searchResults.businesses.length === 0 && searchResults.categories.length === 0 && searchResults.menu_items.length === 0 ? <p className="text-sm text-zinc-500">Sonuç bulunamadı.</p> : null}
                  </div>
                </div>
              ) : null}

              <h3 className="text-2xl font-semibold text-zinc-900">Popüler aramalar</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {POPULAR_SEARCHES.map((term) => (
                  <button
                    key={term}
                    type="button"
                    onClick={() => {
                      setSearchText(term);
                      submitSearch(term);
                    }}
                    className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 transition duration-150 hover:-translate-y-0.5 hover:border-zinc-400 hover:bg-zinc-50 hover:shadow-sm"
                  >
                    {term}
                  </button>
                ))}
              </div>

              {recentSearches.length > 0 ? (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-zinc-500">Son aramalar</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {recentSearches.map((term) => (
                      <button
                        key={`recent-${term}`}
                        type="button"
                        onClick={() => submitSearch(term)}
                        className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {!isAuthenticated && !isBusinessMode ? (
        <LoginDrawer
          isOpen={isLoginDrawerOpen}
          nextPath={loginNextPath}
          onClose={() => {
            setIsLoginDrawerOpen(false);
            setLoginNextPath(undefined);
          }}
        />
      ) : null}
    </header>
  );
}
