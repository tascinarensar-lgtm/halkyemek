"use client";

import Link from "next/link";
import {
  Bell,
  CreditCard,
  LayoutGrid,
  LogOut,
  MapPin,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserRound,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";

import { getRoleLabel, isManagementRole } from "@/components/business/business-role";
import { useSession } from "@/hooks/use-session";
import { notifyAuthStateCleared } from "@/lib/auth/events";
import { getAnonymousSessionState } from "@/lib/auth/session-state";
import { SESSION_QUERY_KEY } from "@/lib/query/keys";

const publicNavigation = [
  { href: "/kategoriler", label: "Kategoriler", icon: LayoutGrid },
  { href: "/isletmeler", label: "İşletmeler", icon: Store },
];

const authenticatedCustomerNavigation = [
  { href: "/sepet", label: "Sepet", icon: ShoppingCart },
  { href: "/siparislerim", label: "Siparişlerim", icon: ReceiptText },
  { href: "/cuzdan", label: "Cüzdan", icon: CreditCard },
  { href: "/bildirimler", label: "Bildirimler", icon: Bell },
  { href: "/hesabim", label: "Hesabım", icon: UserRound },
];

function isActiveRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isBusinessRoute(pathname: string) {
  return pathname === "/isletme" || pathname.startsWith("/isletme/");
}

export function AppHeader() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  const isAuthenticated = session.data?.isAuthenticated ?? false;
  const isBusinessMode = isBusinessRoute(pathname);
  const username = session.data?.user?.username?.trim() || "";

  const activeBusiness =
    session.data?.businesses.find((item) => item.id === session.data?.activeBusinessId) ??
    session.data?.businesses[0] ??
    null;
  const activeBusinessId = activeBusiness?.id ?? null;
  const activeBusinessRole = activeBusiness?.member_role ?? null;
  const canManageActiveBusiness = isManagementRole(activeBusinessRole);

  const defaultNavigation = [
    ...publicNavigation,
    ...(isAuthenticated ? authenticatedCustomerNavigation : []),
    ...(session.data?.hasBusinessMembership ? [{ href: "/isletme", label: "İşletme Alanı", icon: Store }] : []),
    ...(session.data?.user?.role === "ADMIN" ? [{ href: "/ops", label: "Ops", icon: ShieldCheck }] : []),
  ];

  const businessNavigation = [
    { href: "/isletme", label: "İşletme Alanı", icon: Store },
    ...(activeBusinessId
      ? [
          { href: `/isletme/${activeBusinessId}`, label: canManageActiveBusiness ? "Yönetim Özeti" : "Operasyon Özeti", icon: LayoutGrid },
          { href: `/isletme/${activeBusinessId}/gecmis`, label: "İşlem Geçmişi", icon: ReceiptText },
          { href: `/isletme/${activeBusinessId}/profil`, label: "İşletme Profili", icon: UserRound },
          ...(canManageActiveBusiness
            ? [{ href: `/isletme/${activeBusinessId}/yonetim/menu`, label: "Menü Yönetimi", icon: Store }]
            : []),
        ]
      : []),
    ...(session.data?.user?.role === "ADMIN" ? [{ href: "/ops", label: "Ops", icon: ShieldCheck }] : []),
  ];

  const navigation = isBusinessMode ? businessNavigation : defaultNavigation;

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      notifyAuthStateCleared("logout");
      queryClient.setQueryData(SESSION_QUERY_KEY, getAnonymousSessionState());
      router.push("/");
      router.refresh();
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/80 bg-white/95 backdrop-blur">
      {isBusinessMode ? (
        <div className="border-b border-zinc-800 bg-zinc-950 text-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-medium text-white">
                <ShieldCheck className="h-3.5 w-3.5" />
                İşletme modu aktif
              </div>
              <p className="text-sm text-zinc-200">
                {activeBusiness
                  ? `${activeBusiness.name} üzerinde ${getRoleLabel(activeBusinessRole)} yetkisiyle çalışıyorsun.`
                  : "İşletme paneline giriş yapıyorsun; bu alanda müşteri akışından ayrı bir çalışma yüzeyi kullanılır."}
              </p>
            </div>

            <div className="text-sm text-zinc-300">
              {canManageActiveBusiness ? "Yönetim ve operasyon yüzeyleri açık." : "Kasiyer odaklı operasyon yüzeyi açık."}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <Link href={isBusinessMode ? "/isletme" : "/"} className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-sm font-semibold text-white shadow-sm">
                HY
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold text-zinc-950">{isBusinessMode ? "HalkYemek İşletme" : "HalkYemek"}</div>
                <div className="hidden text-xs text-zinc-500 sm:block">
                  {isBusinessMode ? "Rol bazlı operasyon ve yönetim alanı" : "Uygun fiyatlı özel menülere daha kolay erişim"}
                </div>
              </div>
            </Link>

            {!isBusinessMode ? (
              <div className="hidden items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900 md:inline-flex lg:hidden">
                <MapPin className="h-3.5 w-3.5" />
                İstanbul/Beylikdüzü aktif
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 lg:justify-end">
            {!isBusinessMode ? (
              <div className="hidden items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900 lg:inline-flex">
                <MapPin className="h-3.5 w-3.5" />
                İstanbul/Beylikdüzü aktif
              </div>
            ) : null}

            {isAuthenticated ? (
              <div className="flex items-center gap-2">
                {isBusinessMode ? (
                  <>
                    <Link
                      href="/"
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"
                    >
                      Müşteri alanı
                    </Link>
                    <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-900">
                      <UserRound className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {username || "Hesap"}
                        {activeBusinessRole ? ` · ${getRoleLabel(activeBusinessRole)}` : ""}
                      </span>
                    </div>
                  </>
                ) : username ? (
                  <Link
                    href="/hesabim"
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"
                  >
                    <UserRound className="h-4 w-4" />
                    <span className="hidden sm:inline">{username}</span>
                  </Link>
                ) : null}

                <button
                  type="button"
                  onClick={handleLogout}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
                >
                  <LogOut className="h-4 w-4" />
                  Çıkış
                </button>
              </div>
            ) : (
              <Link href="/giris" className="rounded-xl bg-zinc-950 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Giriş yap
              </Link>
            )}
          </div>
        </div>

        <nav className="flex gap-2 overflow-x-auto pb-1">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = isActiveRoute(pathname, item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                  active
                    ? "border-zinc-950 bg-zinc-950 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:text-zinc-950"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
