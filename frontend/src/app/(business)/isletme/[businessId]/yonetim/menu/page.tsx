"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, ImagePlus, LayoutGrid, PackageCheck, ShoppingBag, Tags } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { isManagementRole } from "@/components/business/business-role";
import { EntityImageManager } from "@/components/business-management/entity-image-manager";
import {
  CrudCard,
  DangerButton,
  Field,
  ManagementToolbar,
  PrimaryButton,
  SecondaryButton,
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
  createBusinessMenuItem,
  deleteBusinessMenuItem,
  getBusinessDashboardSummary,
  listBusinessCategories,
  listBusinessMenuItems,
  updateBusinessMenuItem,
} from "@/features/business-operations/api";
import {
  createEmptyEntityImageState,
  createEntityImageState,
  disposeEntityImageState,
  syncEntityImages,
  type EntityImageState,
} from "@/features/business-operations/media-sync";
import type {
  BusinessCategoryItem,
  BusinessMenuItem,
  BusinessMenuItemInput,
} from "@/features/business-operations/types";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";

const schema = z.object({
  marketplace_category_ids: z.array(z.number().int().positive()).min(1, "En az bir sistem kategorisi seçmelisin."),
  name: z.string().trim().min(1, "Ürün adı zorunlu.").max(160),
  slug: z.string().trim().min(1, "Bağlantı adı zorunlu.").max(180),
  description: z.string().max(2000).optional().default(""),
  price_amount: z.coerce.number().int().positive("Fiyat 0'dan büyük olmalı."),
  sort_order: z.coerce.number().int().min(0),
  is_active: z.boolean(),
  is_visible: z.boolean(),
  is_available: z.boolean(),
});

type FormValues = z.input<typeof schema>;
type FormSubmitValues = z.output<typeof schema>;

const defaults: FormValues = {
  marketplace_category_ids: [],
  name: "",
  slug: "",
  description: "",
  price_amount: 0,
  sort_order: 0,
  is_active: true,
  is_visible: true,
  is_available: true,
};

