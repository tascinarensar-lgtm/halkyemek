"use client";

import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Clock3, ImagePlus, Megaphone, Receipt, Sparkles, Star } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { isManagementRole } from "@/components/business/business-role";
import {
  CrudCard,
  DangerButton,
  Field,
  ManagementToolbar,
  PrimaryButton,
  SecondaryButton,
  Select,
  Sheet,
  TextArea,
  TextInput,
  ToggleRow,
} from "@/components/business-management/shared";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import {
  createBusinessOffer,
  deleteBusinessMediaAsset,
  deleteBusinessOffer,
  getBusinessDashboardSummary,
  listBusinessMenuItems,
  listBusinessOffers,
  updateBusinessOffer,
} from "@/features/business-operations/api";
import { splitEntityImageUrls, syncEntityImages } from "@/features/business-operations/media-sync";
import type { BusinessOffer, BusinessOfferInput } from "@/features/business-operations/types";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";

const schema = z
  .object({
    menu_item: z.coerce.number().int().nullable().optional(),
    title: z.string().trim().min(1, "Başlık zorunlu.").max(160),
    short_description: z.string().max(255).optional().default(""),
    description: z.string().max(2000).optional().default(""),
    label: z.string().max(64).optional().default(""),
    tag: z.string().max(64).optional().default(""),
    offer_price_amount: z.coerce.number().int().positive("Teklif fiyatı pozitif olmalı."),
    starts_at: z.string().min(1, "Başlangıç zamanı gerekli."),
    ends_at: z.string().min(1, "Bitiş zamanı gerekli."),
    cover_image_url: z.string().url("Geçerli bir görsel adresi gir.").or(z.literal("")),
    gallery_image_urls: z.string().optional().default(""),
    is_active: z.boolean(),
    is_featured: z.boolean(),
    daily_limit: z.union([z.coerce.number().int().positive(), z.literal(0)]).optional(),
    sort_order: z.coerce.number().int().min(0),
  })
  .refine((values) => values.ends_at > values.starts_at, {
    message: "Bitiş tarihi başlangıçtan sonra olmalı.",
    path: ["ends_at"],
  });

type FormValues = z.input<typeof schema>;
type FormSubmitValues = z.output<typeof schema>;

const defaults: FormValues = {
  menu_item: null,
  title: "",
  short_description: "",
  description: "",
  label: "",
  tag: "",
  offer_price_amount: 0,
  starts_at: "",
  ends_at: "",
  cover_image_url: "",
  gallery_image_urls: "",
  is_active: true,
  is_featured: false,
  daily_limit: 0,
  sort_order: 0,
};

function toDateTimeLocal(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);
  return localDate.toISOString().slice(0, 16);
}

function toApiPayload(values: FormSubmitValues): BusinessOfferInput {
  return {
    menu_item: values.menu_item || null,
    title: values.title,
    short_description: values.short_description ?? "",
    description: values.description ?? "",
    label: values.label ?? "",
    tag: values.tag ?? "",
    offer_price_amount: values.offer_price_amount,
    starts_at: new Date(values.starts_at).toISOString(),
    ends_at: new Date(values.ends_at).toISOString(),
    is_active: values.is_active,
    is_featured: values.is_featured,
    daily_limit: values.daily_limit ? Number(values.daily_limit) : null,
    sort_order: values.sort_order,
  };
}

function getOfferState(offer: BusinessOffer) {
  const now = Date.now();
  const start = new Date(offer.starts_at).getTime();
  const end = new Date(offer.ends_at).getTime();

  if (!offer.is_active) return { label: "Pasif", classes: "bg-zinc-100 text-zinc-700" };
  if (start > now) return { label: "Planlandı", classes: "bg-amber-100 text-amber-800" };
  if (end < now) return { label: "Süresi doldu", classes: "bg-zinc-200 text-zinc-700" };
  return { label: "Canlı", classes: "bg-emerald-100 text-emerald-700" };
}

