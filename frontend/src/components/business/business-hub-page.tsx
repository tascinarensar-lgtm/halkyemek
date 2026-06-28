"use client";

import Link from "next/link";
import { ArrowDown, ArrowRight, CheckCircle2, ShieldCheck, Store } from "lucide-react";

import { getRoleLabel, isManagementRole } from "@/components/business/business-role";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { resolveBusinessContext, type BusinessWorkspace } from "@/features/business-operations/session";
import { useSession } from "@/hooks/use-session";

function getWorkspaceRoleLabel(role: string | null | undefined) {
  if (role === "OWNER") return "İşletme sahibi";
  if (role === "MANAGER") return "Yönetici";
  if (role === "CASHIER") return "Kasiyer";
  return getRoleLabel(role as never);
}

type BusinessHubPageProps = {
  workspace: BusinessWorkspace;
};

export function BusinessHubPage({ workspace }: BusinessHubPageProps) {
  const session = useSession();
  const context = resolveBusinessContext(session.data, undefined, workspace);
  const isOpsAdmin = session.data?.user?.role === "ADMIN";
  const redirectBase = workspace === "halktasarruf" ? "/halktasarruf/isletme" : "/isletme";
  const opsFallbackHref = workspace === "halktasarruf" ? "/ops/surpriz-paketler" : "/ops/isletmeler";
  const accentClassName = workspace === "halktasarruf" ? "text-violet-700 bg-violet-50" : "text-[#f50555] bg-rose-50";
  const heroAccentClassName = workspace === "halktasarruf" ? "bg-violet-600 hover:bg-violet-700 shadow-[0_18px_40px_rgba(109,40,217,0.28)]" : "bg-[#f50555] hover:bg-[#dc004c] shadow-[0_18px_40px_rgba(245,5,85,0.24)]";
  const title = workspace === "halktasarruf" ? "HalkTasarruf işletme alanı" : "İşletme paneli";
  const intro = workspace === "halktasarruf"
    ? "Teslim saatleri, sürpriz paketler ve operasyon akışını yöneteceğin işletmeyi seç."
    : "QR, menü, kota ve operasyon akışını yöneteceğin işletmeyi seç.";

  if (session.isPending && !session.data) {
    return (
      <PageContainer className="bg-white">
        <LoadingSkeleton />
      </PageContainer>
    );
  }

  if (!context.businesses.length) {
    if (isOpsAdmin) {
      return (
        <PageContainer className="space-y-6 bg-white">
          <section className="relative overflow-hidden rounded-[30px] border border-zinc-100 bg-white p-6 shadow-[0_18px_55px_rgba(15,23,42,0.06)] sm:p-8">
            <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${accentClassName}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Ops hesabı
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-zinc-950">
              {workspace === "halktasarruf" ? "HalkTasarruf işletmelerini ops panelinden yönet" : "İşletmeleri ops panelinden yönet"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
              Bu hesapta bu ürün için doğrudan işletme yetkisi görünmüyor. Ops hesabıyla kayıt açma, yetki verme ve içerik düzenleme için ilgili yönetim alanını kullan.
            </p>
            <Link
              href={opsFallbackHref}
              className={`mt-5 inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 ${heroAccentClassName}`}
            >
              Ops ekranını aç
              <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
        </PageContainer>
      );
    }

    return (
      <PageContainer className="space-y-6 bg-white">
        <section className="rounded-[30px] border border-zinc-100 bg-white p-6 shadow-[0_18px_55px_rgba(15,23,42,0.06)] sm:p-8">
          <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${accentClassName}`}>
            <ShieldCheck className="h-3.5 w-3.5" />
            {title}
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] text-zinc-950">
            Bu hesapta uygun işletme yetkisi yok
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600">
            Bu paneli kullanabilmek için hesabına bu ürün için aktif işletme yetkisi tanımlanması gerekir.
          </p>
        </section>

        <EmptyState
          title="İşletme erişimi bulunamadı"
          description="Yetki eklendiğinde bu ekran otomatik olarak ilgili işletme paneline dönüşür."
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer className="space-y-6 bg-white">
      <section className="relative overflow-hidden rounded-[30px] bg-zinc-950 p-6 text-white shadow-[0_24px_70px_rgba(15,23,42,0.16)] sm:p-8">
        <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/78 ring-1 ring-white/12">
              <Store className={`h-3.5 w-3.5 ${workspace === "halktasarruf" ? "text-violet-300" : "text-[#ff5a8f]"}`} />
              {title}
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">
              Çalışacağın işletmeyi seç
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">
              {intro}
            </p>
          </div>

          <a
            href="#isletme-listesi"
            className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 ${heroAccentClassName}`}
          >
            Aktif panele git
            <ArrowDown className="h-4 w-4" />
          </a>
        </div>
      </section>

      <section id="isletme-listesi" className="scroll-mt-28 space-y-3">
        {context.businesses.map((business) => {
          const isActive = business.id === context.resolvedBusinessId;
          const canManage = isManagementRole(business.member_role);

          return (
            <Link
              key={business.id}
              href={`${redirectBase}/${business.id}`}
              className="group block rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_54px_rgba(15,23,42,0.055)] transition hover:-translate-y-0.5 hover:border-zinc-200 hover:shadow-[0_24px_70px_rgba(15,23,42,0.09)] sm:p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-2xl font-semibold tracking-[-0.045em] text-zinc-950">{business.name}</h2>
                    {isActive ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-zinc-950 px-3 py-1 text-xs font-semibold text-white">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Aktif
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-sm text-zinc-500">
                    {getWorkspaceRoleLabel(business.member_role)} · {canManage ? "Yönetim ve operasyon" : "Kasiyer operasyonu"}
                  </p>
                </div>
                <span className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition ${workspace === "halktasarruf" ? "bg-violet-50 text-violet-700 group-hover:bg-violet-600 group-hover:text-white" : "bg-rose-50 text-[#f50555] group-hover:bg-[#f50555] group-hover:text-white"}`}>
                  Panele geç
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </PageContainer>
  );
}
