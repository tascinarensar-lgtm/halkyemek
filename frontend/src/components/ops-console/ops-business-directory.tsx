"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, LayoutPanelTop, MapPin, PlusCircle, Search, ShieldCheck, Store, UsersRound } from "lucide-react";

import { ProtectedPageShell } from "@/components/layout/protected-page-shell";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { listOpsBusinesses, type OpsBusinessProduct } from "@/features/ops-console/api";
import type { OpsBusinessListItem } from "@/features/ops-console/types";
import { getApiErrorMessage } from "@/lib/api/errors";

function statusText(business: OpsBusinessListItem) {
  if (!business.is_active) return "Pasif";
  if (!business.is_approved) return "Onay bekliyor";
  if (!business.marketplace_is_visible || !business.is_listed) return "Gizli";
  return "Yayında";
}

function statusClassName(business: OpsBusinessListItem) {
  if (!business.is_active) return "bg-zinc-100 text-zinc-500";
  if (!business.is_approved) return "bg-amber-50 text-amber-700";
  if (!business.marketplace_is_visible || !business.is_listed) return "bg-zinc-100 text-zinc-600";
  return "bg-emerald-50 text-emerald-700";
}

function hasValue(value: string | null | undefined) {
  return Boolean(String(value || "").trim());
}

type OpsBusinessDirectoryProps = {
  product: OpsBusinessProduct;
};

const PRODUCT_CONTENT: Record<
  OpsBusinessProduct,
  {
    eyebrow: string;
    title: string;
    description: string;
    createLabel: string;
    createHref: string;
    accentClassName: string;
    badgeClassName: string;
    searchPlaceholder: string;
    emptyDescription: string;
    detailCta: string;
  }
> = {
  halkyemek: {
    eyebrow: "Ops HalkYemek merkezi",
    title: "HalkYemek İşletmelerini Yönet",
    description: "QR, menü, kota, yetki ve yayın akışında çalışan HalkYemek işletmelerini tek yerden düzenle.",
    createLabel: "Yeni HalkYemek işletmesi",
    createHref: "/ops/isletmeler/yeni?product=halkyemek",
    accentClassName: "bg-[#f50555] hover:bg-[#dc004c] shadow-[0_18px_42px_rgba(245,5,85,0.24)]",
    badgeClassName: "bg-rose-50 text-[#f50555]",
    searchPlaceholder: "HalkYemek işletmesi, kategori, yetkili veya e-posta ara",
    emptyDescription: "Aramayı veya filtreyi temizleyerek HalkYemek işletmelerini tekrar görüntüleyebilirsin.",
    detailCta: "HalkYemek paneli",
  },
  halktasarruf: {
    eyebrow: "Ops HalkTasarruf merkezi",
    title: "HalkTasarruf İşletmelerini Yönet",
    description: "Sürpriz paket, teslim saatleri, yetki ve yayın akışında çalışan HalkTasarruf işletmelerini aynı disiplinle yönet.",
    createLabel: "Yeni HalkTasarruf işletmesi",
    createHref: "/ops/isletmeler/yeni?product=halktasarruf",
    accentClassName: "bg-[linear-gradient(135deg,#5B21B6,#7C3AED)] hover:brightness-110 shadow-[0_18px_42px_rgba(109,40,217,0.24)]",
    badgeClassName: "bg-violet-50 text-violet-700",
    searchPlaceholder: "HalkTasarruf işletmesi, kategori, yetkili veya e-posta ara",
    emptyDescription: "Aramayı veya filtreyi temizleyerek HalkTasarruf işletmelerini tekrar görüntüleyebilirsin.",
    detailCta: "HalkTasarruf paneli",
  },
};

