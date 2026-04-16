"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { isManagementRole } from "@/components/business/business-role";
import { CrudCard, DangerButton, Field, ManagementToolbar, PrimaryButton, SecondaryButton, Select, Sheet, TextArea, TextInput, ToggleRow } from "@/components/business-management/shared";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { createBusinessMediaAsset, deleteBusinessMediaAsset, getBusinessDashboardSummary, listBusinessMediaAssets, listBusinessMenuItems, listBusinessOffers, updateBusinessMediaAsset } from "@/features/business-operations/api";
import type { BusinessMediaAsset, BusinessMediaAssetInput } from "@/features/business-operations/types";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";

const mediaTypes = ["IMAGE", "VIDEO", "DOCUMENT"] as const;
const assetRoles = ["GALLERY", "COVER", "LOGO", "THUMBNAIL"] as const;

const schema = z.object({
  target_type: z.enum(["BUSINESS", "MENU_ITEM", "OFFER"]),
  target_id: z.coerce.number().int().nullable().optional(),
  file_url: z.string().trim().optional().default(""),
  file_path: z.string().trim().optional().default(""),
  media_type: z.enum(mediaTypes),
  asset_role: z.enum(assetRoles),
  alt_text: z.string().max(255).optional().default(""),
  sort_order: z.coerce.number().int().min(0),
  is_active: z.boolean(),
  metadata_file_size_bytes: z.coerce.number().int().min(0).optional(),
}).superRefine((values, ctx) => {
  if (!values.file_url && !values.file_path) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["file_url"], message: "file_url veya file_path gerekli." });
  }
  if (values.target_type !== "BUSINESS" && !values.target_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target_id"], message: "Bir hedef seçmelisin." });
  }
});

type FormValues = z.input<typeof schema>;
type FormSubmitValues = z.output<typeof schema>;

const defaults: FormValues = {
  target_type: "BUSINESS",
  target_id: null,
  file_url: "",
  file_path: "",
  media_type: "IMAGE",
  asset_role: "GALLERY",
  alt_text: "",
  sort_order: 0,
  is_active: true,
  metadata_file_size_bytes: 0,
};

function toPayload(values: FormValues): BusinessMediaAssetInput {
  return {
    menu_item: values.target_type === "MENU_ITEM" ? values.target_id ?? null : null,
    offer: values.target_type === "OFFER" ? values.target_id ?? null : null,
    file_url: values.file_url || undefined,
    file_path: values.file_path || undefined,
    media_type: values.media_type,
    asset_role: values.asset_role,
    alt_text: values.alt_text,
    sort_order: values.sort_order,
    is_active: values.is_active,
    metadata: values.metadata_file_size_bytes ? { file_size_bytes: values.metadata_file_size_bytes } : undefined,
  };
}

function getTargetLabel(item: BusinessMediaAsset) {
  if (item.menu_item) return `Menu item #${item.menu_item}`;
  if (item.offer) return `Offer #${item.offer}`;
  if (item.marketplace_category) return `Marketplace category #${item.marketplace_category}`;
  return "Business root asset";
}

