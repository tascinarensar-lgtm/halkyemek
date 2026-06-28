"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Bell, ClipboardList, LayoutDashboard, PackageOpen, Store, UtensilsCrossed } from "lucide-react";

import { BusinessManagedContentModal, type BusinessManagedContentKind } from "@/components/business/business-managed-content-modal";
import { getRoleLabel, isManagementRole } from "@/components/business/business-role";
import { BusinessSwitcher } from "@/components/business/business-switcher";
import { CheckoutSessionScanner } from "@/components/business/checkout-session-scanner";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils/cn";
import { resolveBusinessContext, type BusinessWorkspace } from "@/features/business-operations/session";

function getRoleHint(role: unknown) {
  if (role === "OWNER") return "Tam yetki";
  if (role === "MANAGER") return "Yönetici";
  if (role === "CASHIER") return "Kasa";
  return "İşletme";
}

function resolveWorkspace(pathname: string): BusinessWorkspace {
  return pathname === "/halktasarruf/isletme" || pathname.startsWith("/halktasarruf/isletme/")
    ? "halktasarruf"
    : "halkyemek";
}

export function BusinessPanelShell({ businessId, children }: { businessId?: number | null; children: ReactNode }) {
  const pathname = usePathname();
  const workspace = resolveWorkspace(pathname);
  const session = useSession();
  const context = resolveBusinessContext(session.data, businessId, workspace);
  const [openContent, setOpenContent] = useState<BusinessManagedContentKind | null>(null);
  const isOpsAdmin = session.data?.user?.role === "ADMIN";
  const isHalkTasarruf = workspace === "halktasarruf";
  const redirectBase = isHalkTasarruf ? "/halktasarruf/isletme" : "/isletme";

  if (session.isPending && !session.data) {
    return <div className="h-28 animate-pulse rounded-[26px] bg-zinc-100" />;
  }

  if (!context.hasMembership) {
    return (
      <EmptyState
        title={isHalkTasarruf ? "HalkTasarruf işletme yetkisi bulunamadı" : "İşletme yetkisi bulunamadı"}
        description={
          isHalkTasarruf
            ? "Bu paneli kullanabilmek için hesabında aktif bir HalkTasarruf işletme yetkisi olması gerekir."
            : "Bu paneli kullanabilmek için hesabında aktif bir işletme üyeliği olması gerekir."
        }
      />
    );
  }

  if (businessId != null && !context.hasRequestedAccess) {
    return (
      <Card className="border-zinc-200 bg-white shadow-sm">
        <CardContent className="space-y-4 p-6">
          <div>
            <h2 className="text-xl font-semibold tracking-[-0.03em] text-zinc-950">Bu işletmeye erişim görünmüyor</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Adresteki işletme bu ürün alanında sana tanımlı değil.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href={redirectBase} className="rounded-xl bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200">
              İşletme seçimine dön
            </Link>
            {context.resolvedBusinessId ? (
              <Link href={`${redirectBase}/${context.resolvedBusinessId}`} className="rounded-xl bg-[#f50555] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#dc004c]">
                Erişebildiğim panele git
              </Link>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeBusiness = context.resolvedBusiness;
  const activeBusinessId = context.resolvedBusinessId;
  const canManageContent = isManagementRole(activeBusiness?.member_role);

  const navigation =
    activeBusinessId && canManageContent
      ? isHalkTasarruf
        ? [
            {
              href: `${redirectBase}/${activeBusinessId}/surpriz-paketler`,
              label: "Sürpriz Paketler",
              icon: PackageOpen,
              mode: "link" as const,
            },
          ]
        : [
            {
              kind: "menu" as const,
              href: `${redirectBase}/${activeBusinessId}?panel=menu`,
              label: "Menüler",
              icon: UtensilsCrossed,
              mode: "modal" as const,
            },
          ]
      : [];

  return (
    <div className="space-y-5">
      <Card className="border-zinc-200 border-t-4 border-t-[#f50555] bg-white shadow-[0_14px_45px_rgba(15,23,42,0.05)]">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl", isHalkTasarruf ? "bg-violet-50 text-violet-700" : "bg-rose-50 text-[#f50555]")}>
                  {isHalkTasarruf ? <PackageOpen className="h-5 w-5" /> : <Store className="h-5 w-5" />}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">
                    {isHalkTasarruf ? "HALKTASARRUF İŞLETME PANELİ" : "İŞLETME PANELİ"}
                  </p>
                  <h1 className="truncate text-xl font-semibold tracking-[-0.03em] text-zinc-950">{activeBusiness?.name || "İşletme seç"}</h1>
                </div>
                <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-600">{getRoleHint(activeBusiness?.member_role)}</span>
              </div>
            </div>
            <div className="w-full xl:max-w-[360px]">
              <BusinessSwitcher businesses={context.businesses} activeBusinessId={activeBusinessId} workspace={workspace} />
            </div>
          </div>

          {navigation.length ? (
            <div className="hy-scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active =
                  item.mode === "modal"
                    ? openContent === item.kind || pathname === item.href
                    : pathname === item.href || pathname.startsWith(`${item.href}/`);

                if (item.mode === "link") {
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition",
                        active ? "bg-zinc-950 text-white" : isHalkTasarruf ? "bg-violet-50 text-violet-800 hover:bg-violet-100" : "bg-zinc-50 text-zinc-700 hover:bg-rose-50 hover:text-[#f50555]",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                }

                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => setOpenContent(item.kind)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition",
                      active ? "bg-zinc-950 text-white" : "bg-zinc-50 text-zinc-700 hover:bg-rose-50 hover:text-[#f50555]",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {isOpsAdmin ? (
            <div className={cn("rounded-[26px] border p-3 sm:p-4", isHalkTasarruf ? "border-violet-100 bg-violet-50/55" : "border-rose-100 bg-[#fff7fa]")}>
              <div className="mb-3 flex items-center gap-2">
                <span className={cn("inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-white shadow-sm", isHalkTasarruf ? "text-violet-700" : "text-[#f50555]")}>
                  <LayoutDashboard className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-zinc-950">Ops yönetimi</p>
                  <p className="text-xs text-zinc-500">Bildirim, kayıt ve işletme içerikleri için hızlı geçiş.</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                {[
                  { href: "/ops/isletmeler", label: "HalkYemek işletmeleri", icon: Store },
                  { href: "/ops/surpriz-paketler", label: "HalkTasarruf işletmeleri", icon: PackageOpen },
                  { href: "/ops/halktasarruf-firsatlari", label: "Fırsat kayıtları", icon: ClipboardList },
                  { href: "/ops/bildirimler/yayinla", label: "Bildirim yayınla", icon: Bell },
                  ...(activeBusinessId && !isHalkTasarruf ? [{ href: `/ops/isletmeler/${activeBusinessId}/icerik`, label: "Bu işletmenin menüleri", icon: UtensilsCrossed }] : []),
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-white px-3 py-2.5 text-center text-sm font-semibold text-zinc-800 shadow-sm ring-1 ring-zinc-100 transition hover:-translate-y-0.5 hover:text-zinc-950 hover:shadow-md"
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          {activeBusinessId ? <CheckoutSessionScanner businessId={activeBusinessId} /> : null}
        </aside>

        <main className="min-w-0">{children}</main>
      </div>

      {activeBusinessId && openContent ? (
        <BusinessManagedContentModal businessId={activeBusinessId} kind={openContent} onClose={() => setOpenContent(null)} />
      ) : null}
    </div>
  );
}
