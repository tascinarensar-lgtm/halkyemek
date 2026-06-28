"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Banknote, CheckCircle2, ImagePlus, MapPin, ReceiptText, Save, Store, Trash2, UploadCloud, UsersRound, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import { ProtectedPageShell } from "@/components/layout/protected-page-shell";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { createBusinessMenuItem, deleteBusinessMediaAsset, deleteBusinessMenuItem, listBusinessCategories, listBusinessMenuItems, updateBusinessMenuItem, uploadBusinessMediaAsset } from "@/features/business-operations/api";
import type { BusinessCategoryItem, BusinessMenuItem } from "@/features/business-operations/types";
import {
  deactivateOpsBusinessMembership,
  getOpsBusinessDetail,
  getReconcileBusiness,
  listOpsBusinessMemberships,
  triggerOpsSubmerchant,
  updateOpsBusinessStatus,
  upsertOpsBusinessMembership,
} from "@/features/ops-console/api";
import type { OpsBusinessDetail, OpsBusinessMembership } from "@/features/ops-console/types";
import { invalidateOpsQueries, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

type EditFormState = {
  business_name: string;
  category: string;
  supports_halkyemek: boolean;
  supports_halktasarruf: boolean;
  adress: string;
  address_line: string;
  google_maps_url: string;
  latitude: string;
  longitude: string;
  listing_type: string;
  display_priority: number;
  is_active: boolean;
  is_approved: boolean;
  is_listed: boolean;
  marketplace_is_visible: boolean;
  is_featured: boolean;
  payout_onboarding_note: string;
  kyc_contact_name: string;
  kyc_contact_surname: string;
  kyc_identity_number: string;
  kyc_tax_number: string;
  kyc_iban: string;
};

type MenuInlineFormState = {
  editingId: number | null;
  name: string;
  description: string;
  imageFile: File | null;
  imagePreviewUrl: string;
  price: string;
  minimum_grams: string;
  categoryId: string;
  quota_enabled: boolean;
  quota_total: string;
  is_active: boolean;
  is_visible: boolean;
  is_available: boolean;
};

type MembershipInlineFormState = {
  userIdentifier: string;
  role: string;
  access_halkyemek: boolean;
  access_halktasarruf: boolean;
};

const DEFAULT_FORM: EditFormState = {
  business_name: "",
  category: "",
  supports_halkyemek: true,
  supports_halktasarruf: false,
  adress: "",
  address_line: "",
  google_maps_url: "",
  latitude: "",
  longitude: "",
  listing_type: "CONTRACTED",
  display_priority: 0,
  is_active: true,
  is_approved: true,
  is_listed: true,
  marketplace_is_visible: true,
  is_featured: false,
  payout_onboarding_note: "",
  kyc_contact_name: "",
  kyc_contact_surname: "",
  kyc_identity_number: "",
  kyc_tax_number: "",
  kyc_iban: "",
};

const DEFAULT_MENU_FORM: MenuInlineFormState = {
  editingId: null,
  name: "",
  description: "",
  imageFile: null,
  imagePreviewUrl: "",
  price: "",
  minimum_grams: "",
  categoryId: "",
  quota_enabled: false,
  quota_total: "",
  is_active: true,
  is_visible: true,
  is_available: true,
};

const DEFAULT_MEMBERSHIP_FORM: MembershipInlineFormState = {
  userIdentifier: "",
  role: "MANAGER",
  access_halkyemek: true,
  access_halktasarruf: false,
};

const LISTING_OPTIONS = [
  { value: "CONTRACTED", label: "Anlaşmalı işletme" },
  { value: "VOLUNTEER", label: "Gönüllü işletme" },
];

const ROLE_OPTIONS = [
  { value: "OWNER", label: "İşletme sahibi" },
  { value: "MANAGER", label: "Yönetici" },
  { value: "CASHIER", label: "Kasa görevlisi" },
];

const CATEGORY_OPTIONS = ["Burger", "Pizza", "Döner", "Kebap"];

const PRODUCT_TOGGLES: Array<{ key: keyof Pick<EditFormState, "supports_halkyemek" | "supports_halktasarruf">; label: string }> = [
  { key: "supports_halkyemek", label: "HalkYemek'te aktif" },
  { key: "supports_halktasarruf", label: "HalkTasarruf'ta aktif" },
];

const STATUS_TOGGLES: Array<{ key: keyof Pick<EditFormState, "is_active" | "is_approved" | "is_listed" | "marketplace_is_visible" | "is_featured">; label: string }> = [
  { key: "is_active", label: "Aktif" },
  { key: "is_approved", label: "Onaylı" },
  { key: "is_listed", label: "Listede" },
  { key: "marketplace_is_visible", label: "Pazaryerinde görünür" },
  { key: "is_featured", label: "Öne çıkar" },
];

const MENU_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const MAX_MENU_IMAGE_BYTES = 8 * 1024 * 1024;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function recordText(record: Record<string, unknown>, key: string) {
  return text(record[key]);
}

function cleanOptional(value: string) {
  const next = value.trim();
  return next ? next : undefined;
}

function numericOrNull(value: string) {
  const cleaned = value.trim().replace(",", ".");
  return cleaned ? Number(cleaned) : null;
}

function formatAmount(amount: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function slugify(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parsePriceToAmount(value: string) {
  const parsed = Number(value.replace(",", ".").trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Menü fiyatı geçerli bir tutar olmalıdır.");
  }
  return Math.round(parsed * 100);
}

function parseOptionalNonNegativeInteger(value: string, fieldLabel: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldLabel} sıfır veya daha büyük bir tam sayı olmalıdır.`);
  }
  return parsed;
}

function formatMenuQuotaBadge(item: BusinessMenuItem) {
  if (!item.quota_enabled || item.quota_remaining === null) return "Sınırsız";
  if (item.quota_remaining <= 0) return "Tükendi";
  return `${item.quota_remaining} adet bulunmakta`;
}

function formatRoleLabel(role: string) {
  if (role === "OWNER") return "İşletme sahibi";
  if (role === "MANAGER") return "Yönetici";
  if (role === "CASHIER") return "Kasa görevlisi";
  return role;
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function getIssueCount(value: unknown) {
  const record = getRecord(value);
  const issues = record.issues;
  return Array.isArray(issues) ? issues.length : 0;
}

function getSummaryValue(value: unknown, key: string) {
  const summary = getRecord(getRecord(value).summary);
  const item = summary[key];
  return item === undefined || item === null || item === "" ? "-" : String(item);
}

function getMenuImageUrl(item: BusinessMenuItem | null | undefined) {
  if (!item) return "";
  return item.primary_image_url || item.image_url || item.media_assets?.[0]?.url || item.media_assets?.[0]?.file_url || "";
}

function imageBackgroundStyle(url: string) {
  return url ? { backgroundImage: `url("${url.replace(/"/g, "%22")}")` } : undefined;
}

function validateMenuImageFile(file: File) {
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Menü fotoğrafı yalnızca görsel dosyası olabilir.");
  }
  if (file.size > MAX_MENU_IMAGE_BYTES) {
    throw new Error("Menü fotoğrafı en fazla 8 MB olabilir.");
  }
}

