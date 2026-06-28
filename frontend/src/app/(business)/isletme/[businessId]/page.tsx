"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  Clock3,
  ListChecks,
  QrCode,
  ReceiptText,
  ShieldCheck,
  Store,
  UtensilsCrossed,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

import { BusinessManagedContentModal, type BusinessManagedContentKind } from "@/components/business/business-managed-content-modal";
import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { getRoleLabel, isManagementRole } from "@/components/business/business-role";
import { AmountText } from "@/components/ui/amount-text";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { QueryState } from "@/components/ui/query-state";
import { StatusChip } from "@/components/ui/status-chip";
import { getBusinessDashboardSummary } from "@/features/business-operations/api";
import type { BusinessDashboardSummary } from "@/features/business-operations/types";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

function getSessionStatusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Onay bekliyor";
    case "CONFIRMED":
      return "Hazır";
    case "CONSUMED":
      return "Tamamlandı";
    default:
      return status;
  }
}

function getSessionStatusTone(status: string) {
  switch (status) {
    case "PENDING":
      return "warning" as const;
    case "CONFIRMED":
    case "CONSUMED":
      return "success" as const;
    default:
      return "default" as const;
  }
}

function getDistrictLabel(district: string) {
  if (district === "BEYLIKDUZU") return "İstanbul / Beylikdüzü";
  return district || "Bölge belirtilmedi";
}

function getListingTypeLabel(listingType: string) {
  if (listingType === "CONTRACTED") return "Anlaşmalı işletme";
  if (listingType === "VOLUNTEER") return "Gönüllü işletme";
  return listingType || "Standart işletme";
}

function getWorkspaceRoleLabel(role: string | null | undefined) {
  if (role === "OWNER") return "İşletme sahibi";
  if (role === "MANAGER") return "Yönetici";
  if (role === "CASHIER") return "Kasiyer";
  return getRoleLabel(role as never);
}

function getCompactToken(token: string) {
  if (!token) return "-";
  if (token.length <= 10) return token;
  return `${token.slice(0, 5)}...${token.slice(-4)}`;
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: ReactNode; icon: LucideIcon }) {
  return (
    <div className="rounded-[24px] border border-zinc-100 bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.055)]">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555]">
          <Icon className="h-5 w-5" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{label}</p>
          <div className="mt-1 text-2xl font-semibold tracking-[-0.045em] text-zinc-950">{value}</div>
        </div>
      </div>
    </div>
  );
}

