"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers3, ListChecks, Tags } from "lucide-react";
import { toast } from "sonner";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { isManagementRole } from "@/components/business/business-role";
import { CrudCard, DangerButton, ManagementToolbar, PrimaryButton, SecondaryButton } from "@/components/business-management/shared";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import {
  createBusinessCategory,
  deleteBusinessCategory,
  getBusinessDashboardSummary,
  listBusinessCategories,
  updateBusinessCategory,
} from "@/features/business-operations/api";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";

export default function BusinessCategoryManagementPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const queryClient = useQueryClient();

  const dashboardQuery = useQuery({
    queryKey: ["business-operations", businessId, "dashboard"],
    queryFn: () => getBusinessDashboardSummary(businessId),
    enabled: hasValidBusinessId,
  });

  const canManage = isManagementRole(dashboardQuery.data?.business.member_role);

  const categoriesQuery = useQuery({
    queryKey: ["business-management", businessId, "categories"],
    queryFn: () => listBusinessCategories(businessId),
    enabled: hasValidBusinessId && canManage,
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "categories"] }),
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "menu-items"] }),
      queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-detail", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-menu", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "businesses"] }),
      queryClient.invalidateQueries({ queryKey: ["discovery", "home"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: (categoryId: number) =>
      createBusinessCategory(businessId, { marketplace_category: categoryId, is_active: true }),
    onSuccess: async () => {
      toast.success("Sistem kategorisi işletmeye eklendi.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Kategori eklenemedi.")),
  });

  const updateMutation = useMutation({
    mutationFn: ({ categoryId, values }: { categoryId: number; values: { is_active?: boolean; is_primary?: boolean } }) =>
      updateBusinessCategory(businessId, categoryId, values),
    onSuccess: async () => {
      toast.success("Kategori durumu güncellendi.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Kategori güncellenemedi.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (categoryId: number) => deleteBusinessCategory(businessId, categoryId),
    onSuccess: async () => {
      toast.success("Kategori işletme listesinden kaldırıldı.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Kategori kaldırılamadı.")),
  });

  const summary = useMemo(() => {
    const items = categoriesQuery.data ?? [];
    return {
      total: items.length,
      selected: items.filter((item) => item.is_selected).length,
      primary: items.find((item) => item.is_primary)?.name ?? "Henüz seçilmedi",
      linkedMenuItems: items.reduce((count, item) => count + item.public_menu_item_count, 0),
    };
  }, [categoriesQuery.data]);

  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader
            title="Sistem kategorileri"
            description="İşletme kendi kategorisini oluşturmaz. HalkYemek tarafından tanımlanan sistem kategorilerinden seçim yapar ve menü ürünlerini bu alanlara bağlar."
          />

          {!hasValidBusinessId ? (
            <ErrorState title="Geçersiz işletme" description="URL içindeki işletme bilgisi okunamadı. İşletme paneline güvenli giriş yapıp sayfayı yeniden aç." />
          ) : null}

          {dashboardQuery.isPending || categoriesQuery.isPending ? <LoadingSkeleton /> : null}

          {dashboardQuery.isError ? (
            <ErrorState
              title="Yetki bilgisi yüklenemedi"
              description={`${getApiErrorMessage(dashboardQuery.error)}${getApiRequestId(dashboardQuery.error) ? ` · request_id: ${getApiRequestId(dashboardQuery.error)}` : ""}`}
            />
          ) : null}

          {categoriesQuery.isError ? (
            <ErrorState
              title="Sistem kategorileri yüklenemedi"
              description={`${getApiErrorMessage(categoriesQuery.error)}${getApiRequestId(categoriesQuery.error) ? ` · request_id: ${getApiRequestId(categoriesQuery.error)}` : ""}`}
            />
          ) : null}

          {dashboardQuery.data && !canManage ? (
            <EmptyState
              title="Bu alanı yönetmek için yetkin yeterli değil"
              description="Sistem kategorisi seçimi yönetici veya sahip rolüne açıktır. Kasiyer rolü yalnızca operasyon yüzeylerini kullanır."
            />
          ) : null}

          {dashboardQuery.data && canManage ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-zinc-950 p-2.5 text-white"><Tags className="h-4 w-4" /></div>
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Müşterinin gördüğü kategori düzenini buradan kur</h2>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">
                          Bu ekran işletmenin hangi sistem kategorilerinde görüneceğini belirler. Menü ürünleri de sadece bu sistem
                          kategorilerine bağlanır; işletme kendi başına yeni kategori üretemez.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam sistem kategorisi</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.total}</div></div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Seçilen</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.selected}</div></div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Birincil kategori</div><div className="mt-2 text-base font-semibold text-zinc-950">{summary.primary}</div></div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bağlı ürün</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.linkedMenuItems}</div></div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200"><Layers3 className="h-4 w-4" /> Bu ekran neyi etkiler?</div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      Buradaki seçimler kategori sayfalarında işletmenin görünürlüğünü etkiler. Bir sistem kategorisini kaldırmadan önce o kategoriye bağlı menü ürünlerini başka kategoriye taşıman gerekir.
                    </div>
                    <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm"><span>Rolün</span><span className="font-medium text-white">{dashboardQuery.data.business.member_role}</span></div>
                  </CardContent>
                </Card>
              </div>

              <ManagementToolbar
                title="Sistem kategori listesi"
                description="HalkYemek kategorilerini işletmeye ekleyebilir, birini birincil görünüm olarak işaretleyebilir veya artık kullanmıyorsan kaldırabilirsin."
              />

              {categoriesQuery.data?.length ? (
                <div className="space-y-4">
                  {categoriesQuery.data.map((item) => (
                    <CrudCard
                      key={item.id}
                      title={item.name}
                      subtitle={`${item.slug} · Bu kategoride bağlı ürün: ${item.public_menu_item_count}`}
                      badge={
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", item.is_selected ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700")}>
                            {item.is_selected ? "İşletmede aktif" : "Henüz seçilmedi"}
                          </span>
                          {item.is_primary ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">Birincil</span> : null}
                        </div>
                      }
                      actions={
                        <>
                          {!item.is_selected ? (
                            <PrimaryButton onClick={() => createMutation.mutate(item.id)} disabled={isBusy}>İşletmeye ekle</PrimaryButton>
                          ) : (
                            <>
                              {!item.is_primary ? (
                                <SecondaryButton
                                  onClick={() => updateMutation.mutate({ categoryId: item.id, values: { is_primary: true, is_active: true } })}
                                  disabled={isBusy}
                                >
                                  Birincil yap
                                </SecondaryButton>
                              ) : null}
                              <DangerButton onClick={() => deleteMutation.mutate(item.id)} disabled={isBusy || item.public_menu_item_count > 0}>
                                Kaldır
                              </DangerButton>
                            </>
                          )}
                        </>
                      }
                    >
                      <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-3">
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500"><ListChecks className="h-3.5 w-3.5" /> Durum</div>
                          <div className="mt-2 font-medium text-zinc-900">{item.is_selected ? "İşletmeye bağlı" : "Beklemede"}</div>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Birincil görünüm</div>
                          <div className="mt-2 font-medium text-zinc-900">{item.is_primary ? "Evet" : "Hayır"}</div>
                        </div>
                        <div className="rounded-2xl bg-zinc-50 p-4">
                          <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bağlı menü ürünü</div>
                          <div className="mt-2 font-medium text-zinc-900">{item.public_menu_item_count}</div>
                        </div>
                      </div>
                      {item.description ? <p className="text-sm leading-6 text-zinc-700">{item.description}</p> : null}
                    </CrudCard>
                  ))}
                </div>
              ) : (
                categoriesQuery.data &&
                !categoriesQuery.isPending && (
                  <EmptyState title="Bu ilçe için sistem kategorisi bulunamadı" description="İşletmeye bağlanabilecek kategori listesi boşsa önce merkezi kategori seed/ops kurulumunu kontrol et." />
                )
              )}
            </>
          ) : null}
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