function CategorySelector({
  categories,
  value,
  onChange,
}: {
  categories: BusinessCategoryItem[];
  value: number[];
  onChange: (next: number[]) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {categories.map((category) => {
          const checked = value.includes(category.id);
          return (
            <button
              key={category.id}
              type="button"
              onClick={() =>
                onChange(checked ? value.filter((item) => item !== category.id) : [...value, category.id])
              }
              className={cn(
                "rounded-full border px-3 py-2 text-sm font-medium transition",
                checked
                  ? "border-zinc-950 bg-zinc-950 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
              )}
            >
              {category.name}
            </button>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-zinc-500">
        Ürünler yalnızca HalkYemek sistem kategorilerine bağlanır. Bir ürün aynı anda birden fazla kategoride görünür olabilir.
      </p>
    </div>
  );
}

function SummaryCard({
  icon,
  title,
  value,
  description,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  description: string;
}) {
  return (
    <Card className="border-stone-200 bg-white">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-600">
          {icon}
          {title}
        </div>
        <div className="text-2xl font-semibold tracking-tight text-zinc-950">{value}</div>
        <p className="text-sm leading-6 text-zinc-500">{description}</p>
      </CardContent>
    </Card>
  );
}

function getAvailabilityBadge(item: BusinessMenuItem) {
  if (!item.is_active) {
    return { label: "Pasif", classes: "bg-zinc-200 text-zinc-700" };
  }
  if (!item.is_visible) {
    return { label: "Gizli", classes: "bg-amber-100 text-amber-800" };
  }
  if (!item.is_available) {
    return { label: "Geçici kapalı", classes: "bg-red-100 text-red-700" };
  }
  return { label: "Yayında", classes: "bg-emerald-100 text-emerald-700" };
}

export default function BusinessMenuManagementPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);
  const hasValidBusinessId = Number.isFinite(businessId) && businessId > 0;
  const queryClient = useQueryClient();
  const [editingItem, setEditingItem] = useState<BusinessMenuItem | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [imageState, setImageState] = useState<EntityImageState>(() => createEmptyEntityImageState());
  const imageStateRef = useRef<EntityImageState>(imageState);

  useEffect(() => {
    imageStateRef.current = imageState;
  }, [imageState]);

  useEffect(
    () => () => {
      disposeEntityImageState(imageStateRef.current);
    },
    [],
  );

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
      disposeEntityImageState(imageStateRef.current);
      const empty = createEmptyEntityImageState();
      imageStateRef.current = empty;
      setImageState(empty);
    }
  }, [form, sheetOpen]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "categories"] }),
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "menu-items"] }),
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "offers"] }),
      queryClient.invalidateQueries({ queryKey: ["business-management", businessId, "media"] }),
      queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-detail", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "business-menu", businessId] }),
      queryClient.invalidateQueries({ queryKey: ["catalog", "businesses"] }),
      queryClient.invalidateQueries({ queryKey: ["discovery", "home"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async ({ values, images }: { values: BusinessMenuItemInput; images: EntityImageState }) => {
      const item = await createBusinessMenuItem(businessId, values);
      await syncEntityImages({
        businessId,
        target: { menu_item: item.id },
        currentImages: [],
        nextState: images,
        defaultAltText: values.name,
      });
      return item;
    },
    onSuccess: async () => {
      toast.success("Menü ürünü ve fotoğrafları kaydedildi.");
      setSheetOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Menü ürünü kaydedilemedi.")),
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      item,
      values,
      images,
    }: {
      item: BusinessMenuItem;
      values: Partial<BusinessMenuItemInput>;
      images: EntityImageState;
    }) => {
      const updated = await updateBusinessMenuItem(businessId, item.id, values);
      await syncEntityImages({
        businessId,
        target: { menu_item: item.id },
        currentImages: item.media_assets,
        nextState: images,
        defaultAltText: values.name || item.name,
      });
      return updated;
    },
    onSuccess: async () => {
      toast.success("Menü ürünü güncellendi.");
      setSheetOpen(false);
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Menü ürünü güncellenemedi.")),
  });

  const deleteMutation = useMutation({
    mutationFn: (menuItemId: number) => deleteBusinessMenuItem(businessId, menuItemId),
    onSuccess: async () => {
      toast.success("Ürün yayından kaldırıldı.");
      await invalidate();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Ürün silinemedi.")),
  });

  const menuSummary = useMemo(() => {
    const items = menuItemsQuery.data ?? [];
    return {
      total: items.length,
      active: items.filter((item) => item.is_active).length,
      visible: items.filter((item) => item.is_visible).length,
      imageCount: items.reduce((count, item) => count + item.media_assets.length, 0),
    };
  }, [menuItemsQuery.data]);

  function openCreate() {
    form.reset(defaults);
    setEditingItem(null);
    setImageState(createEmptyEntityImageState());
    setSheetOpen(true);
  }

  function openEdit(item: BusinessMenuItem) {
    setEditingItem(item);
    form.reset({
      marketplace_category_ids: item.marketplace_categories.map((category) => category.id),
      name: item.name,
      slug: item.slug,
      description: item.description ?? "",
      price_amount: item.price_amount,
      sort_order: item.sort_order,
      is_active: item.is_active,
      is_visible: item.is_visible,
      is_available: item.is_available,
    });
    setImageState(createEntityImageState(item.media_assets));
    setSheetOpen(true);
  }

  function onSubmit(values: FormSubmitValues) {
    const payload = {
      marketplace_category_ids: values.marketplace_category_ids,
      name: values.name,
      slug: values.slug,
      description: values.description ?? "",
      price_amount: values.price_amount,
      sort_order: values.sort_order,
      is_active: values.is_active,
      is_visible: values.is_visible,
      is_available: values.is_available,
    };

    const images = imageStateRef.current;
    if (editingItem) {
      updateMutation.mutate({ item: editingItem, values: payload, images });
      return;
    }
    createMutation.mutate({ values: payload, images });
  }

  const isBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const selectedCategoryIds = form.watch("marketplace_category_ids");
  const itemCount = menuItemsQuery.data?.length ?? 0;

  return (
    <PageContainer>
      <BusinessPanelShell businessId={hasValidBusinessId ? businessId : null}>
        <div className="space-y-6">
          <SectionHeader
            title="Menü yönetimi"
            description="Ürünlerini, kategori eşleşmelerini ve fotoğraflarını tek akışta düzenle. Görselleri linkle değil, dosya seçerek yönet."
          />

          {!hasValidBusinessId ? (
            <ErrorState
              title="Geçersiz işletme"
              description="URL içindeki işletme bilgisi okunamadı. İşletme paneline güvenli giriş yapıp sayfayı yeniden aç."
            />
          ) : null}

          {dashboardQuery.isPending || (canManage && (categoriesQuery.isPending || menuItemsQuery.isPending)) ? (
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

          {canManage && categoriesQuery.isError ? (
            <ErrorState
              title="Kategori eşleşmeleri yüklenemedi"
              description={`${getApiErrorMessage(categoriesQuery.error)}${
                getApiRequestId(categoriesQuery.error) ? ` · request_id: ${getApiRequestId(categoriesQuery.error)}` : ""
              }`}
            />
          ) : null}

          {canManage && menuItemsQuery.isError ? (
            <ErrorState
              title="Menü ürünleri yüklenemedi"
              description={`${getApiErrorMessage(menuItemsQuery.error)}${
                getApiRequestId(menuItemsQuery.error) ? ` · request_id: ${getApiRequestId(menuItemsQuery.error)}` : ""
              }`}
            />
          ) : null}

          {dashboardQuery.data && !canManage ? (
            <EmptyState
              title="Bu alanı yönetmek için yetkin yeterli değil"
              description="Menü oluşturma ve düzenleme alanı yönetici veya sahip rolüne açıktır. Kasiyer rolündeysen bu bölümde yalnızca sınırlı görünüm sağlanır."
            />
          ) : null}

          {dashboardQuery.data && canManage ? (
            <>
              <div className="grid gap-4 xl:grid-cols-[1.08fr_0.92fr]">
                <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
                  <CardContent className="space-y-5 p-6">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-zinc-950 p-2.5 text-white">
                        <ShoppingBag className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-xl font-semibold tracking-tight text-zinc-950">
                          Menü kartlarını güçlü ve düzenli tut
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-zinc-600">
                          Her ürün sistem kategorilerine bağlı, görselleri eksiksiz ve vitrinde güven veren bir yapıda olmalı. Bu ekran, hem içerik düzenini hem de fotoğraf kalitesini tek merkezde toplar.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <SummaryCard
                        icon={<LayoutGrid className="h-4 w-4" />}
                        title="Toplam ürün"
                        value={String(menuSummary.total)}
                        description="İşletmene bağlı tüm menü kayıtları."
                      />
                      <SummaryCard
                        icon={<PackageCheck className="h-4 w-4" />}
                        title="Aktif ürün"
                        value={String(menuSummary.active)}
                        description="Şu an yayına açık ürün sayısı."
                      />
                      <SummaryCard
                        icon={<Eye className="h-4 w-4" />}
                        title="Görünür ürün"
                        value={String(menuSummary.visible)}
                        description="Müşterinin vitrinde görebildiği kayıtlar."
                      />
                      <SummaryCard
                        icon={<ImagePlus className="h-4 w-4" />}
                        title="Toplam görsel"
                        value={String(menuSummary.imageCount)}
                        description="Menü kartlarına bağlanan aktif fotoğraflar."
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-stone-200 bg-zinc-950 text-white">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                      <Tags className="h-4 w-4" />
                      Bu ekran neyi garanti eder?
                    </div>
                    <div className="rounded-2xl bg-white/5 p-4 text-sm leading-6 text-zinc-200">
                      İşletme kendi kafasına göre kategori açmaz. Her ürün, HalkYemek sistem kategorilerine bağlanır. Böylece müşteri tarafında kategori gezintisi bozulmadan, doğru ürün doğru yerde görünür.
                    </div>
                    <div className="grid gap-3">
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
                        <span>Rolün</span>
                        <span className="font-medium text-white">{dashboardQuery.data.business.member_role}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
                        <span>Sistem kategorisi sayısı</span>
                        <span className="font-medium text-white">{categoriesQuery.data?.length ?? 0}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-sm">
                        <span>Yönetilen menü kaydı</span>
                        <span className="font-medium text-white">{itemCount}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <ManagementToolbar
                title="Menü ürünleri"
                description="Ürün ekleyebilir, fiyat ve görünürlük kararlarını düzenleyebilir, kapak ve galeri fotoğraflarını tek akışta yönetebilirsin."
                action={
                  <PrimaryButton onClick={openCreate} disabled={!hasValidBusinessId || isBusy}>
                    Yeni ürün oluştur
                  </PrimaryButton>
                }
              />

              {menuItemsQuery.data?.length ? (
                <div className="space-y-4">
                  {menuItemsQuery.data.map((item) => {
                    const state = getAvailabilityBadge(item);
                    return (
                      <CrudCard
                        key={item.id}
                        title={item.name}
                        subtitle={`${formatCurrency(item.price_amount / 100)} · ${item.marketplace_categories.length} sistem kategorisi`}
                        badge={
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${state.classes}`}>
                              {state.label}
                            </span>
                            {!item.is_visible ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
                                <EyeOff className="h-3 w-3" />
                                Vitrinden gizli
                              </span>
                            ) : null}
                          </div>
                        }
                        actions={
                          <>
                            <SecondaryButton onClick={() => openEdit(item)} disabled={isBusy}>
                              Düzenle
                            </SecondaryButton>
                            <DangerButton onClick={() => deleteMutation.mutate(item.id)} disabled={isBusy}>
                              Sil
                            </DangerButton>
                          </>
                        }
                      >
                        <div className="grid gap-4 xl:grid-cols-[0.88fr_1.12fr]">
                          <div className="space-y-3">
                            {item.primary_image_url ? (
                              <div className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
                                <div className="aspect-[16/10] bg-zinc-100">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={item.primary_image_url}
                                    alt={item.name}
                                    className="h-full w-full object-cover"
                                  />
                                </div>
                              </div>
                            ) : (
                              <div className="flex aspect-[16/10] items-center justify-center rounded-[28px] border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-500">
                                Bu ürün için henüz fotoğraf eklenmedi
                              </div>
                            )}

                            {item.media_assets.length > 1 ? (
                              <div className="grid grid-cols-3 gap-2">
                                {item.media_assets.slice(0, 3).map((image) => (
                                  <div key={image.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
                                    <div className="aspect-square bg-zinc-100">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={image.url}
                                        alt={image.alt_text || item.name}
                                        className="h-full w-full object-cover"
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>

                          <div className="space-y-4">
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="rounded-2xl bg-zinc-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Sıralama</div>
                                <div className="mt-2 text-base font-semibold text-zinc-950">{item.sort_order}</div>
                              </div>
                              <div className="rounded-2xl bg-zinc-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Fotoğraf</div>
                                <div className="mt-2 text-base font-semibold text-zinc-950">{item.media_assets.length}</div>
                              </div>
                              <div className="rounded-2xl bg-zinc-50 p-4">
                                <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Bağlı kategori</div>
                                <div className="mt-2 text-base font-semibold text-zinc-950">
                                  {item.marketplace_categories.length}
                                </div>
                              </div>
                            </div>

                            {item.description ? (
                              <p className="text-sm leading-6 text-zinc-700">{item.description}</p>
                            ) : (
                              <p className="text-sm leading-6 text-zinc-500">
                                Bu ürün için henüz detaylı açıklama eklenmedi.
                              </p>
                            )}

                            <div className="space-y-2">
                              <p className="text-sm font-medium text-zinc-900">Sistem kategorileri</p>
                              <div className="flex flex-wrap gap-2">
                                {item.marketplace_categories.map((category) => (
                                  <span
                                    key={category.id}
                                    className={cn(
                                      "rounded-full px-3 py-1.5 text-xs font-medium",
                                      category.is_primary
                                        ? "bg-zinc-950 text-white"
                                        : "bg-zinc-100 text-zinc-700",
                                    )}
                                  >
                                    {category.name}
                                    {category.is_primary ? " · Ana kategori" : ""}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CrudCard>
                    );
                  })}
                </div>
              ) : menuItemsQuery.data && !menuItemsQuery.isPending ? (
                <div className="space-y-4">
                  <EmptyState
                    title="Henüz ürün eklenmedi"
                    description="İlk ürünü oluşturarak işletme menünü görünür hale getirebilir, fotoğraf ve kategori eşleşmesini aynı adımda tamamlayabilirsin."
                  />
                  <Card className="border-stone-200">
                    <CardContent className="space-y-3 p-6 text-sm leading-6 text-zinc-600">
                      <p className="font-medium text-zinc-900">İyi başlangıç için kısa not</p>
                      <p>
                        İlk ürününde net isim, doğru fiyat, en az bir kapak görseli ve doğru sistem kategorisi kullan. Böylece müşteri kategori gezintisinde ürününü güvenle görür.
                      </p>
                    </CardContent>
                  </Card>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={editingItem ? "Ürünü düzenle" : "Yeni ürün oluştur"}
          description="Ürün bilgilerini, sistem kategori eşleşmelerini ve fotoğraflarını aynı akış içinde kaydet."
        >
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <Field
              label="Sistem kategorileri"
              hint="Müşteri tarafındaki kategori gezintisi bu seçimlere göre çalışır."
              error={form.formState.errors.marketplace_category_ids?.message}
            >
              <CategorySelector
                categories={categoriesQuery.data ?? []}
                value={selectedCategoryIds}
                onChange={(next) =>
                  form.setValue("marketplace_category_ids", next, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                }
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Ürün adı" error={form.formState.errors.name?.message}>
                <TextInput {...form.register("name")} disabled={!canManage || isBusy} />
              </Field>
              <Field label="Bağlantı adı" error={form.formState.errors.slug?.message}>
                <TextInput {...form.register("slug")} disabled={!canManage || isBusy} />
              </Field>
            </div>

            <Field label="Açıklama" error={form.formState.errors.description?.message}>
              <TextArea
                rows={4}
                {...form.register("description")}
                disabled={!canManage || isBusy}
                placeholder="Ürünün içeriğini, porsiyon bilgisini veya dikkat çekici detayını ekleyebilirsin."
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Fiyat (kuruş)" error={form.formState.errors.price_amount?.message}>
                <TextInput
                  type="number"
                  {...form.register("price_amount", { valueAsNumber: true })}
                  disabled={!canManage || isBusy}
                />
              </Field>
              <Field label="Sıralama" error={form.formState.errors.sort_order?.message}>
                <TextInput
                  type="number"
                  {...form.register("sort_order", { valueAsNumber: true })}
                  disabled={!canManage || isBusy}
                />
              </Field>
            </div>

            <EntityImageManager
              value={imageState}
              onChange={setImageState}
              disabled={!canManage || isBusy}
              title="Ürün fotoğrafları"
              description="Kapak ve galeri görsellerini doğrudan cihazından seç. Kaydettiğinde eski görseller temizlenir, yeniler profesyonel şekilde güncellenir."
            />

            <ToggleRow
              label="Ürün aktif"
              description="Pasif ürün kaydı arşivde kalır ancak müşteri tarafında yayında görünmez."
              checked={form.watch("is_active")}
              onChange={(next) => form.setValue("is_active", next)}
              disabled={!canManage || isBusy}
            />
            <ToggleRow
              label="Vitrinde görünür"
              description="Kapalıysa ürün kayıtlı kalır ama müşteri bu ürünü listede görmez."
              checked={form.watch("is_visible")}
              onChange={(next) => form.setValue("is_visible", next)}
              disabled={!canManage || isBusy}
            />
            <ToggleRow
              label="Şu anda satışta"
              description="Geçici olarak servis dışı bir ürünü silmeden kapatmak için bu alanı kullan."
              checked={form.watch("is_available")}
              onChange={(next) => form.setValue("is_available", next)}
              disabled={!canManage || isBusy}
            />

            <div className="flex flex-wrap gap-3 pt-2">
              <PrimaryButton type="submit" disabled={!canManage || isBusy}>
                {isBusy ? "Kaydediliyor..." : editingItem ? "Güncelle" : "Oluştur"}
              </PrimaryButton>
              <SecondaryButton type="button" onClick={() => setSheetOpen(false)}>
                Vazgeç
              </SecondaryButton>
            </div>
          </form>
        </Sheet>
      </BusinessPanelShell>
    </PageContainer>
  );
}