function ProfileCardModal({ dashboard, onClose }: { dashboard: BusinessDashboardSummary; onClose: () => void }) {
  const role = dashboard.business.member_role;
  const details = [
    { label: "Yetki", value: getWorkspaceRoleLabel(role) },
    { label: "Bölge", value: getDistrictLabel(dashboard.business.district) },
    { label: "İşletme türü", value: getListingTypeLabel(dashboard.showcase.listing_type) },
    { label: "Pazaryeri", value: dashboard.showcase.marketplace_is_visible ? "Yayında" : "Kapalı" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-8" onClick={onClose}>
      <section
        className="hy-mobile-sheet w-full max-w-2xl overflow-hidden rounded-t-[32px] bg-white shadow-[0_32px_100px_rgba(15,23,42,0.30)] ring-1 ring-white/40 sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative overflow-hidden bg-zinc-950 p-5 text-white sm:p-8">
          <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-[#f50555]/30 blur-2xl" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg transition hover:scale-105 hover:bg-rose-50"
            aria-label="Profil kartını kapat"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="relative z-10 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/78 ring-1 ring-white/12">
            <Store className="h-3.5 w-3.5 text-[#ff5a8f]" />
            Profil
          </div>
          <h2 className="relative z-10 mt-5 pr-12 text-2xl font-semibold tracking-[-0.055em] sm:text-4xl">{dashboard.business.name}</h2>
        </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
          {details.map((item) => (
            <div key={item.label} className="rounded-[22px] border border-zinc-100 bg-zinc-50 p-4 shadow-[0_12px_34px_rgba(15,23,42,0.045)]">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{item.label}</p>
              <p className="mt-2 font-semibold text-zinc-950">{item.value}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function BusinessDashboardPage() {
  const params = useParams<{ businessId: string }>();
  const searchParams = useSearchParams();
  const requestedPanel = searchParams.get("panel");
  const businessId = Number(params.businessId);
  const [profileOpen, setProfileOpen] = useState(false);
  const [contentModal, setContentModal] = useState<BusinessManagedContentKind | null>(null);

  const dashboardQuery = useQuery({
    queryKey: ["business-operations", businessId, "dashboard"],
    queryFn: () => getBusinessDashboardSummary(businessId),
    enabled: Number.isFinite(businessId),
  });

  useEffect(() => {
    if (requestedPanel === "menu") {
      setContentModal("menu");
    }
  }, [requestedPanel]);

  return (
    <PageContainer className="bg-white">
      <BusinessPanelShell businessId={businessId}>
        <QueryState
          isPending={dashboardQuery.isPending}
          isError={dashboardQuery.isError}
          error={dashboardQuery.error}
          data={dashboardQuery.data}
          errorTitle="İşletme paneli yüklenemedi"
          errorDescription={getApiErrorMessage(dashboardQuery.error)}
          emptyTitle="İşletme verisi bulunamadı"
          emptyDescription="Panel açıldı ancak gösterilebilir işletme verisi dönmedi."
        >
          {(dashboard) => {
            const role = dashboard.business.member_role;
            const canManageContent = isManagementRole(role);
            const pendingCount = dashboard.sessions.pending.length;
            const consumedCount = dashboard.sessions.latest_consumed.length;
            const managementCards = [
              { kind: "menu" as const, title: "Menüler", description: "İşletmenin yayınlanan menüleri.", icon: UtensilsCrossed },
            ];

            return (
              <div className="space-y-6">
                <section className="relative overflow-hidden rounded-[28px] bg-zinc-950 p-5 text-white shadow-[0_24px_70px_rgba(15,23,42,0.16)] sm:rounded-[32px] sm:p-8">
                  <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#f50555]/24 blur-2xl" />
                  <div className="relative z-10 flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
                    <div className="max-w-3xl">
                      <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/78 ring-1 ring-white/12">
                        <ShieldCheck className="h-3.5 w-3.5 text-[#ff5a8f]" />
                        İşletme paneli
                      </div>
                      <h1 className="mt-5 text-3xl font-semibold tracking-[-0.06em] sm:text-5xl">{dashboard.business.name}</h1>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-zinc-950">{getWorkspaceRoleLabel(role)}</span>
                        <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/85 ring-1 ring-white/12">{getDistrictLabel(dashboard.business.district)}</span>
                        <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/85 ring-1 ring-white/12">
                          {dashboard.showcase.marketplace_is_visible ? "Yayında" : "Kapalı"}
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[330px]">
                      <a href="#islem-gecmisi" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(245,5,85,0.28)] transition hover:-translate-y-0.5 hover:bg-[#dc004c]">
                        İşlem geçmişi
                        <ArrowDown className="h-4 w-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setProfileOpen(true)}
                        className="inline-flex items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:-translate-y-0.5 hover:bg-rose-50"
                      >
                        Profil
                      </button>
                    </div>
                  </div>
                </section>

                <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Bekleyen QR" value={pendingCount} icon={QrCode} />
                  <MetricCard label="Bugün teslim" value={dashboard.consume_today.count} icon={ListChecks} />
                  <MetricCard label="Bugün tahsilat" value={<AmountText amount={dashboard.consume_today.total_charged_amount} />} icon={Wallet} />
                  <MetricCard label="Son teslim" value={consumedCount} icon={ReceiptText} />
                </section>

                <section className="grid gap-6 xl:grid-cols-[1.08fr_0.92fr]">
                  <div className="space-y-6">
                    <div className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.06)] sm:p-6">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-900">Bekleyen QR işlemleri</h2>
                        <StatusChip label={`${pendingCount} kayıt`} tone={pendingCount > 0 ? "warning" : "default"} />
                      </div>

                      <div className="mt-5">
                        {pendingCount ? (
                          <div className="space-y-3">
                            {dashboard.sessions.pending.map((item) => (
                              <Link
                                key={item.id}
                                href={`/isletme/${businessId}/tuket/${item.token}`}
                                className="block rounded-[22px] border border-zinc-100 bg-zinc-50 p-4 transition hover:-translate-y-0.5 hover:border-[#f50555]/20 hover:bg-white hover:shadow-[0_16px_42px_rgba(15,23,42,0.08)]"
                              >
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate font-semibold text-zinc-950">Kod: {item.cashier_code || item.token}</p>
                                      <StatusChip label={getSessionStatusLabel(item.status)} tone={getSessionStatusTone(item.status)} />
                                    </div>
                                    <p className="mt-2 text-sm text-zinc-500">
                                      {item.item_count} ürün · Son geçerlilik: {formatDateTime(item.expires_at)}
                                    </p>
                                  </div>
                                  <div className="flex items-center justify-between gap-4 sm:block sm:text-right">
                                    <div className="font-semibold text-zinc-950"><AmountText amount={item.total_payable_amount} /></div>
                                    <span className="mt-0 inline-flex items-center gap-1 text-sm font-semibold text-[#f50555] sm:mt-2">
                                      Onaya git
                                      <ArrowRight className="h-4 w-4" />
                                    </span>
                                  </div>
                                </div>
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <EmptyState title="Şu an bekleyen QR yok" description="Yeni QR ya da kasa kodu geldiğinde bu alan güncellenir." />
                        )}
                      </div>
                    </div>
                    {canManageContent ? (
                      <div className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.06)] sm:p-6">
                        <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-900">Yönetim paneli</h2>
                        <div className="mt-5 grid gap-3">
                          {managementCards.map((item) => {
                            const Icon = item.icon;
                            return (
                              <button
                                key={item.kind}
                                type="button"
                                onClick={() => setContentModal(item.kind)}
                                className="group rounded-[22px] border border-zinc-100 bg-zinc-50 p-4 text-left transition hover:-translate-y-0.5 hover:border-[#f50555]/20 hover:bg-white hover:shadow-[0_16px_42px_rgba(15,23,42,0.08)]"
                              >
                                <div className="flex items-start gap-3">
                                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-[#f50555] shadow-sm ring-1 ring-zinc-100 transition group-hover:bg-rose-50">
                                    <Icon className="h-5 w-5" />
                                  </span>
                                  <div className="min-w-0">
                                    <h3 className="font-semibold text-zinc-950">{item.title}</h3>
                                    <p className="mt-1 text-sm leading-6 text-zinc-500">{item.description}</p>
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <aside className="space-y-6">
                    <div className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.06)] sm:p-6">
                      <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-900">İşletme özeti</h2>
                      <div className="mt-5 grid gap-3 text-sm">
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Yetki</p>
                          <p className="mt-2 font-semibold text-zinc-950">{getWorkspaceRoleLabel(role)}</p>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Bölge</p>
                          <p className="mt-2 font-semibold text-zinc-950">{getDistrictLabel(dashboard.business.district)}</p>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">İşletme türü</p>
                          <p className="mt-2 font-semibold text-zinc-950">{getListingTypeLabel(dashboard.showcase.listing_type)}</p>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Pazaryeri</p>
                          <p className="mt-2 font-semibold text-zinc-950">{dashboard.showcase.marketplace_is_visible ? "Yayında" : "Kapalı"}</p>
                        </div>
                      </div>
                    </div>

                    <div
                      id="islem-gecmisi"
                      className="scroll-mt-28 overflow-hidden rounded-[30px] border border-zinc-100 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.075)]"
                    >
                      <div className="relative overflow-hidden bg-zinc-950 p-5 text-white sm:p-6">
                        <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-[#f50555]/30 blur-2xl" />
                        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                          <div className="flex items-start gap-3">
                            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-[#ff7a9f] ring-1 ring-white/10">
                              <Clock3 className="h-5 w-5" />
                            </span>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/55">Kasa kayıtları</p>
                              <h2 className="mt-1 text-2xl font-semibold tracking-[-0.05em]">İşlem geçmişi</h2>
                              <p className="mt-2 max-w-sm text-sm leading-6 text-white/62">
                                Son teslimleri, tutarı ve sipariş bağlantısını hızlıca kontrol et.
                              </p>
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white px-4 py-3 text-zinc-950 shadow-[0_16px_42px_rgba(0,0,0,0.18)]">
                            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Son kayıt</p>
                            <p className="mt-1 text-2xl font-semibold tracking-[-0.04em]">{consumedCount}</p>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 sm:p-5">
                        {consumedCount ? (
                          <div className="space-y-3">
                            {dashboard.sessions.latest_consumed.map((item, index) => {
                              const detailHref = item.order_id ? `/isletme/${businessId}/siparisler/${item.order_id}` : `/isletme/${businessId}/gecmis`;
                              const visibleCode = item.order_id ? `Sipariş #${item.order_id}` : `QR ${getCompactToken(item.token)}`;

                              return (
                                <Link
                                  key={item.id}
                                  href={detailHref}
                                  className="group block rounded-[24px] border border-zinc-100 bg-zinc-50/75 p-4 transition hover:-translate-y-0.5 hover:border-[#f50555]/20 hover:bg-white hover:shadow-[0_16px_42px_rgba(15,23,42,0.08)]"
                                >
                                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 items-start gap-3">
                                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white text-[#f50555] shadow-sm ring-1 ring-zinc-100">
                                        <ReceiptText className="h-5 w-5" />
                                      </span>
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="font-semibold text-zinc-950">{visibleCode}</p>
                                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                                            Tamamlandı
                                          </span>
                                        </div>
                                        <p className="mt-2 text-sm leading-5 text-zinc-500">
                                          {formatDateTime(item.consumed_at)} · {item.item_count} ürün
                                        </p>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between gap-4 sm:min-w-[150px] sm:flex-col sm:items-end sm:gap-1">
                                      <div className="text-lg font-semibold tracking-[-0.03em] text-zinc-950">
                                        <AmountText amount={item.total_payable_amount} />
                                      </div>
                                      <span className="inline-flex items-center gap-1 text-sm font-semibold text-[#f50555]">
                                        Detay
                                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                                      </span>
                                    </div>
                                  </div>

                                  {index === 0 ? (
                                    <div className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs font-medium text-zinc-500 ring-1 ring-zinc-100">
                                      En son tamamlanan teslim
                                    </div>
                                  ) : null}
                                </Link>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50/70 p-5">
                            <EmptyState title="Henüz işlem yok" description="Teslim onayı verilen QR işlemleri burada sade bir liste olarak görünecek." />
                          </div>
                        )}

                        <Link
                          href={`/isletme/${businessId}/gecmis`}
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800"
                        >
                          Tüm geçmişi aç
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  </aside>
                </section>

                {profileOpen ? <ProfileCardModal dashboard={dashboard} onClose={() => setProfileOpen(false)} /> : null}
                {contentModal ? <BusinessManagedContentModal businessId={businessId} kind={contentModal} onClose={() => setContentModal(null)} /> : null}
              </div>
            );
          }}
        </QueryState>
      </BusinessPanelShell>
    </PageContainer>
  );
}