function createMenuImageUploadPayload(options: { file: File; menuItemId: number; altText: string }) {
  const formData = new FormData();
  formData.set("file", options.file);
  formData.set("menu_item", String(options.menuItemId));
  formData.set("media_type", "IMAGE");
  formData.set("asset_role", "THUMBNAIL");
  formData.set("sort_order", "0");
  formData.set("is_active", "true");
  if (options.altText.trim()) {
    formData.set("alt_text", options.altText.trim());
  }
  return formData;
}

function revokeBlobUrl(url: string) {
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

function buildMenuPayload(form: MenuInlineFormState) {
  const categoryId = Number(form.categoryId);
  if (!form.name.trim()) {
    throw new Error("Menü adı zorunludur.");
  }
  if (!Number.isInteger(categoryId) || categoryId <= 0) {
    throw new Error("Menü için kategori seçmelisin.");
  }

  let quotaTotal: number | null = null;
  let quotaRemaining: number | null = null;
  let lowStockThreshold = 12;
  const minimumGrams = form.minimum_grams.trim() ? parseOptionalNonNegativeInteger(form.minimum_grams, "Minimum gram bilgisi") : null;

  if (form.quota_enabled) {
    quotaTotal = parseOptionalNonNegativeInteger(form.quota_total, "Kota adedi");

    if (quotaTotal === null) {
      throw new Error("Kota aktifken kota adedini doldurmalısın.");
    }
    quotaRemaining = quotaTotal;
  }

  return {
    name: form.name.trim(),
    slug: slugify(form.name),
    description: form.description.trim(),
    minimum_grams: minimumGrams === 0 ? null : minimumGrams,
    price_amount: parsePriceToAmount(form.price),
    marketplace_category_ids: [categoryId],
    quota_enabled: form.quota_enabled,
    quota_total: quotaTotal,
    quota_remaining: quotaRemaining,
    low_stock_threshold: lowStockThreshold,
    is_active: form.is_active,
    is_visible: form.is_visible,
    is_available: form.is_available,
  };
}

function toMenuForm(item: BusinessMenuItem): MenuInlineFormState {
  const imageUrl = getMenuImageUrl(item);
  return {
    editingId: item.id,
    name: item.name,
    description: item.description || "",
    imageFile: null,
    imagePreviewUrl: imageUrl,
    price: String(item.price_amount / 100),
    minimum_grams: item.minimum_grams === null ? "" : String(item.minimum_grams),
    categoryId: String(item.marketplace_categories[0]?.id || ""),
    quota_enabled: item.quota_enabled,
    quota_total: item.quota_remaining === null ? (item.quota_total === null ? "" : String(item.quota_total)) : String(item.quota_remaining),
    is_active: item.is_active,
    is_visible: item.is_visible,
    is_available: item.is_available,
  };
}

function buildForm(data: OpsBusinessDetail | undefined): EditFormState {
  if (!data) return DEFAULT_FORM;
  const onboarding = data.iyzico_onboarding || {};
  return {
    business_name: data.business_name || "",
    category: data.category || "",
    supports_halkyemek: Boolean(data.supports_halkyemek),
    supports_halktasarruf: Boolean(data.supports_halktasarruf),
    adress: data.adress || data.address_line || "",
    address_line: data.address_line || "",
    google_maps_url: data.google_maps_url || "",
    latitude: data.latitude === null || data.latitude === undefined ? "" : String(data.latitude),
    longitude: data.longitude === null || data.longitude === undefined ? "" : String(data.longitude),
    listing_type: data.listing_type || "CONTRACTED",
    display_priority: Number(data.display_priority || 0),
    is_active: Boolean(data.is_active),
    is_approved: Boolean(data.is_approved),
    is_listed: Boolean(data.is_listed),
    marketplace_is_visible: Boolean(data.marketplace_is_visible),
    is_featured: Boolean(data.is_featured),
    payout_onboarding_note: data.payout_onboarding_note || "",
    kyc_contact_name: data.kyc_contact_name || recordText(onboarding, "kyc_contact_name"),
    kyc_contact_surname: data.kyc_contact_surname || recordText(onboarding, "kyc_contact_surname"),
    kyc_identity_number: data.kyc_identity_number || recordText(onboarding, "kyc_identity_number"),
    kyc_tax_number: data.kyc_tax_number || recordText(onboarding, "kyc_tax_number"),
    kyc_iban: data.kyc_iban || recordText(onboarding, "kyc_iban"),
  };
}

function fieldClassName() {
  return "w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-[#f50555]/45 focus:bg-white focus:ring-4 focus:ring-rose-100";
}

function SectionTitle({ icon: Icon, eyebrow, title }: { icon: LucideIcon; eyebrow: string; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555]">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f50555]">{eyebrow}</p>
        <h2 className="mt-1 text-xl font-semibold tracking-[-0.04em] text-zinc-950">{title}</h2>
      </div>
    </div>
  );
}

