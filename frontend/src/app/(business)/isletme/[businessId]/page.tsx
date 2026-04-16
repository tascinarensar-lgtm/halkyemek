"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock3,
  Eye,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from "lucide-react";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { getRoleLabel, isManagementRole } from "@/components/business/business-role";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { QueryState } from "@/components/ui/query-state";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getBusinessDashboardSummary } from "@/features/business-operations/api";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
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
      return "success" as const;
    case "CONSUMED":
      return "success" as const;
    default:
      return "default" as const;
  }
}

function getDistrictLabel(district: string) {
  switch (district) {
    case "BEYLIKDUZU":
      return "İstanbul / Beylikdüzü";
    default:
      return district;
  }
}

function getListingTypeLabel(listingType: string) {
  switch (listingType) {
    case "CONTRACTED":
      return "Anlaşmalı işletme";
    case "VOLUNTEER":
      return "Gönüllü işletme";
    default:
      return listingType;
  }
}

export default function BusinessDashboardPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);

  const dashboardQuery = useQuery({
    queryKey: ["business-operations", businessId, "dashboard"],
    queryFn: () => getBusinessDashboardSummary(businessId),
    enabled: Number.isFinite(businessId),
  });

  return (
    <PageContainer>
      <BusinessPanelShell businessId={businessId}>
        <div className="space-y-6">
          <SectionHeader
            title="İşletme kontrol merkezi"
            description="Kasadaki işlem akışını, gün içindeki hareketleri ve işletmenin görünürlüğünü bu ekrandan net biçimde takip edebilirsin."
          />

          <QueryState
            isPending={dashboardQuery.isPending}
            isError={dashboardQuery.isError}
            error={dashboardQuery.error}
            data={dashboardQuery.data}
            errorTitle="İşletme paneli yüklenemedi"
            errorDescription={`${getApiErrorMessage(dashboardQuery.error)}${getApiRequestId(dashboardQuery.error) ? ` · request_id: ${getApiRequestId(dashboardQuery.error)}` : ""}`}
            emptyTitle="İşletme verisi bulunamadı"
            emptyDescription="Panel açıldı ancak gösterilebilir işletme verisi dönmedi."
          >
            {(dashboard) => {
              const role = dashboard.business.member_role;
              const canEditProfile = isManagementRole(role);
              const pendingCount = dashboard.sessions.pending.length;
              const consumedCount = dashboard.sessions.latest_consumed.length;

              return (
                <>
                  <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] shadow-sm">
                    <CardContent className="space-y-6 p-6">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-3">
                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                            <ShieldCheck className="h-3.5 w-3.5" />
                            İşletme dashboard
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">{dashboard.business.name}</h2>
                              <StatusChip label={getRoleLabel(role)} tone={canEditProfile ? "success" : "default"} />
                            </div>
                            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                              {canEditProfile
                                ? "Operasyon hareketleri, içerik durumu ve işletme görünürlüğü tek ekranda toplanır. Günlük akışı takip ederken yönetim alanlarına da buradan hızlıca geçebilirsin."
                                : "Kasadaki bekleyen QR hareketlerini, gün içindeki teslimleri ve işletmenin temel durumunu bu ekrandan pratik biçimde takip edebilirsin."}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-md lg:grid-cols-1 xl:grid-cols-3">
                          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bölge</div>
                            <div className="mt-2 text-base font-semibold text-zinc-950">{getDistrictLabel(dashboard.business.district)}</div>
                            <p className="mt-1 text-sm text-zinc-600">Aktif çalışma bölgesi.</p>
                          </div>
                          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bekleyen işlem</div>
                            <div className="mt-2 text-2xl font-semibold text-zinc-950">{pendingCount}</div>
                            <p className="mt-1 text-sm text-zinc-600">Kasada işlem bekleyen QR hareketi.</p>
                          </div>
                          <div className="rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-zinc-100">
                            <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Görünürlük</div>
                            <div className="mt-2 text-base font-semibold text-zinc-950">
                              {dashboard.showcase.marketplace_is_visible ? "Yayında" : "Kapalı"}
                            </div>
                            <p className="mt-1 text-sm text-zinc-600">Pazaryeri görünürlüğü.</p>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Link href={`/isletme/${businessId}/gecmis`} className="inline-flex items-center gap-2 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                          İşlem geçmişi
                        </Link>
                        <Link href={`/isletme/${businessId}/profil`} className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                          İşletme profili
                        </Link>
                        {canEditProfile ? (
                          <Link href={`/isletme/${businessId}/yonetim/menu`} className="inline-flex items-center gap-2 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                            Menü yönetimi
                          </Link>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Card className="border-stone-200 shadow-sm">
                      <CardContent className="p-5">
                        <p className="text-sm text-zinc-500">Bugün teslim edilen</p>
                        <p className="mt-2 text-2xl font-semibold text-zinc-950">{dashboard.consume_today.count}</p>
                        <p className="mt-1 text-sm text-zinc-600">Gün içinde tamamlanan işlem sayısı.</p>
                      </CardContent>
                    </Card>

                    <Card className="border-stone-200 shadow-sm">
                      <CardContent className="p-5">
                        <p className="text-sm text-zinc-500">Bugünkü işlem tutarı</p>
                        <div className="mt-2 text-2xl font-semibold text-zinc-950">
                          <AmountText amount={dashboard.consume_today.total_charged_amount} />
                        </div>
                        <p className="mt-1 text-sm text-zinc-600">Bugün tamamlanan işlemlerin toplamı.</p>
                      </CardContent>
                    </Card>

                    <Card className="border-stone-200 shadow-sm">
                      <CardContent className="p-5">
                        <p className="text-sm text-zinc-500">Yayındaki teklif</p>
                        <p className="mt-2 text-2xl font-semibold text-zinc-950">{dashboard.offers.live_count}</p>
                        <p className="mt-1 text-sm text-zinc-600">Şu anda görünür teklif sayısı.</p>
                      </CardContent>
                    </Card>

                    <Card className="border-stone-200 shadow-sm">
                      <CardContent className="p-5">
                        <p className="text-sm text-zinc-500">Aktif görsel</p>
                        <p className="mt-2 text-2xl font-semibold text-zinc-950">{dashboard.media.active_count}</p>
                        <p className="mt-1 text-sm text-zinc-600">Listede aktif kullanılan görseller.</p>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                    <div className="space-y-6">
                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <h2 className="text-lg font-semibold text-zinc-950">Bekleyen QR hareketleri</h2>
                              <p className="mt-1 text-sm text-zinc-600">Kasada sırada olan ve işlem bekleyen hareketleri buradan takip edebilirsin.</p>
                            </div>
                            <StatusChip label={`${pendingCount} kayıt`} tone={pendingCount > 0 ? "warning" : "default"} />
                          </div>

                          {pendingCount ? (
                            <div className="space-y-3">
                              {dashboard.sessions.pending.map((item) => (
                                <Link
                                  key={item.id}
                                  href={`/isletme/${businessId}/tuket/${item.token}`}
                                  className="block rounded-2xl bg-zinc-50 p-4 text-sm transition hover:bg-zinc-100"
                                >
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-medium text-zinc-950">Kod: {item.token}</p>
                                        <StatusChip label={getSessionStatusLabel(item.status)} tone={getSessionStatusTone(item.status)} />
                                      </div>
                                      <p className="text-zinc-600">
                                        Son geçerlilik: {formatDateTime(item.expires_at)} · {item.item_count} ürün
                                      </p>
                                    </div>

                                    <div className="text-right">
                                      <div className="font-medium text-zinc-950">
                                        <AmountText amount={item.total_payable_amount} />
                                      </div>
                                      <p className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-zinc-700">
                                        İşleme geç
                                        <ArrowRight className="h-4 w-4" />
                                      </p>
                                    </div>
                                  </div>
                                </Link>
                              ))}
                            </div>
                          ) : (
                            <EmptyState
                              title="Şu an bekleyen QR hareketi yok"
                              description="Kasada işlem bekleyen bir kayıt olduğunda bu alan otomatik olarak dolacaktır. Şimdilik günlük akış sakin görünüyor."
                            />
                          )}
                        </CardContent>
                      </Card>

                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6">
                          <div className="flex items-center justify-between">
                            <div>
                              <h2 className="text-lg font-semibold text-zinc-950">Son tamamlanan işlemler</h2>
                              <p className="mt-1 text-sm text-zinc-600">Yakın zamanda teslim edilmiş kayıtları ve sipariş bağlantılarını buradan görebilirsin.</p>
                            </div>
                            <Link href={`/isletme/${businessId}/gecmis`} className="text-sm font-medium text-zinc-700">
                              Tümünü gör
                            </Link>
                          </div>

                          {consumedCount ? (
                            <div className="space-y-3">
                              {dashboard.sessions.latest_consumed.map((item) => (
                                <div key={item.id} className="rounded-2xl bg-zinc-50 p-4 text-sm">
                                  <div className="flex items-center justify-between gap-4">
                                    <div>
                                      <p className="font-medium text-zinc-950">Kod: {item.token}</p>
                                      <p className="mt-1 text-zinc-600">Teslim zamanı: {formatDateTime(item.consumed_at)}</p>
                                    </div>
                                    <AmountText amount={item.total_payable_amount} />
                                  </div>
                                  <div className="mt-3 flex items-center justify-between text-zinc-600">
                                    <span>{item.item_count} ürün</span>
                                    {item.order_id ? (
                                      <Link href={`/isletme/${businessId}/siparisler/${item.order_id}`} className="font-medium text-zinc-900">
                                        Sipariş detayı
                                      </Link>
                                    ) : (
                                      <span>Sipariş kaydı yok</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <EmptyState
                              title="Henüz tamamlanan işlem görünmüyor"
                              description="Teslim edilen ilk işlemler burada listelenir. Günlük operasyon başladığında bu alan kendiliğinden dolacaktır."
                            />
                          )}
                        </CardContent>
                      </Card>
                    </div>

                    <div className="space-y-6">
                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6">
                          <div>
                            <h2 className="text-lg font-semibold text-zinc-950">İşletme görünümü</h2>
                            <p className="mt-1 text-sm text-zinc-600">Rolün, liste durumu ve pazaryeri görünürlüğü gibi temel bilgileri burada toplu görürsün.</p>
                          </div>

                          <div className="grid gap-3 text-sm text-zinc-600">
                            <div className="rounded-2xl bg-zinc-50 p-4">
                              <p className="font-medium text-zinc-950">Rolün</p>
                              <p className="mt-1">{getRoleLabel(role)}</p>
                            </div>
                            <div className="rounded-2xl bg-zinc-50 p-4">
                              <p className="font-medium text-zinc-950">Bölge</p>
                              <p className="mt-1">{getDistrictLabel(dashboard.business.district)}</p>
                            </div>
                            <div className="rounded-2xl bg-zinc-50 p-4">
                              <p className="font-medium text-zinc-950">İşletme türü</p>
                              <p className="mt-1">{getListingTypeLabel(dashboard.showcase.listing_type)}</p>
                            </div>
                            <div className="rounded-2xl bg-zinc-50 p-4">
                              <p className="font-medium text-zinc-950">Pazaryeri görünürlüğü</p>
                              <p className="mt-1">{dashboard.showcase.marketplace_is_visible ? "Açık" : "Kapalı"}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6">
                          <div>
                            <h2 className="text-lg font-semibold text-zinc-950">Kazanç ve ödeme özeti</h2>
                            <p className="mt-1 text-sm text-zinc-600">Bekleyen kazanç kayıtlarını ve ödeme tarafındaki mevcut durumu tek bakışta izle.</p>
                          </div>

                          <div className="grid gap-3 text-sm text-zinc-600">
                            <div className="rounded-2xl bg-zinc-50 p-4">
                              <p className="font-medium text-zinc-950">Bekleyen kazanç kaydı</p>
                              <p className="mt-1">{dashboard.finance.earning.pending_count}</p>
                            </div>
                            <div className="rounded-2xl bg-zinc-50 p-4">
                              <p className="font-medium text-zinc-950">Ödemeye uygun kayıt</p>
                              <p className="mt-1">{dashboard.finance.earning.eligible_count}</p>
                            </div>
                            <div className="rounded-2xl bg-zinc-50 p-4">
                              <p className="font-medium text-zinc-950">Onaylanan ödeme kaydı</p>
                              <p className="mt-1">{dashboard.finance.payout.confirmed_count}</p>
                            </div>
                            {typeof dashboard.finance.earning.outstanding_net_amount === "number" ? (
                              <div className="rounded-2xl bg-zinc-50 p-4">
                                <p className="font-medium text-zinc-950">Bekleyen net toplam</p>
                                <div className="mt-1">
                                  <AmountText amount={dashboard.finance.earning.outstanding_net_amount} />
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="border-stone-200 shadow-sm">
                        <CardContent className="space-y-4 p-6">
                          <div>
                            <h2 className="text-lg font-semibold text-zinc-950">Bu sayfada neleri takip edersin?</h2>
                            <p className="mt-1 text-sm text-zinc-600">İşletme panelinin ilk ekranı; günün akışını, görünürlüğü ve hızlı aksiyon alanlarını tek noktada toplar.</p>
                          </div>

                          <div className="space-y-3">
                            <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
                              <Clock3 className="mt-0.5 h-4 w-4 text-zinc-700" />
                              <p>Kasada bekleyen QR hareketleri ve son geçerlilik süreleri görünür.</p>
                            </div>
                            <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
                              <ReceiptText className="mt-0.5 h-4 w-4 text-zinc-700" />
                              <p>Tamamlanan işlemler, sipariş detayına geçişle birlikte hızlıca incelenebilir.</p>
                            </div>
                            <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
                              <Eye className="mt-0.5 h-4 w-4 text-zinc-700" />
                              <p>İşletmenin pazaryerinde açık mı kapalı mı göründüğü ve teklif durumu tek bakışta anlaşılır.</p>
                            </div>
                            <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-600">
                              <Wallet className="mt-0.5 h-4 w-4 text-zinc-700" />
                              <p>Kazanç ve ödeme tarafındaki temel tablo, rolüne uygun şekilde sade bir özetle sunulur.</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                </>
              );
            }}
          </QueryState>
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
