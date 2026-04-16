"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { BusinessSwitcher } from "@/components/business/business-switcher";
import { CheckoutSessionScanner } from "@/components/business/checkout-session-scanner";
import { getRoleLabel, getRoleSummary, isManagementRole } from "@/components/business/business-role";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils/cn";
import { resolveBusinessContext } from "@/features/business-operations/session";

export function BusinessPanelShell({ businessId, children }: { businessId?: number | null; children: ReactNode }) {
  const pathname = usePathname();
  const session = useSession();
  const context = resolveBusinessContext(session.data, businessId);

  if (session.isPending && !session.data) {
    return <div className="h-24 animate-pulse rounded-3xl bg-zinc-100" />;
  }

  if (!context.hasMembership) {
    return (
      <EmptyState
        title="İşletme yetkisi bulunamadı"
        description="Bu paneli kullanabilmek için hesabında aktif bir işletme üyeliği olması gerekir."
      />
    );
  }

  if (businessId != null && !context.hasRequestedAccess) {
    return (
      <div className="space-y-4">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Bu işletmeye erişim görünmüyor</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Adresteki işletme seçimi, bu oturumda sana tanımlı işletmeler arasında bulunamadı. Güvenli geçiş için işletme seçim ekranına dönebilir veya erişebildiğin panele geçebilirsin.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/isletme" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                İşletme seçimine dön
              </Link>
              {context.resolvedBusinessId ? (
                <Link href={`/isletme/${context.resolvedBusinessId}`} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                  Erişebildiğim panele git
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const activeBusiness = context.resolvedBusiness;
  const activeBusinessId = context.resolvedBusinessId;
  const canManageContent = isManagementRole(activeBusiness?.member_role);

  const sections = activeBusinessId
    ? [
        {
          title: "Operasyon alanı",
          description: "Kasadaki işlem akışı, günlük hareketler ve işletme görünümü burada toplanır.",
          items: [
            { href: `/isletme/${activeBusinessId}`, label: "Operasyon özeti" },
            { href: `/isletme/${activeBusinessId}/gecmis`, label: "İşlem geçmişi" },
            { href: `/isletme/${activeBusinessId}/profil`, label: "İşletme profili" },
          ],
        },
        {
          title: "Yönetim alanı",
          description: canManageContent
            ? "Menü, kategori, teklif ve görsel alanlarını bu bölümden yönetebilirsin."
            : "Bu bölüm sahip ve yönetici rollerine açıktır. Kasiyer rolü yalnızca operasyon ekranlarını kullanır.",
          items: [
            { href: `/isletme/${activeBusinessId}/yonetim/kategoriler`, label: "Kategori yönetimi" },
            { href: `/isletme/${activeBusinessId}/yonetim/menu`, label: "Menü yönetimi" },
            { href: `/isletme/${activeBusinessId}/yonetim/teklifler`, label: "Teklif yönetimi" },
            { href: `/isletme/${activeBusinessId}/yonetim/medya`, label: "Görsel yönetimi" },
          ],
        },
      ]
    : [];

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(244,244,245,0.96))] shadow-sm">
          <CardContent className="space-y-5 p-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
              İşletme modu
            </div>

            <div>
              <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Operasyon ve yönetim alanı</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Bu yüzey, müşteri deneyiminden ayrı çalışır. Rolüne göre sadeleştirilmiş operasyon veya yönetim ekranlarını burada görürsün.
              </p>
            </div>

            <BusinessSwitcher businesses={context.businesses} activeBusinessId={activeBusinessId} />

            <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Aktif işletme</p>
              <p className="mt-2 text-base font-semibold text-zinc-950">{activeBusiness?.name || "Seçim bekleniyor"}</p>
              <p className="mt-1 text-sm text-zinc-600">Rol: {getRoleLabel(activeBusiness?.member_role)}</p>
              <p className="mt-3 text-sm leading-6 text-zinc-600">{getRoleSummary(activeBusiness?.member_role)}</p>
            </div>
          </CardContent>
        </Card>

        {activeBusinessId ? <CheckoutSessionScanner businessId={activeBusinessId} /> : null}

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-5 p-5">
            {sections.map((section) => (
              <div key={section.title} className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{section.title}</p>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">{section.description}</p>
                </div>

                <div className="space-y-2">
                  {section.items.map((item) => {
                    const isDashboardRoot = item.href === `/isletme/${activeBusinessId}`;
                    const isActive = isDashboardRoot ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
                    const isManagementItem = item.href.includes("/yonetim/");
                    const disabled = isManagementItem && !canManageContent;

                    if (disabled) {
                      return (
                        <div key={item.href} className="rounded-xl border border-dashed border-zinc-200 px-3 py-2 text-sm text-zinc-400">
                          {item.label}
                        </div>
                      );
                    }

                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          "block rounded-xl px-3 py-2 text-sm font-medium transition",
                          isActive ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200",
                        )}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            {!canManageContent ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                Bu oturumda yönetim alanları kapalı. Kasiyer rolü ile temel operasyon akışlarını kullanabilir, içerik değişiklikleri için yönetici veya sahip rolüyle giriş yapabilirsin.
              </div>
            ) : null}

            {activeBusinessId ? (
              <Link href="/isletme" className="block rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50">
                İşletme seçimine dön
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </aside>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
