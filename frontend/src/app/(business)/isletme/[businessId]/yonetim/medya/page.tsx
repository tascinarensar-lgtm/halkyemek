"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ImagePlus, Images, ShieldCheck, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { isManagementRole } from "@/components/business/business-role";
import { EntityImageManager } from "@/components/business-management/entity-image-manager";
import {
  ManagementToolbar,
  PrimaryButton,
  SecondaryButton,
} from "@/components/business-management/shared";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import {
  deleteBusinessMediaAsset,
  getBusinessDashboardSummary,
  listBusinessMediaAssets,
  uploadBusinessMediaAsset,
} from "@/features/business-operations/api";
import {
  createEmptyEntityImageState,
  createEntityImageState,
  disposeEntityImageState,
  syncEntityImages,
  type EntityImageState,
} from "@/features/business-operations/media-sync";
import type { BusinessMediaAsset } from "@/features/business-operations/types";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";

type LogoDraft =
  | { kind: "existing"; asset: BusinessMediaAsset; previewUrl: string }
  | { kind: "new"; file: File; previewUrl: string }
  | null;

function createLogoDraft(asset: BusinessMediaAsset | null | undefined): LogoDraft {
  if (!asset) return null;
  return {
    kind: "existing",
    asset,
    previewUrl: asset.url,
  };
}

function createNewLogoDraft(file: File): LogoDraft {
  return {
    kind: "new",
    file,
    previewUrl: URL.createObjectURL(file),
  };
}

function disposeLogoDraft(draft: LogoDraft) {
  if (!draft) return;
  if (draft.kind === "new") {
    URL.revokeObjectURL(draft.previewUrl);
  }
}

function readFirstImage(input: FileList | null) {
  if (!input) return null;
  return Array.from(input).find((file) => file.type.startsWith("image/")) ?? null;
}

function getRootImageAssets(items: BusinessMediaAsset[]) {
  return items.filter(
    (item) =>
      item.media_type === "IMAGE" &&
      !item.menu_item &&
      !item.offer &&
      !item.marketplace_category,
  );
}

function buildUploadFormData(file: File, role: "LOGO") {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("media_type", "IMAGE");
  formData.set("asset_role", role);
  formData.set("sort_order", "0");
  formData.set("is_active", "true");
  return formData;
}