export default function OpsBusinessDetailPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["ops", "business", businessId],
    queryFn: () => getOpsBusinessDetail(businessId as number),
    enabled: businessId !== null,
  });
  const [form, setForm] = useState<EditFormState>(DEFAULT_FORM);
  const [menuForm, setMenuForm] = useState<MenuInlineFormState>(DEFAULT_MENU_FORM);
  const [membershipForm, setMembershipForm] = useState<MembershipInlineFormState>(DEFAULT_MEMBERSHIP_FORM);
  const baseline = useMemo(() => buildForm(detailQuery.data), [detailQuery.data]);
  const detailMemberships = detailQuery.data?.memberships ?? [];
  const categoriesQuery = useQuery({
    queryKey: ["ops", "business-inline", businessId, "categories"],
    queryFn: () => listBusinessCategories(businessId as number),
    enabled: businessId !== null,
  });
  const menuItemsQuery = useQuery({
    queryKey: ["ops", "business-inline", businessId, "menu-items"],
    queryFn: () => listBusinessMenuItems(businessId as number),
    enabled: businessId !== null,
  });
  const membershipsQuery = useQuery({
    queryKey: ["ops", "business-memberships", businessId],
    queryFn: () => listOpsBusinessMemberships(businessId as number),
    enabled: businessId !== null,
  });
  const reconcileQuery = useQuery({
    queryKey: ["ops", "reconcile", businessId],
    queryFn: () => getReconcileBusiness(businessId as number),
    enabled: businessId !== null,
  });
  const categories = categoriesQuery.data ?? [];
  const selectedCategories = categories.filter((category) => category.is_selected);
  const menuCategoryOptions = selectedCategories.length ? selectedCategories : categories;
  const menuItems = menuItemsQuery.data ?? [];
  const memberships = membershipsQuery.data ?? detailMemberships;
  const reconcileIssueCount = getIssueCount(reconcileQuery.data);
  const onboarding = getRecord(detailQuery.data?.iyzico_onboarding);
  const missingPaymentFields = ["kyc_contact_name", "kyc_contact_surname", "kyc_iban"].filter((key) => !text(onboarding[key]));

  useEffect(() => {
    if (!detailQuery.data) return;
    setForm(buildForm(detailQuery.data));
  }, [detailQuery.data]);

  useEffect(() => {
    if (menuForm.categoryId || !menuCategoryOptions.length) return;
    setMenuForm((current) => ({ ...current, categoryId: String(menuCategoryOptions[0].id) }));
  }, [menuCategoryOptions, menuForm.categoryId]);

  useEffect(() => {
    const previewUrl = menuForm.imagePreviewUrl;
    return () => revokeBlobUrl(previewUrl);
  }, [menuForm.imagePreviewUrl]);

  const formIssues = useMemo(() => {
    const issues: string[] = [];
    if (!form.business_name.trim()) issues.push("İşletme adı zorunludur.");
    if (!form.category.trim()) issues.push("Kategori zorunludur.");
    if (!form.supports_halkyemek && !form.supports_halktasarruf) issues.push("İşletme en az bir üründe aktif olmalıdır.");
    const latitude = numericOrNull(form.latitude);
    const longitude = numericOrNull(form.longitude);
    if ((latitude === null && longitude !== null) || (latitude !== null && longitude === null)) {
      issues.push("Enlem ve boylam birlikte girilmelidir.");
    }
    if (latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) {
      issues.push("Enlem -90 ile 90 arasında olmalıdır.");
    }
    if (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) {
      issues.push("Boylam -180 ile 180 arasında olmalıdır.");
    }
    return issues;
  }, [form]);
  const hasChanges = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [baseline, form]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateOpsBusinessStatus(businessId as number, {
        business_name: form.business_name.trim(),
        category: form.category.trim(),
        supports_halkyemek: form.supports_halkyemek,
        supports_halktasarruf: form.supports_halktasarruf,
        adress: form.adress.trim(),
        address_line: cleanOptional(form.address_line) ?? null,
        google_maps_url: cleanOptional(form.google_maps_url) ?? null,
        latitude: numericOrNull(form.latitude),
        longitude: numericOrNull(form.longitude),
        listing_type: form.listing_type,
        display_priority: Number(form.display_priority || 0),
        is_active: form.is_active,
        is_approved: form.is_approved,
        is_listed: form.is_listed,
        marketplace_is_visible: form.marketplace_is_visible,
        is_featured: form.is_featured,
        payout_onboarding_note: form.payout_onboarding_note,
        kyc_contact_name: form.kyc_contact_name.trim(),
        kyc_contact_surname: form.kyc_contact_surname.trim(),
        kyc_identity_number: form.kyc_identity_number.trim(),
        kyc_tax_number: form.kyc_tax_number.trim(),
        kyc_iban: form.kyc_iban.trim(),
      }),
    onSuccess: async () => {
      toast.success("İşletme kaydedildi.");
      await invalidateOpsQueries(queryClient, [["ops", "business", businessId], ["ops", "businesses"]]);
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "İşletme kaydedilemedi.")),
  });

  const saveMenuMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null) throw new Error("İşletme bilgisi okunamadı.");
      const payload = buildMenuPayload(menuForm);
      const savedItem = menuForm.editingId
        ? await updateBusinessMenuItem(businessId, menuForm.editingId, payload)
        : await createBusinessMenuItem(businessId, payload);

      if (menuForm.imageFile) {
        const previousItem = menuForm.editingId ? menuItems.find((item) => item.id === menuForm.editingId) : null;
        for (const asset of previousItem?.media_assets ?? []) {
          await deleteBusinessMediaAsset(businessId, asset.id);
        }
        await uploadBusinessMediaAsset(
          businessId,
          createMenuImageUploadPayload({
            file: menuForm.imageFile,
            menuItemId: savedItem.id,
            altText: savedItem.name || menuForm.name.trim(),
          }),
        );
      }

      return savedItem;
    },
    onSuccess: async () => {
      toast.success(menuForm.editingId ? "Menü güncellendi." : "Menü eklendi.");
      setMenuForm({ ...DEFAULT_MENU_FORM, categoryId: menuForm.categoryId });
      await queryClient.invalidateQueries({ queryKey: ["ops", "business-inline", businessId, "menu-items"] });
      await queryClient.invalidateQueries({ queryKey: ["ops", "business-catalog", businessId, "media"] });
      await queryClient.invalidateQueries({ queryKey: ["ops", "business-catalog", businessId, "menu-items"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Menü kaydedilemedi.")),
  });

  const deleteMenuMutation = useMutation({
    mutationFn: (menuItemId: number) => {
      if (businessId === null) throw new Error("İşletme bilgisi okunamadı.");
      return deleteBusinessMenuItem(businessId, menuItemId);
    },
    onSuccess: async () => {
      toast.success("Menü silindi.");
      setMenuForm((current) => (current.editingId ? { ...DEFAULT_MENU_FORM, categoryId: current.categoryId } : current));
      await queryClient.invalidateQueries({ queryKey: ["ops", "business-inline", businessId, "menu-items"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Menü silinemedi.")),
  });

  const saveMembershipMutation = useMutation({
    mutationFn: () => {
      if (businessId === null) throw new Error("İşletme bilgisi okunamadı.");
      const identifier = membershipForm.userIdentifier.trim();
      if (!identifier) {
        throw new Error("Kullanıcı ID veya e-posta gir.");
      }
      if (identifier.includes("@")) {
        return upsertOpsBusinessMembership(businessId, {
          email: identifier,
          role: membershipForm.role,
          is_active: true,
          access_halkyemek: membershipForm.access_halkyemek,
          access_halktasarruf: membershipForm.access_halktasarruf,
        });
      }
      const userId = Number(identifier);
      if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error("Geçerli bir kullanıcı ID veya e-posta gir.");
      }
      return upsertOpsBusinessMembership(businessId, {
        user_id: userId,
        role: membershipForm.role,
        is_active: true,
        access_halkyemek: membershipForm.access_halkyemek,
        access_halktasarruf: membershipForm.access_halktasarruf,
      });
    },
    onSuccess: async () => {
      toast.success("Yetkili kaydedildi.");
      setMembershipForm(DEFAULT_MEMBERSHIP_FORM);
      await invalidateOpsQueries(queryClient, [["ops", "business-memberships", businessId], ["ops", "business", businessId], ["ops", "businesses"]]);
      await membershipsQuery.refetch();
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Yetkili kaydedilemedi.")),
  });

  const deactivateMembershipMutation = useMutation({
    mutationFn: (userId: number) => {
      if (businessId === null) throw new Error("İşletme bilgisi okunamadı.");
      return deactivateOpsBusinessMembership(businessId, userId);
    },
    onSuccess: async () => {
      toast.success("Yetki pasifleştirildi.");
      await invalidateOpsQueries(queryClient, [["ops", "business-memberships", businessId], ["ops", "business", businessId], ["ops", "businesses"]]);
      await membershipsQuery.refetch();
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Yetki pasifleştirilemedi.")),
  });

  const triggerPaymentMutation = useMutation({
    mutationFn: () => {
      if (businessId === null) throw new Error("İşletme bilgisi okunamadı.");
      return triggerOpsSubmerchant(businessId);
    },
    onSuccess: async () => {
      toast.success("Ödeme kontrolü başlatıldı.");
      await invalidateOpsQueries(queryClient, [["ops", "business", businessId], ["ops", "businesses"]]);
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Ödeme hesabı kontrolü tamamlanamadı.")),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!hasChanges || formIssues.length > 0 || saveMutation.isPending || businessId === null) return;
    saveMutation.mutate();
  }

  function handleSaveMenu() {
    if (saveMenuMutation.isPending) return;
    saveMenuMutation.mutate();
  }

  function handleEditMenu(item: BusinessMenuItem) {
    revokeBlobUrl(menuForm.imagePreviewUrl);
    setMenuForm(toMenuForm(item));
  }

  function handleResetMenu() {
    revokeBlobUrl(menuForm.imagePreviewUrl);
    setMenuForm({ ...DEFAULT_MENU_FORM, categoryId: menuForm.categoryId || (menuCategoryOptions[0] ? String(menuCategoryOptions[0].id) : "") });
  }

  function handleMenuImageFile(file: File | null) {
    if (!file) return;
    try {
      validateMenuImageFile(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Menü fotoğrafı yüklenemedi.");
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setMenuForm((current) => {
      revokeBlobUrl(current.imagePreviewUrl);
      return {
        ...current,
        imageFile: file,
        imagePreviewUrl: previewUrl,
      };
    });
  }

  function handleClearMenuImageSelection() {
    setMenuForm((current) => {
      if (!current.imageFile) return current;
      revokeBlobUrl(current.imagePreviewUrl);
      const existingItem = current.editingId ? menuItems.find((item) => item.id === current.editingId) : null;
      return {
        ...current,
        imageFile: null,
        imagePreviewUrl: getMenuImageUrl(existingItem),
      };
    });
  }

  function handleSaveMembership() {
    if (saveMembershipMutation.isPending) return;
    saveMembershipMutation.mutate();
  }

  return (
    <ProtectedPageShell requireAdmin>
      <main className="bg-white py-6 sm:py-8">
        <Container size="wide" className="space-y-6">
          {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme numarası okunamadı." /> : null}
          {detailQuery.isPending ? <LoadingSkeleton /> : null}
          {detailQuery.isError ? <ErrorState title="İşletme detayı yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}

          {detailQuery.data ? (
            <form onSubmit={handleSubmit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="space-y-5">
                <section className="rounded-[34px] bg-zinc-950 p-5 text-white shadow-[0_24px_70px_rgba(15,23,42,0.16)] sm:p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">İşletme düzenle</p>
                      <h1 className="mt-3 text-3xl font-semibold tracking-[-0.055em] sm:text-4xl">{detailQuery.data.business_name}</h1>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-white/10 px-3 py-1.5 text-white/75">#{detailQuery.data.id}</span>
                        <span className="rounded-full bg-white/10 px-3 py-1.5 text-white/75">{detailQuery.data.category || "Kategori yok"}</span>
                        <span className="rounded-full bg-white/10 px-3 py-1.5 text-white/75">{detailQuery.data.address_line || detailQuery.data.district || "Konum eklenmedi"}</span>
                      </div>
                    </div>
                  </div>
                  {detailQuery.data.supports_halktasarruf ? (
                    <div className="mt-5">
                      <Link
                        href={`/ops/isletmeler/${detailQuery.data.id}/surpriz-paketler`}
                        className="inline-flex items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#5B21B6,#7C3AED)] px-4 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(109,40,217,0.24)] transition hover:-translate-y-0.5 hover:brightness-110"
                      >
                        HalkTasarruf paketlerini yönet
                      </Link>
                    </div>
                  ) : null}
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
                  <SectionTitle icon={Store} eyebrow="Temel bilgiler" title="İşletme ve görünürlük" />
                  <div className="mt-6 grid gap-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">İşletme adı</span>
                        <input value={form.business_name} onChange={(event) => setForm((current) => ({ ...current, business_name: event.target.value }))} className={fieldClassName()} />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">Kategori</span>
                        <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className={fieldClassName()}>
                          {CATEGORY_OPTIONS.map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">İşletme tipi</span>
                        <select value={form.listing_type} onChange={(event) => setForm((current) => ({ ...current, listing_type: event.target.value }))} className={fieldClassName()}>
                          {LISTING_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">Sıralama önceliği</span>
                        <input
                          type="number"
                          min={0}
                          value={form.display_priority}
                          onChange={(event) => setForm((current) => ({ ...current, display_priority: Number(event.target.value || 0) }))}
                          className={fieldClassName()}
                        />
                      </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      {PRODUCT_TOGGLES.map((item) => (
                        <label key={item.key} className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800">
                          <span>{item.label}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(form[item.key])}
                            onChange={(event) => setForm((current) => ({ ...current, [item.key]: event.target.checked }))}
                            className="h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                          />
                        </label>
                      ))}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {STATUS_TOGGLES.map((item) => (
                        <label key={item.key} className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800">
                          <span>{item.label}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(form[item.key])}
                            onChange={(event) => setForm((current) => ({ ...current, [item.key]: event.target.checked }))}
                            className="h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
                  <SectionTitle icon={MapPin} eyebrow="Konum" title="Adres ve harita bilgisi" />
                  <div className="mt-6 grid gap-4">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-zinc-800">Adres</span>
                      <input value={form.address_line} onChange={(event) => setForm((current) => ({ ...current, address_line: event.target.value, adress: event.target.value }))} placeholder="Beylikdüzü, İstanbul" className={fieldClassName()} />
                    </label>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-zinc-800">Google Maps URL</span>
                      <input value={form.google_maps_url} onChange={(event) => setForm((current) => ({ ...current, google_maps_url: event.target.value }))} placeholder="https://maps.google.com/..." className={fieldClassName()} />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">Enlem</span>
                        <input value={form.latitude} onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))} inputMode="decimal" className={fieldClassName()} />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">Boylam</span>
                        <input value={form.longitude} onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))} inputMode="decimal" className={fieldClassName()} />
                      </label>
                    </div>
                  </div>
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
                  <SectionTitle icon={Banknote} eyebrow="Finans" title="IBAN ve kimlik bilgileri" />
                  <div className="mt-6 grid gap-4">
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-zinc-800">IBAN numarası</span>
                      <input value={form.kyc_iban} onChange={(event) => setForm((current) => ({ ...current, kyc_iban: event.target.value }))} placeholder="TR00 0000 0000 0000 0000 0000 00" className={fieldClassName()} />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">IBAN hesap sahibi adı</span>
                        <input value={form.kyc_contact_name} onChange={(event) => setForm((current) => ({ ...current, kyc_contact_name: event.target.value }))} className={fieldClassName()} />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">IBAN hesap sahibi soyadı</span>
                        <input value={form.kyc_contact_surname} onChange={(event) => setForm((current) => ({ ...current, kyc_contact_surname: event.target.value }))} className={fieldClassName()} />
                      </label>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">T.C. kimlik no</span>
                        <input value={form.kyc_identity_number} onChange={(event) => setForm((current) => ({ ...current, kyc_identity_number: event.target.value }))} inputMode="numeric" className={fieldClassName()} />
                      </label>
                      <label className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">Vergi no</span>
                        <input value={form.kyc_tax_number} onChange={(event) => setForm((current) => ({ ...current, kyc_tax_number: event.target.value }))} inputMode="numeric" className={fieldClassName()} />
                      </label>
                    </div>
                    <label className="space-y-2">
                      <span className="text-sm font-semibold text-zinc-800">Operasyon notu</span>
                      <textarea
                        value={form.payout_onboarding_note}
                        onChange={(event) => setForm((current) => ({ ...current, payout_onboarding_note: event.target.value }))}
                        className={`${fieldClassName()} min-h-24 resize-none`}
                      />
                    </label>
                  </div>
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
                  <SectionTitle icon={UtensilsCrossed} eyebrow="Menüler" title="Menüler ve içerik" />
                  <div className="mt-6 grid gap-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr_120px_120px_220px]">
                      <input
                        value={menuForm.name}
                        onChange={(event) => setMenuForm((current) => ({ ...current, name: event.target.value }))}
                        placeholder="Menü adı"
                        className={fieldClassName()}
                      />
                      <input
                        value={menuForm.price}
                        onChange={(event) => setMenuForm((current) => ({ ...current, price: event.target.value }))}
                        placeholder="Fiyat"
                        inputMode="decimal"
                        className={fieldClassName()}
                      />
                      <input
                        value={menuForm.minimum_grams}
                        onChange={(event) => setMenuForm((current) => ({ ...current, minimum_grams: event.target.value }))}
                        placeholder="Min. gr"
                        inputMode="numeric"
                        className={fieldClassName()}
                      />
                      <select
                        value={menuForm.categoryId}
                        onChange={(event) => setMenuForm((current) => ({ ...current, categoryId: event.target.value }))}
                        className={fieldClassName()}
                      >
                        <option value="">Kategori seç</option>
                        {menuCategoryOptions.map((category: BusinessCategoryItem) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <textarea
                      value={menuForm.description}
                      onChange={(event) => setMenuForm((current) => ({ ...current, description: event.target.value }))}
                      placeholder="Kısa açıklama"
                      className={`${fieldClassName()} min-h-20 resize-none`}
                    />
                    <div className="rounded-[24px] border border-zinc-100 bg-zinc-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-zinc-900">Menü kotası</p>
                          <p className="mt-1 text-sm leading-6 text-zinc-500">
                            Sadece satışa açılacak adet girilir. Sipariş ödemesi tamamlandıkça kalan kota otomatik düşer.
                          </p>
                        </div>
                        <label className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-semibold text-zinc-800 ring-1 ring-zinc-200">
                          <input
                            type="checkbox"
                            checked={menuForm.quota_enabled}
                            onChange={(event) => setMenuForm((current) => ({ ...current, quota_enabled: event.target.checked }))}
                            className="h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                          />
                          Kota aktif
                        </label>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,280px)_1fr] md:items-end">
                        <label className="space-y-2">
                          <span className="text-sm font-semibold text-zinc-800">Kota adedi</span>
                          <input
                            value={menuForm.quota_total}
                            onChange={(event) => setMenuForm((current) => ({ ...current, quota_total: event.target.value }))}
                            disabled={!menuForm.quota_enabled}
                            inputMode="numeric"
                            placeholder="Örn. 100"
                            className={`${fieldClassName()} disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400`}
                          />
                        </label>
                        <p className="rounded-2xl bg-white px-4 py-3 text-xs font-medium leading-5 text-zinc-500 ring-1 ring-zinc-100">
                          Bu değer kaydedildiğinde mevcut kalan kota bu adede ayarlanır. Kalan 0 olursa ürün müşteri tarafında Tükendi görünür.
                        </p>
                      </div>
                      {!menuForm.quota_enabled ? (
                        <p className="mt-3 rounded-2xl bg-white px-3 py-2 text-xs font-medium leading-5 text-zinc-500 ring-1 ring-zinc-100">
                          Kota kapalıyken ürün sınırsız kabul edilir.
                        </p>
                      ) : null}
                    </div>
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_132px] lg:items-stretch">
                      <div className="space-y-2">
                        <span className="text-sm font-semibold text-zinc-800">Menü fotoğrafı</span>
                        <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-zinc-200 bg-zinc-50 px-4 py-4 text-center text-sm font-semibold text-zinc-700 transition hover:border-[#f50555]/45 hover:bg-rose-50">
                          <UploadCloud className="h-5 w-5 text-[#f50555]" />
                          <span>{menuForm.imageFile ? menuForm.imageFile.name : "Fotoğraf dosyası seç"}</span>
                          <span className="text-xs font-medium text-zinc-500">JPG, PNG, WEBP veya GIF - en fazla 8 MB</span>
                          <input
                            type="file"
                            accept={MENU_IMAGE_ACCEPT}
                            className="hidden"
                            onChange={(event) => {
                              handleMenuImageFile(event.currentTarget.files?.[0] ?? null);
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        {menuForm.imageFile ? (
                          <button
                            type="button"
                            onClick={handleClearMenuImageSelection}
                            className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-zinc-700 ring-1 ring-zinc-200 transition hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Seçimi kaldır
                          </button>
                        ) : null}
                      </div>
                      <div
                        className="flex min-h-24 items-center justify-center rounded-[24px] border border-zinc-100 bg-zinc-50 bg-cover bg-center text-sm font-semibold text-zinc-400"
                        style={imageBackgroundStyle(menuForm.imagePreviewUrl)}
                      >
                        {!menuForm.imagePreviewUrl ? <ImagePlus className="h-5 w-5" /> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: "is_active", label: "Aktif" },
                        { key: "is_visible", label: "Görünür" },
                        { key: "is_available", label: "Satışta" },
                      ].map((item) => (
                        <label key={item.key} className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
                          <input
                            type="checkbox"
                            checked={Boolean(menuForm[item.key as keyof Pick<MenuInlineFormState, "is_active" | "is_visible" | "is_available">])}
                            onChange={(event) => setMenuForm((current) => ({ ...current, [item.key]: event.target.checked }))}
                          />
                          {item.label}
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={saveMenuMutation.isPending || !menuForm.name.trim() || !menuForm.price.trim() || !menuForm.categoryId}
                        onClick={handleSaveMenu}
                        className="inline-flex items-center justify-center rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_36px_rgba(245,5,85,0.20)] transition hover:-translate-y-0.5 hover:bg-[#dc004c] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none"
                      >
                        {saveMenuMutation.isPending ? "Kaydediliyor..." : menuForm.editingId ? "Menüyü güncelle" : "Menü ekle"}
                      </button>
                      {menuForm.editingId ? (
                        <button
                          type="button"
                          onClick={handleResetMenu}
                          className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
                        >
                          Vazgeç
                        </button>
                      ) : null}
                    </div>

                    <div className="grid gap-3">
                      {menuItemsQuery.isPending ? <LoadingSkeleton className="h-24" /> : null}
                      {menuItems.slice(0, 8).map((item: BusinessMenuItem) => {
                        const menuImageUrl = getMenuImageUrl(item);
                        return (
                          <div key={item.id} className="rounded-[24px] border border-zinc-100 bg-zinc-50 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex min-w-0 gap-3">
                                <div
                                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white bg-white bg-cover bg-center text-xs font-bold text-[#f50555] shadow-sm"
                                  style={imageBackgroundStyle(menuImageUrl)}
                                >
                                  {!menuImageUrl ? "HY" : null}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-zinc-950">{item.name}</p>
                                  <p className="mt-1 text-sm text-zinc-500">{item.description || item.category_name || "Açıklama yok"}</p>
                                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                                    <span className="rounded-full bg-white px-3 py-1 text-zinc-700">{formatAmount(item.price_amount)}</span>
                                    {item.minimum_grams ? <span className="rounded-full bg-white px-3 py-1 text-zinc-700">Min. {item.minimum_grams} gr</span> : null}
                                    <span
                                      className={`rounded-full px-3 py-1 ${
                                        item.quota_enabled && item.quota_remaining === 0
                                          ? "bg-zinc-950 text-white"
                                          : item.quota_enabled
                                            ? "bg-rose-50 text-[#f50555] ring-1 ring-rose-100"
                                            : "bg-white text-zinc-700"
                                      }`}
                                    >
                                      {formatMenuQuotaBadge(item)}
                                    </span>
                                    <span className="rounded-full bg-white px-3 py-1 text-zinc-700">{item.is_available ? "Satışta" : "Kapalı"}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => handleEditMenu(item)} className="rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-rose-50 hover:text-[#f50555]">
                                  Düzenle
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteMenuMutation.mutate(item.id)}
                                  disabled={deleteMenuMutation.isPending}
                                  className="inline-flex items-center justify-center rounded-2xl bg-white px-3 py-2.5 text-zinc-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                  aria-label="Menüyü sil"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {!menuItemsQuery.isPending && !menuItems.length ? (
                        <EmptyState title="Menü yok" description="İlk menüyü yukarıdaki kısa formdan ekleyebilirsin." />
                      ) : null}
                    </div>
                  </div>
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
                  <SectionTitle icon={UsersRound} eyebrow="Yetkililer" title="Yetkili kullanıcılar" />
                  <div className="mt-6 grid gap-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto] lg:items-center">
                      <input
                        value={membershipForm.userIdentifier}
                        onChange={(event) => setMembershipForm((current) => ({ ...current, userIdentifier: event.target.value }))}
                        placeholder="Kullanıcı ID veya e-posta"
                        className={fieldClassName()}
                      />
                      <select value={membershipForm.role} onChange={(event) => setMembershipForm((current) => ({ ...current, role: event.target.value }))} className={fieldClassName()}>
                        {ROLE_OPTIONS.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={handleSaveMembership}
                        disabled={saveMembershipMutation.isPending || !membershipForm.userIdentifier.trim()}
                        className="inline-flex w-full items-center justify-center rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#dc004c] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 lg:w-auto"
                      >
                        {saveMembershipMutation.isPending ? "Kaydediliyor..." : "Yetkili kaydet"}
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800">
                        <span>HalkYemek erişimi</span>
                        <input
                          type="checkbox"
                          checked={membershipForm.access_halkyemek}
                          onChange={(event) => setMembershipForm((current) => ({ ...current, access_halkyemek: event.target.checked }))}
                          className="h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                        />
                      </label>
                      <label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800">
                        <span>HalkTasarruf erişimi</span>
                        <input
                          type="checkbox"
                          checked={membershipForm.access_halktasarruf}
                          onChange={(event) => setMembershipForm((current) => ({ ...current, access_halktasarruf: event.target.checked }))}
                          className="h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                        />
                      </label>
                    </div>
                    <div className="grid gap-3">
                      {membershipsQuery.isPending ? <LoadingSkeleton className="h-20" /> : null}
                      {memberships.map((membership: OpsBusinessMembership) => (
                        <div key={membership.id} className="flex flex-col gap-3 rounded-[24px] border border-zinc-100 bg-zinc-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-semibold text-zinc-950">{membership.username || `Kullanıcı #${membership.user_id}`}</p>
                            <p className="mt-1 text-sm text-zinc-500">{membership.email || "E-posta yok"} · {formatRoleLabel(membership.role)}</p>
                            <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                              {membership.access_halkyemek ? <span className="rounded-full bg-rose-50 px-3 py-1 text-[#f50555]">HalkYemek</span> : null}
                              {membership.access_halktasarruf ? <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">HalkTasarruf</span> : null}
                              {!membership.access_halkyemek && !membership.access_halktasarruf ? <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-500">Ürün erişimi kapalı</span> : null}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={!membership.is_active || deactivateMembershipMutation.isPending}
                            onClick={() => deactivateMembershipMutation.mutate(membership.user_id)}
                            className="inline-flex w-full items-center justify-center rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-45 sm:w-auto"
                          >
                            Pasifleştir
                          </button>
                        </div>
                      ))}
                      {!membershipsQuery.isPending && !memberships.length ? <EmptyState title="Yetkili yok" description="Kullanıcı ID veya e-posta girerek işletmeye yetkili tanımla." /> : null}
                    </div>
                  </div>
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
                  <SectionTitle icon={Banknote} eyebrow="Ödeme" title="Ödeme hesabı" />
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <p className="text-sm font-semibold text-zinc-500">Durum</p>
                      <p className="mt-2 text-lg font-semibold text-zinc-950">{detailQuery.data.payout_onboarding_status || "Durum yok"}</p>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <p className="text-sm font-semibold text-zinc-500">Eksik bilgi</p>
                      <p className="mt-2 text-lg font-semibold text-zinc-950">{missingPaymentFields.length ? `${missingPaymentFields.length} alan` : "Yok"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => triggerPaymentMutation.mutate()}
                      disabled={triggerPaymentMutation.isPending}
                      className="inline-flex w-full items-center justify-center rounded-2xl bg-zinc-950 px-5 py-4 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-[#f50555] disabled:bg-zinc-200 disabled:text-zinc-500 md:w-auto"
                    >
                      {triggerPaymentMutation.isPending ? "Kontrol ediliyor..." : "İyzico ile kontrol et"}
                    </button>
                  </div>
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
                  <SectionTitle icon={ReceiptText} eyebrow="Mutabakat" title="Finans kontrolü" />
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <p className="text-sm font-semibold text-zinc-500">Genel durum</p>
                      <p className="mt-2 text-lg font-semibold text-zinc-950">{reconcileIssueCount ? "İnceleme gerekiyor" : "Temiz"}</p>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <p className="text-sm font-semibold text-zinc-500">Açık sorun</p>
                      <p className="mt-2 text-lg font-semibold text-zinc-950">{reconcileQuery.isPending ? "Yükleniyor" : reconcileIssueCount}</p>
                    </div>
                    <div className="rounded-2xl bg-zinc-50 p-4">
                      <p className="text-sm font-semibold text-zinc-500">Toplam kayıt</p>
                      <p className="mt-2 text-lg font-semibold text-zinc-950">{getSummaryValue(reconcileQuery.data, "total")}</p>
                    </div>
                  </div>
                </section>
              </div>

              <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
                <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)]">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f50555]">Kayıt kontrolü</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.045em] text-zinc-950">Değişiklikleri kaydet</h2>
                  <div className="mt-5 space-y-2">
                    {formIssues.length ? (
                      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                        {formIssues.map((issue) => (
                          <p key={issue}>{issue}</p>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        Bilgiler kayda hazır
                      </div>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={!hasChanges || formIssues.length > 0 || saveMutation.isPending}
                    className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_18px_42px_rgba(245,5,85,0.25)] transition hover:-translate-y-0.5 hover:bg-[#dc004c] disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500 disabled:shadow-none"
                  >
                    <Save className="h-4 w-4" />
                    {saveMutation.isPending ? "Kaydediliyor..." : "Kaydet"}
                  </button>
                  <button
                    type="button"
                    disabled={!hasChanges || saveMutation.isPending}
                    onClick={() => setForm(baseline)}
                    className="mt-2 inline-flex w-full items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  >
                    Vazgeç
                  </button>
                </section>

                <section className="rounded-[34px] border border-zinc-100 bg-zinc-50 p-5">
                  <SectionTitle icon={BadgeCheck} eyebrow="Yetkili özet" title="Ekip" />
                  <div className="mt-4 space-y-2">
                    {memberships.length ? (
                      memberships.slice(0, 4).map((membership) => (
                        <div key={membership.id} className="rounded-2xl bg-white px-3 py-2.5 text-sm">
                          <p className="font-semibold text-zinc-950">{membership.username || `Kullanıcı #${membership.user_id}`}</p>
                          <p className="mt-1 text-xs text-zinc-500">{membership.role}</p>
                        </div>
                      ))
                    ) : (
                      <EmptyState title="Yetkili yok" description="Bu işletmeye henüz aktif yetkili bağlanmamış." />
                    )}
                  </div>
                </section>
              </aside>
            </form>
          ) : null}
        </Container>
      </main>
    </ProtectedPageShell>
  );
}