export default function BusinessOffersManagementPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const queryClient = useQueryClient();
  const [editingItem, setEditingItem] = useState<BusinessOffer | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: ["business-operations", businessId, "dashboard"],
    queryFn: () => getBusinessDashboardSummary(businessId),
    enabled: hasValidBusinessId,
  });

  const canManage = isManagementRole(dashboardQuery.data?.business.member_role);

  const offersQuery = useQuery({
    queryKey: ["business-management", businessId, "offers"],
    queryFn: () => listBusinessOffers(businessId),
    enabled: hasValidBusinessId && canManage,
  });

  const menuItemsQuery = useQuery({
    queryKey: ["business-management", businessId, "menu-items"],
    queryFn: () => listBusinessMenuItems(businessId),
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
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "offers"] }),
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "menu-items"] }),
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "media"] }),
      queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-detail", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-menu", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "businesses"] }),
      queryClient.invalidateQueries({ queryKey: ["discovery", "home"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async (values: FormSubmitValues) => {
      const offer = await createBusinessOffer(businessId, toApiPayload(values));
      await syncEntityImages({
        businessId,
        target: { offer: offer.id },
        currentImages: [],
        coverImageUrl: values.cover_image_url,
        galleryImageUrls: values.gallery_image_urls ?? "",
      });
      return offer;
    },
    onSuccess: async () => {
      toast.success("Teklif ve görseller kaydedildi.");
      setSheetOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Teklif kaydedilemedi.")),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ item, values }: { item: BusinessOffer; values: FormSubmitValues }) => {
      const offer = await updateBusinessOffer(businessId, item.id, toApiPayload(values));
      await syncEntityImages({
        businessId,
        target: { offer: item.id },
        currentImages: item.media_assets,
        coverImageUrl: values.cover_image_url,
        galleryImageUrls: values.gallery_image_urls ?? "",
      });
      return offer;
    },
    onSuccess: async () => {
      toast.success("Teklif güncellendi.");
      setSheetOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Teklif güncellenemedi.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (offerId: number) => deleteBusinessOffer(businessId, offerId),
    onSuccess: async () => {
      toast.success("Teklif yayından kaldırıldı.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Teklif pasife alınamadı.")),
  });

  const deleteMediaMutation = useMutation({
    mutationFn: (mediaId: number) => deleteBusinessMediaAsset(businessId, mediaId),
    onSuccess: async () => {
      toast.success("Görsel kaldırıldı.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Görsel silinemedi.")),
  });

  const summary = useMemo(() => {
    const items = offersQuery.data ?? [];
    const now = Date.now();
    return {
      total: items.length,
      active: items.filter((item) => item.is_active).length,
      live: items.filter(
        (item) =>
          item.is_active &&
          new Date(item.starts_at).getTime() <= now &&
          new Date(item.ends_at).getTime() >= now,
      ).length,
      featured: items.filter((item) => item.is_featured).length,
      imageCount: items.reduce((count, item) => count + item.media_assets.length, 0),
    };
  }, [offersQuery.data]);

  const menuItemMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of menuItemsQuery.data ?? []) {
      map.set(item.id, item.name);
    }
    return map;
  }, [menuItemsQuery.data]);

  function openCreate() {
    form.reset(defaults);
    setEditingItem(null);
    setSheetOpen(true);
  }

  function openEdit(item: BusinessOffer) {
    const imageValues = splitEntityImageUrls(item.media_assets);
    setEditingItem(item);
    form.reset({
      menu_item: item.menu_item,
      title: item.title,
      short_description: item.short_description ?? "",
      description: item.description ?? "",
      label: item.label ?? "",
      tag: item.tag ?? "",
      offer_price_amount: item.offer_price_amount,
      starts_at: toDateTimeLocal(item.starts_at),
      ends_at: toDateTimeLocal(item.ends_at),
      cover_image_url: imageValues.coverImageUrl,
      gallery_image_urls: imageValues.galleryImageUrls,
      is_active: item.is_active,
      is_featured: item.is_featured,
      daily_limit: item.daily_limit ?? 0,
      sort_order: item.sort_order,
    });
    setSheetOpen(true);
  }

  function onSubmit(values: FormSubmitValues) {
    if (editingItem) {
      updateMutation.mutate({ item: editingItem, values });
      return;
    }
    createMutation.mutate(values);
  }

  const isBusy =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    deleteMediaMutation.isPending;

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader
            title="Teklif yönetimi"
            description="İşletmenin kampanyalarını, menü bağlantılarını, yayın penceresini ve teklif görsellerini tek ekrandan düzenleyebilirsin."
          />

          {!hasValidBusinessId ? (
            <ErrorState
              title="Geçersiz işletme"
              description="URL içindeki işletme bilgisi okunamadı. İşletme paneline güvenli giriş yapıp sayfayı yeniden aç."
            />
          ) : null}

          {dashboardQuery.isPending || (canManage && (offersQuery.isPending || menuItemsQuery.isPending)) ? (
            <LoadingSkeleton />
          ) : null}

          {dashboardQuery.isError ? (
            <ErrorState
              title="Yetki ve işletme özeti yüklenemedi"
              description={`${getApiErrorMessage(dashboardQuery.error)}${
                getApiRequestId(dashboardQuery.error) ? ` · request_id: ${getApiRequestId(dashboardQuery.error)}` : ""
              }`}
            />
          ) : null}

          {canManage && offersQuery.isError ? (
            <ErrorState
              title="Teklifler yüklenemedi"
              description={`${getApiErrorMessage(offersQuery.error)}${
                getApiRequestId(offersQuery.error) ? ` · request_id: ${getApiRequestId(offersQuery.error)}` : ""
              }`}
            />
          ) : null}

          {dashboardQuery.data && !canManage ? (
            <EmptyState
              title="Bu alanı yönetmek için yetkin yeterli değil"
              description="Teklif oluşturma ve düzenleme alanı yönetici veya sahip rolüne açıktır. Kasiyer rolündeysen bu bölümde yalnızca sınırlı görünüm sağlanır."
            />
          ) : null}

          {dashboardQuery.data && canManage ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-zinc-950 p-2.5 text-white">
                        <Megaphone className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-zinc-950">Kampanyalarını net ve güçlü yönet</h2>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">
                          Her teklif menü ürünüyle eşleşebilir, belirli bir zaman penceresinde canlı kalabilir ve görselleriyle birlikte vitrinde öne çıkabilir.
                          Bu ekran, kampanya yönetimini dağınık bırakmadan tek merkezde toplar.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Toplam teklif</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.total}</div></div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Aktif kayıt</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.active}</div></div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Şu an canlı</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.live}</div></div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Öne çıkan</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.featured}</div></div>
                      <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Görsel</div><div className="mt-2 text-2xl font-semibold text-zinc-950">{summary.imageCount}</div></div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200"><Sparkles className="h-4 w-4" /> Bu ekran neyi garanti eder?</div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      Her teklif için yayın zamanı, öne çıkarma kararı, menü bağlantısı ve görsel paketi birlikte yönetilir. Böylece müşteri karşısına eksik ya da dağınık kampanya kartı çıkmaz.
                    </div>
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm"><span>Rolün</span><span className="font-medium text-white">{dashboardQuery.data.business.member_role}</span></div>
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm"><span>Menü ürünü sayısı</span><span className="font-medium text-white">{menuItemsQuery.data?.length ?? 0}</span></div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <ManagementToolbar
                title="Teklif listesi"
                description="Kampanyalarını burada görür, yeni teklif oluşturur ve yayındaki bir fırsatı birkaç adımda güncellersin."
                action={<PrimaryButton onClick={openCreate} disabled={!hasValidBusinessId || isBusy}>Yeni teklif oluştur</PrimaryButton>}
              />

              {offersQuery.data?.length ? (
                <div className="space-y-4">
                  {offersQuery.data.map((item) => {
                    const state = getOfferState(item);
                    const menuItemName = item.menu_item ? menuItemMap.get(item.menu_item) ?? `Ürün #${item.menu_item}` : "Genel teklif";
                    return (
                      <CrudCard
                        key={item.id}
                        title={item.title}
                        subtitle={`${formatCurrency(item.offer_price_amount / 100)} · ${menuItemName}`}
                        badge={
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${state.classes}`}>{state.label}</span>
                            {item.is_featured ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                                <Star className="h-3 w-3" />
                                Öne çıkan
                              </span>
                            ) : null}
                          </div>
                        }
                        actions={
                          <>
                            <SecondaryButton onClick={() => openEdit(item)} disabled={isBusy}>Düzenle</SecondaryButton>
                            <DangerButton onClick={() => deleteMutation.mutate(item.id)} disabled={isBusy || !item.is_active}>
                              {item.is_active ? "Pasife al" : "Pasif"}
                            </DangerButton>
                          </>
                        }
                      >
                        <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl bg-zinc-50 p-4"><div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500"><CalendarRange className="h-3.5 w-3.5" /> Başlangıç</div><div className="mt-2 font-medium text-zinc-900">{formatDateTime(item.starts_at)}</div></div>
                          <div className="rounded-2xl bg-zinc-50 p-4"><div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500"><Clock3 className="h-3.5 w-3.5" /> Bitiş</div><div className="mt-2 font-medium text-zinc-900">{formatDateTime(item.ends_at)}</div></div>
                          <div className="rounded-2xl bg-zinc-50 p-4"><div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500"><Receipt className="h-3.5 w-3.5" /> Günlük limit</div><div className="mt-2 font-medium text-zinc-900">{item.daily_limit ?? "Sınırsız"}</div></div>
                          <div className="rounded-2xl bg-zinc-50 p-4"><div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-zinc-500"><ImagePlus className="h-3.5 w-3.5" /> Fotoğraf sayısı</div><div className="mt-2 font-medium text-zinc-900">{item.media_assets.length}</div></div>
                        </div>

                        {item.short_description ? <p className="text-sm leading-6 text-zinc-700">{item.short_description}</p> : null}

                        {item.media_assets.length ? (
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {item.media_assets.map((image) => (
                              <div key={image.id} className="overflow-hidden rounded-3xl border border-zinc-200 bg-white">
                                <div className="aspect-[4/3] bg-zinc-100">
                                  <img src={image.url} alt={image.alt_text || item.title} className="h-full w-full object-cover" />
                                </div>
                                <div className="space-y-3 p-4">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="text-sm font-medium text-zinc-900">{image.asset_role === "COVER" ? "Kapak görseli" : "Galeri görseli"}</div>
                                    <DangerButton onClick={() => deleteMediaMutation.mutate(image.id)} disabled={isBusy} className="px-3 py-1.5 text-xs">Sil</DangerButton>
                                  </div>
                                  <a href={image.url} target="_blank" rel="noreferrer" className="text-xs font-medium text-zinc-700 underline">Görseli ayrı sekmede aç</a>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 p-4 text-sm text-zinc-600">
                            Bu teklif için henüz görsel eklenmedi. Teklifi düzenleyip kapak veya galeri görselleri ekleyebilirsin.
                          </div>
                        )}
                      </CrudCard>
                    );
                  })}
                </div>
              ) : offersQuery.data && !offersQuery.isPending ? (
                <div className="space-y-4">
                  <EmptyState title="Henüz teklif eklenmedi" description="İlk kampanyanı oluşturarak menü kartlarını güçlendirebilir, uygun fiyatlı seçenekleri vitrinde öne çıkarabilirsin." />
                  <Card className="border-stone-200">
                    <CardContent className="space-y-3 p-6 text-sm leading-6 text-zinc-600">
                      <p className="font-medium text-zinc-900">İyi başlangıç için kısa not</p>
                      <p>Bir teklif için mutlaka kısa bir açıklama, net bir fiyat ve en az bir görsel ekle. Böylece müşteri teklif kartında kampanyanın ne sunduğunu tek bakışta anlar.</p>
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={editingItem ? "Teklifi düzenle" : "Yeni teklif oluştur"} description="Teklif bilgilerini, yayın zamanını ve görsellerini aynı akış içinde kaydet.">
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <Field label="Bağlı menü ürünü">
              <Select value={form.watch("menu_item") ?? ""} onChange={(event) => form.setValue("menu_item", event.target.value ? Number(event.target.value) : null)} disabled={!canManage || isBusy}>
                <option value="">Genel teklif</option>
                {(menuItemsQuery.data ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Başlık" error={form.formState.errors.title?.message}><TextInput {...form.register("title")} disabled={!canManage || isBusy} /></Field>
              <Field label="Teklif fiyatı (kuruş)" error={form.formState.errors.offer_price_amount?.message}><TextInput type="number" {...form.register("offer_price_amount", { valueAsNumber: true })} disabled={!canManage || isBusy} /></Field>
            </div>

            <Field label="Kısa açıklama" error={form.formState.errors.short_description?.message}><TextInput {...form.register("short_description")} disabled={!canManage || isBusy} /></Field>
            <Field label="Detaylı açıklama" error={form.formState.errors.description?.message}><TextArea rows={4} {...form.register("description")} disabled={!canManage || isBusy} /></Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Etiket" error={form.formState.errors.label?.message}><TextInput {...form.register("label")} disabled={!canManage || isBusy} /></Field>
              <Field label="Kısa tag" error={form.formState.errors.tag?.message}><TextInput {...form.register("tag")} disabled={!canManage || isBusy} /></Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Başlangıç zamanı" error={form.formState.errors.starts_at?.message}><TextInput type="datetime-local" {...form.register("starts_at")} disabled={!canManage || isBusy} /></Field>
              <Field label="Bitiş zamanı" error={form.formState.errors.ends_at?.message}><TextInput type="datetime-local" {...form.register("ends_at")} disabled={!canManage || isBusy} /></Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Günlük limit" error={form.formState.errors.daily_limit?.message as string | undefined}><TextInput type="number" {...form.register("daily_limit", { valueAsNumber: true })} disabled={!canManage || isBusy} /></Field>
              <Field label="Sıralama" error={form.formState.errors.sort_order?.message}><TextInput type="number" {...form.register("sort_order", { valueAsNumber: true })} disabled={!canManage || isBusy} /></Field>
            </div>

            <Card className="border-stone-200 bg-zinc-50/80">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2 text-sm font-medium text-zinc-900"><ImagePlus className="h-4 w-4" /> Teklif görselleri</div>
                <Field label="Kapak görseli URL" error={form.formState.errors.cover_image_url?.message}><TextInput {...form.register("cover_image_url")} disabled={!canManage || isBusy} /></Field>
                <Field label="Galeri görselleri" hint="Her satıra bir görsel adresi gir. Kaydettiğinde eksilen görseller silinir, yeni olanlar eklenir." error={form.formState.errors.gallery_image_urls?.message}>
                  <TextArea rows={5} {...form.register("gallery_image_urls")} disabled={!canManage || isBusy} />
                </Field>
              </CardContent>
            </Card>

            <ToggleRow label="Teklif aktif" description="Pasif teklif planlı olsa da vitrinde canlı görünmez." checked={form.watch("is_active")} onChange={(next) => form.setValue("is_active", next)} disabled={!canManage || isBusy} />
            <ToggleRow label="Öne çıkar" description="Açık olduğunda teklif üst sıralarda ve daha güçlü vurgu ile gösterilir." checked={form.watch("is_featured")} onChange={(next) => form.setValue("is_featured", next)} disabled={!canManage || isBusy} />

            <div className="flex flex-wrap gap-3 pt-2">
              <PrimaryButton type="submit" disabled={!canManage || isBusy}>{isBusy ? "Kaydediliyor..." : editingItem ? "Güncelle" : "Oluştur"}</PrimaryButton>
              <SecondaryButton type="button" onClick={() => setSheetOpen(false)}>Vazgeç</SecondaryButton>
            </div>
          </form>
        </Sheet>
      </BusinessPanelShell>
    </PageContainer>
  );
}