export default function BusinessMediaManagementPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const queryClient = useQueryClient();
  const [showcaseState, setShowcaseState] = useState<EntityImageState>(() => createEmptyEntityImageState());
  const [logoState, setLogoState] = useState<LogoDraft>(null);
  const showcaseStateRef = useRef<EntityImageState>(showcaseState);
  const logoStateRef = useRef<LogoDraft>(logoState);

  useEffect(() => {
    showcaseStateRef.current = showcaseState;
  }, [showcaseState]);

  useEffect(() => {
    logoStateRef.current = logoState;
  }, [logoState]);

  useEffect(
    () => () => {
      disposeEntityImageState(showcaseStateRef.current);
      disposeLogoDraft(logoStateRef.current);
    },
    [],
  );

  const dashboardQuery = useQuery({
    queryKey: ["business-operations", businessId, "dashboard"],
    queryFn: () => getBusinessDashboardSummary(businessId),
    enabled: hasValidBusinessId,
    refetchOnWindowFocus: false,
  });

  const canManage = isManagementRole(dashboardQuery.data?.business.member_role);

  const mediaQuery = useQuery({
    queryKey: ["business-management", businessId, "media"],
    queryFn: () => listBusinessMediaAssets(businessId),
    enabled: hasValidBusinessId && canManage,
    refetchOnWindowFocus: false,
  });

  const rootImages = useMemo(() => getRootImageAssets(mediaQuery.data ?? []), [mediaQuery.data]);
  const rootLogo = useMemo(
    () => rootImages.find((item) => item.asset_role === "LOGO") ?? null,
    [rootImages],
  );
  const showcaseImages = useMemo(
    () => rootImages.filter((item) => item.asset_role !== "LOGO"),
    [rootImages],
  );

  useEffect(() => {
    if (!mediaQuery.data) return;
    disposeEntityImageState(showcaseStateRef.current);
    disposeLogoDraft(logoStateRef.current);
    const nextShowcase = createEntityImageState(showcaseImages);
    const nextLogo = createLogoDraft(rootLogo);
    showcaseStateRef.current = nextShowcase;
    logoStateRef.current = nextLogo;
    setShowcaseState(nextShowcase);
    setLogoState(nextLogo);
  }, [mediaQuery.dataUpdatedAt, rootLogo, showcaseImages, mediaQuery.data]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "media"] }),
      queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-detail", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-menu", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "businesses"] }),
      queryClient.invalidateQueries({ queryKey: ["discovery", "home"] }),
    ]);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const businessName = dashboardQuery.data?.business.name || "İşletme";
      await syncEntityImages({
        businessId,
        target: {},
        currentImages: showcaseImages,
        nextState: showcaseStateRef.current,
        defaultAltText: `${businessName} vitrin görseli`,
      });

      const currentLogoAssets = rootImages.filter((item) => item.asset_role === "LOGO");
      const draft = logoStateRef.current;

      if (!draft) {
        await Promise.all(currentLogoAssets.map((asset) => deleteBusinessMediaAsset(businessId, asset.id)));
        return;
      }

      if (draft.kind === "existing") {
        await Promise.all(
          currentLogoAssets
            .filter((asset) => asset.id !== draft.asset.id)
            .map((asset) => deleteBusinessMediaAsset(businessId, asset.id)),
        );
        return;
      }

      await uploadBusinessMediaAsset(businessId, buildUploadFormData(draft.file, "LOGO"));
      await Promise.all(currentLogoAssets.map((asset) => deleteBusinessMediaAsset(businessId, asset.id)));
    },
    onSuccess: async () => {
      toast.success("İşletme görselleri güncellendi.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "İşletme görselleri güncellenemedi.")),
  });

  const summary = useMemo(
    () => ({
      total: rootImages.length,
      gallery: showcaseImages.length,
      hasCover: showcaseImages.some((item) => item.asset_role === "COVER" || item.asset_role === "THUMBNAIL"),
      hasLogo: Boolean(rootLogo),
    }),
    [rootImages, showcaseImages, rootLogo],
  );

  const isBusy = saveMutation.isPending;

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader
            title="İşletme görselleri"
            description="Kapak, logo ve galeri fotoğraflarını gerçek dosya seçme akışıyla yönet. Burada link değil, doğrudan görsel deneyimi var."
          />

          {!hasValidBusinessId ? (
            <ErrorState
              title="Geçersiz işletme"
              description="URL içindeki işletme bilgisi okunamadı. İşletme paneline güvenli giriş yapıp sayfayı yeniden aç."
            />
          ) : null}

          {dashboardQuery.isPending || (canManage && mediaQuery.isPending) ? <LoadingSkeleton /> : null}

          {dashboardQuery.isError ? (
            <ErrorState
              title="Yetki ve işletme özeti yüklenemedi"
              description={`${getApiErrorMessage(dashboardQuery.error)}${
                getApiRequestId(dashboardQuery.error) ? ` · request_id: ${getApiRequestId(dashboardQuery.error)}` : ""
              }`}
            />
          ) : null}

          {canManage && mediaQuery.isError ? (
            <ErrorState
              title="Görseller yüklenemedi"
              description={`${getApiErrorMessage(mediaQuery.error)}${
                getApiRequestId(mediaQuery.error) ? ` · request_id: ${getApiRequestId(mediaQuery.error)}` : ""
              }`}
            />
          ) : null}

          {dashboardQuery.data && !canManage ? (
            <EmptyState
              title="Bu alanı yönetmek için yetkin yeterli değil"
              description="İşletme görsellerini düzenleme alanı yönetici veya sahip rolüne açıktır."
            />
          ) : null}

          {dashboardQuery.data && canManage ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-zinc-950 p-2.5 text-white">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-zinc-950">
                          İşletme vitrinini daha profesyonel göster
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">
                          Bu ekran kapak, logo ve galeri görsellerini tek merkezde toplar. Müşteri tarafında ilk güven hissini oluşturan bölüm tam olarak burasıdır.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Card className="border-stone-200 bg-white"><CardContent className="space-y-2 p-4"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam görsel</div><div className="text-2xl font-semibold text-zinc-950">{summary.total}</div></CardContent></Card>
                      <Card className="border-stone-200 bg-white"><CardContent className="space-y-2 p-4"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Kapak</div><div className="text-2xl font-semibold text-zinc-950">{summary.hasCover ? "Hazır" : "Eksik"}</div></CardContent></Card>
                      <Card className="border-stone-200 bg-white"><CardContent className="space-y-2 p-4"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Logo</div><div className="text-2xl font-semibold text-zinc-950">{summary.hasLogo ? "Hazır" : "Eksik"}</div></CardContent></Card>
                      <Card className="border-stone-200 bg-white"><CardContent className="space-y-2 p-4"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Galeri</div><div className="text-2xl font-semibold text-zinc-950">{summary.gallery}</div></CardContent></Card>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <ShieldCheck className="h-4 w-4" />
                      Görsel kalite notu
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      Kapak görseli işletme kartını, logo kurumsal güveni, galeri ise detay ekranındaki ilk izlenimi güçlendirir. Burada yaptığın düzenleme müşteri tarafına doğrudan yansır.
                    </div>
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
                        <span>Rolün</span>
                        <span className="font-medium text-white">{dashboardQuery.data.business.member_role}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
                        <span>İşletme adı</span>
                        <span className="font-medium text-white">{dashboardQuery.data.business.name}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <ManagementToolbar
                title="Vitrin düzeni"
                description="Logo, kapak ve galeri görsellerini burada profesyonel şekilde yönetebilirsin."
                action={
                  <div className="flex flex-wrap gap-2">
                    <SecondaryButton
                      type="button"
                      onClick={() => {
                        disposeEntityImageState(showcaseStateRef.current);
                        disposeLogoDraft(logoStateRef.current);
                        const nextShowcase = createEntityImageState(showcaseImages);
                        const nextLogo = createLogoDraft(rootLogo);
                        showcaseStateRef.current = nextShowcase;
                        logoStateRef.current = nextLogo;
                        setShowcaseState(nextShowcase);
                        setLogoState(nextLogo);
                      }}
                      disabled={isBusy}
                    >
                      Değişiklikleri sıfırla
                    </SecondaryButton>
                    <PrimaryButton type="button" onClick={() => saveMutation.mutate()} disabled={isBusy}>
                      {isBusy ? "Kaydediliyor..." : "Görselleri kaydet"}
                    </PrimaryButton>
                  </div>
                }
              />

              <div className="grid gap-5 xl:grid-cols-[0.78fr_1.22fr]">
                <Card className="border-stone-200 bg-white">
                  <CardContent className="space-y-4 p-5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
                        <Sparkles className="h-4 w-4" />
                        Kurumsal logo
                      </div>
                      <p className="text-sm leading-6 text-zinc-600">
                        İşletme kartında ve bazı öne çıkan alanlarda kullanılacak görsel kimlik.
                      </p>
                    </div>

                    {logoState ? (
                      <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                        <div className="aspect-square bg-zinc-100">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={logoState.previewUrl} alt="İşletme logosu" className="h-full w-full object-contain p-5" />
                        </div>
                        <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3">
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
                            <UploadCloud className="h-4 w-4" />
                            Logo değiştir
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp,image/gif"
                              className="hidden"
                              disabled={isBusy}
                              onChange={(event) => {
                                const file = readFirstImage(event.target.files);
                                event.currentTarget.value = "";
                                if (!file) return;
                                disposeLogoDraft(logoStateRef.current);
                                const next = createNewLogoDraft(file);
                                logoStateRef.current = next;
                                setLogoState(next);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              disposeLogoDraft(logoStateRef.current);
                              logoStateRef.current = null;
                              setLogoState(null);
                            }}
                            disabled={isBusy}
                            className="inline-flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                            Kaldır
                          </button>
                        </div>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12 text-center">
                        <div className="rounded-2xl bg-white p-3 text-zinc-700 shadow-sm">
                          <ImagePlus className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-zinc-900">Logo yükle</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">Şeffaf arka planlı PNG ya da net bir kare görsel önerilir.</p>
                        </div>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="hidden"
                          disabled={isBusy}
                          onChange={(event) => {
                            const file = readFirstImage(event.target.files);
                            event.currentTarget.value = "";
                            if (!file) return;
                            const next = createNewLogoDraft(file);
                            logoStateRef.current = next;
                            setLogoState(next);
                          }}
                        />
                      </label>
                    )}
                  </CardContent>
                </Card>

                <EntityImageManager
                  value={showcaseState}
                  onChange={setShowcaseState}
                  disabled={isBusy}
                  title="Kapak ve galeri fotoğrafları"
                  description="İşletme kartında kullanılacak kapak görselini ve detay ekranındaki galeri fotoğraflarını bu alandan yönet."
                />
              </div>
            </>
          ) : null}
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