export default function BusinessMediaManagementPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const queryClient = useQueryClient();
  const [editingItem, setEditingItem] = useState<BusinessMediaAsset | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: ["business-operations", businessId, "dashboard"],
    queryFn: () => getBusinessDashboardSummary(businessId),
    enabled: hasValidBusinessId,
  });
  const canManage = isManagementRole(dashboardQuery.data?.business.member_role);

  const mediaQuery = useQuery({
    queryKey: ["business-management", businessId, "media"],
    queryFn: () => listBusinessMediaAssets(businessId),
    enabled: hasValidBusinessId && canManage,
  });
  const menuItemsQuery = useQuery({
    queryKey: ["business-management", businessId, "menu-items"],
    queryFn: () => listBusinessMenuItems(businessId),
    enabled: hasValidBusinessId && canManage,
  });
  const offersQuery = useQuery({
    queryKey: ["business-management", businessId, "offers"],
    queryFn: () => listBusinessOffers(businessId),
    enabled: hasValidBusinessId && canManage,
  });

  const form = useForm<FormValues, unknown, FormSubmitValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (!sheetOpen) {
      form.reset(defaults);
      setEditingItem(null);
    }
  }, [form, sheetOpen]);

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

  const createMutation = useMutation({
    mutationFn: (values: BusinessMediaAssetInput) => createBusinessMediaAsset(businessId, values),
    onSuccess: async () => {
      toast.success("Medya kaydı oluşturuldu.");
      setSheetOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Medya kaydı oluşturulamadı.")),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: Partial<BusinessMediaAssetInput> }) => updateBusinessMediaAsset(businessId, id, values),
    onSuccess: async () => {
      toast.success("Medya kaydı güncellendi.");
      setSheetOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Medya kaydı güncellenemedi.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteBusinessMediaAsset(businessId, id),
    onSuccess: async () => {
      toast.success("Medya kaydı silindi.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Medya kaydı silinemedi.")),
  });

  const summary = useMemo(() => {
    const items = mediaQuery.data ?? [];
    return {
      total: items.length,
      active: items.filter((item) => item.is_active).length,
      images: items.filter((item) => item.media_type === "IMAGE").length,
      businessRoot: items.filter((item) => item.business && !item.menu_item && !item.offer && !item.marketplace_category).length,
    };
  }, [mediaQuery.data]);

  const openCreate = () => {
    form.reset(defaults);
    setEditingItem(null);
    setSheetOpen(true);
  };

  const openEdit = (item: BusinessMediaAsset) => {
    setEditingItem(item);
    form.reset({
      target_type: item.menu_item ? "MENU_ITEM" : item.offer ? "OFFER" : "BUSINESS",
      target_id: item.menu_item ?? item.offer ?? null,
      file_url: item.file_url ?? "",
      file_path: item.file_path ?? "",
      media_type: item.media_type as FormValues["media_type"],
      asset_role: item.asset_role as FormValues["asset_role"],
      alt_text: item.alt_text ?? "",
      sort_order: item.sort_order,
      is_active: item.is_active,
      metadata_file_size_bytes: Number(item.metadata?.file_size_bytes ?? 0),
    });
    setSheetOpen(true);
  };

  const onSubmit = (values: FormSubmitValues) => {
    const payload = toPayload(values);
    if (editingItem) {
      updateMutation.mutate({ id: editingItem.id, values: payload });
      return;
    }
    createMutation.mutate(payload);
  };

  const watchedTargetType = form.watch("target_type");

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader title="Medya yönetimi" description="Upload akışı backend’de yoksa uydurma sistem kurmadan file_url / file_path kontratı üzerinden ilerler." />

          {!hasValidBusinessId ? <ErrorState title="Geçersiz işletme" description="URL içindeki businessId okunamadı. Güvenli yönetim için işletme panelinden tekrar aç." /> : null}

          {dashboardQuery.isPending || mediaQuery.isPending || menuItemsQuery.isPending || offersQuery.isPending ? <LoadingSkeleton /> : null}
          {dashboardQuery.isError ? <ErrorState title="Yetki bilgisi yüklenemedi" description={`${getApiErrorMessage(dashboardQuery.error)}${getApiRequestId(dashboardQuery.error) ? ` · request_id: ${getApiRequestId(dashboardQuery.error)}` : ""}`} /> : null}
          {mediaQuery.isError ? <ErrorState title="Medya listesi yüklenemedi" description={`${getApiErrorMessage(mediaQuery.error)}${getApiRequestId(mediaQuery.error) ? ` · request_id: ${getApiRequestId(mediaQuery.error)}` : ""}`} /> : null}

          {dashboardQuery.data ? (
            <ManagementToolbar
              title="Medya varlıkları"
              description="Business root, menu item veya offer hedeflerine bağlanan medya kayıtlarını yönet. Marketplace category hedefi backend’de var ama bu panel scope dışında bırakıldı."
              action={<PrimaryButton onClick={openCreate} disabled={!canManage || !hasValidBusinessId || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending}>Yeni medya</PrimaryButton>}
            />
          ) : null}

          {mediaQuery.data ? (
            <div className="grid gap-4 md:grid-cols-4">
              <CrudCard title={`${summary.total} medya`} subtitle="Toplam kayıt" />
              <CrudCard title={`${summary.active} aktif`} subtitle="is_active=true" />
              <CrudCard title={`${summary.images} görsel`} subtitle="IMAGE tipi" />
              <CrudCard title={`${summary.businessRoot} root asset`} subtitle="Doğrudan business'e bağlı" />
            </div>
          ) : null}

          {mediaQuery.data?.length ? (
            <div className="space-y-4">
              {mediaQuery.data.map((item) => (
                <CrudCard
                  key={item.id}
                  title={item.asset_role}
                  subtitle={`${item.media_type} · ${getTargetLabel(item)}`}
                  badge={<span className={`rounded-full px-2 py-1 text-xs font-medium ${item.is_active ? "bg-emerald-100 text-emerald-700" : "bg-zinc-200 text-zinc-700"}`}>{item.is_active ? "Aktif" : "Pasif"}</span>}
                  actions={
                    <>
                      <SecondaryButton onClick={() => openEdit(item)} disabled={!canManage || createMutation.isPending || updateMutation.isPending || deleteMutation.isPending}>Düzenle</SecondaryButton>
                      <DangerButton onClick={() => deleteMutation.mutate(item.id)} disabled={!canManage || deleteMutation.isPending}>Sil</DangerButton>
                    </>
                  }
                >
                  <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-4">
                    <div className="rounded-2xl bg-zinc-50 p-4">sort_order: {item.sort_order}</div>
                    <div className="rounded-2xl bg-zinc-50 p-4">uploaded_by: {item.uploaded_by ?? "-"}</div>
                    <div className="rounded-2xl bg-zinc-50 p-4">file_path: {item.file_path || "-"}</div>
                    <div className="rounded-2xl bg-zinc-50 p-4">size: {item.metadata?.file_size_bytes ? `${String(item.metadata.file_size_bytes)} bytes` : "-"}</div>
                  </div>
                  {item.alt_text ? <p className="text-sm text-zinc-700">alt_text: {item.alt_text}</p> : null}
                  {item.file_url ? <a href={item.file_url} target="_blank" rel="noreferrer" className="text-sm font-medium text-zinc-900 underline">Dosya URL</a> : null}
                </CrudCard>
              ))}
            </div>
          ) : mediaQuery.data && !mediaQuery.isPending ? <EmptyState title="Medya yok" description="İlk medya kaydını ekleyerek görsel/video/document içeriklerini bağlayabilirsin." /> : null}
        </div>

        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={editingItem ? "Medya düzenle" : "Yeni medya"} description="Manual URL/path odaklı kayıt. Gerçek upload endpoint’i olmadığı için dosya seçici uydurulmadı.">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Field label="Hedef tipi" error={form.formState.errors.target_type?.message}>
              <Select value={watchedTargetType} onChange={(event) => { form.setValue("target_type", event.target.value as FormValues["target_type"]); form.setValue("target_id", null); }} disabled={!canManage}>
                <option value="BUSINESS">Business root</option>
                <option value="MENU_ITEM">Menü ürünü</option>
                <option value="OFFER">Teklif</option>
              </Select>
            </Field>
            {watchedTargetType !== "BUSINESS" ? (
              <Field label="Hedef kayıt" error={form.formState.errors.target_id?.message as string | undefined}>
                <Select value={form.watch("target_id") ?? ""} onChange={(event) => form.setValue("target_id", event.target.value ? Number(event.target.value) : null)} disabled={!canManage}>
                  <option value="">Seçim yap</option>
                  {watchedTargetType === "MENU_ITEM"
                    ? (menuItemsQuery.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)
                    : (offersQuery.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                </Select>
              </Field>
            ) : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="file_url" error={form.formState.errors.file_url?.message}><TextInput {...form.register("file_url")} disabled={!canManage} /></Field>
              <Field label="file_path" error={form.formState.errors.file_path?.message}><TextInput {...form.register("file_path")} disabled={!canManage} /></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Medya tipi" error={form.formState.errors.media_type?.message}><Select {...form.register("media_type")} disabled={!canManage}>{mediaTypes.map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
              <Field label="Asset role" error={form.formState.errors.asset_role?.message}><Select {...form.register("asset_role")} disabled={!canManage}>{assetRoles.map((value) => <option key={value} value={value}>{value}</option>)}</Select></Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Alt text" error={form.formState.errors.alt_text?.message}><TextArea rows={3} {...form.register("alt_text")} disabled={!canManage} /></Field>
              <div className="space-y-4">
                <Field label="Sıralama" error={form.formState.errors.sort_order?.message}><TextInput type="number" {...form.register("sort_order", { valueAsNumber: true })} disabled={!canManage} /></Field>
                <Field label="metadata.file_size_bytes" error={form.formState.errors.metadata_file_size_bytes?.message as string | undefined}><TextInput type="number" {...form.register("metadata_file_size_bytes", { valueAsNumber: true })} disabled={!canManage} /></Field>
              </div>
            </div>
            <ToggleRow label="Aktif medya" description="Public serializer tarafında active filtrelerini etkiler." checked={form.watch("is_active")} onChange={(next) => form.setValue("is_active", next)} disabled={!canManage} />
            <div className="flex flex-wrap gap-3 pt-2">
              <PrimaryButton type="submit" disabled={!canManage || createMutation.isPending || updateMutation.isPending}>{createMutation.isPending || updateMutation.isPending ? "Kaydediliyor..." : editingItem ? "Güncelle" : "Oluştur"}</PrimaryButton>
              <SecondaryButton type="button" onClick={() => setSheetOpen(false)}>Vazgeç</SecondaryButton>
            </div>
          </form>
        </Sheet>
      </BusinessPanelShell>
    </PageContainer>
  );
}