export function OpsBusinessDirectory({ product }: OpsBusinessDirectoryProps) {
  const content = PRODUCT_CONTENT[product];
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const params = useMemo(
    () => ({
      product,
      q: q.trim() || undefined,
      payout_onboarding_status: statusFilter || undefined,
    }),
    [product, q, statusFilter],
  );
  const businessesQuery = useQuery({
    queryKey: ["ops", "businesses", product, params],
    queryFn: () => listOpsBusinesses(params),
  });
  const businesses = businessesQuery.data?.results ?? [];

  return (
    <ProtectedPageShell requireAdmin>
      <main className="bg-white py-6 sm:py-8">
        <Container size="wide" className="space-y-6">
          <section className="flex flex-col gap-4 border-b border-zinc-100 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${product === "halktasarruf" ? "text-violet-700" : "text-[#f50555]"}`}>{content.eyebrow}</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.055em] text-zinc-950 sm:text-4xl">{content.title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{content.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {product === "halktasarruf" ? (
                <Link
                  href="/ops/halktasarruf-firsatlari"
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-5 py-3 text-sm font-semibold text-violet-800 transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-100"
                >
                  <LayoutPanelTop className="h-4 w-4" />
                  Fırsat kayıtlarını aç
                </Link>
              ) : null}
              <Link href={content.createHref} className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 ${content.accentClassName}`}>
                <PlusCircle className="h-4 w-4" />
                {content.createLabel}
              </Link>
            </div>
          </section>

          <section className="rounded-[30px] border border-zinc-100 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.055)] sm:p-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
              <label className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
                <input
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder={content.searchPlaceholder}
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 py-3 pl-11 pr-4 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white focus:ring-4 focus:ring-zinc-100"
                />
              </label>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-950 outline-none transition focus:border-zinc-300 focus:bg-white focus:ring-4 focus:ring-zinc-100"
              >
                <option value="">Tüm ödeme durumları</option>
                <option value="NONE">Hazır değil</option>
                <option value="PENDING">Beklemede</option>
                <option value="APPROVED">Onaylı</option>
                <option value="REJECTED">Reddedildi</option>
                <option value="NEEDS_REVIEW">İnceleme gerekiyor</option>
              </select>
            </div>
          </section>

          {businessesQuery.isPending ? <LoadingSkeleton /> : null}
          {businessesQuery.isError ? <ErrorState title="İşletmeler yüklenemedi" description={getApiErrorMessage(businessesQuery.error)} /> : null}

          {businessesQuery.data ? (
            businesses.length ? (
              <section className="grid gap-3">
                {businesses.map((business) => (
                  <article
                    key={business.id}
                    className="rounded-[30px] border border-zinc-100 bg-white p-4 shadow-[0_16px_48px_rgba(15,23,42,0.052)] transition hover:-translate-y-0.5 hover:border-zinc-200 hover:shadow-[0_24px_70px_rgba(15,23,42,0.085)] sm:p-5"
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-xl font-semibold tracking-[-0.045em] text-zinc-950">{business.business_name}</h2>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClassName(business)}`}>{statusText(business)}</span>
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${content.badgeClassName}`}>#{business.id}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-zinc-600">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1">
                            <Store className="h-3.5 w-3.5 text-zinc-400" />
                            {business.category || "Kategori yok"}
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1">
                            <MapPin className="h-3.5 w-3.5 text-zinc-400" />
                            {business.address_line || business.district || "Konum eklenmedi"}
                          </span>
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1">
                            <UsersRound className="h-3.5 w-3.5 text-zinc-400" />
                            {business.active_membership_count} yetkili
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-2 text-xs text-zinc-500 sm:grid-cols-3 xl:w-[430px]">
                        <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                          <p className="font-semibold text-zinc-700">IBAN</p>
                          <p className="mt-1">{hasValue(business.kyc_iban) ? "Tanımlı" : "Eksik"}</p>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                          <p className="font-semibold text-zinc-700">Hesap sahibi</p>
                          <p className="mt-1">
                            {hasValue(business.kyc_contact_name) || hasValue(business.kyc_contact_surname) ? `${business.kyc_contact_name || ""} ${business.kyc_contact_surname || ""}`.trim() : "Eksik"}
                          </p>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 px-3 py-2">
                          <p className="font-semibold text-zinc-700">Ürün desteği</p>
                          <p className="mt-1">
                            {[
                              business.supports_halkyemek ? "HalkYemek" : null,
                              business.supports_halktasarruf ? "HalkTasarruf" : null,
                            ]
                              .filter(Boolean)
                              .join(" + ") || "Kapalı"}
                          </p>
                        </div>
                      </div>

                      <Link
                        href={`/ops/isletmeler/${business.id}`}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-zinc-800"
                      >
                        <ShieldCheck className="h-4 w-4" />
                        {content.detailCta}
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </div>
                  </article>
                ))}
              </section>
            ) : (
              <EmptyState title="İşletme bulunamadı" description={content.emptyDescription} />
            )
          ) : null}
        </Container>
      </main>
    </ProtectedPageShell>
  );
}
