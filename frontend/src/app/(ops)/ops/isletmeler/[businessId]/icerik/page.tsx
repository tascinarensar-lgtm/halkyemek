"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  OpsActionResult,
  OpsKeyValueGrid,
  OpsLinkRow,
  OpsPageShell,
  OpsSectionCard,
  OpsStatus,
} from "@/components/ops-console/shared";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import {
  createBusinessCategory,
  createBusinessMenuItem,
  createBusinessOffer,
  deleteBusinessCategory,
  deleteBusinessMenuItem,
  deleteBusinessOffer,
  getBusinessProfileOperations,
  listBusinessCategories,
  listBusinessMediaAssets,
  listBusinessMenuItems,
  listBusinessOffers,
  updateBusinessCategory,
  updateBusinessMenuItem,
  updateBusinessOffer,
  updateBusinessProfileOperations,
} from "@/features/business-operations/api";
import type {
  BusinessCategoryItem,
  BusinessMediaAsset,
  BusinessMenuItem,
  BusinessOffer,
  BusinessProfileOperations,
} from "@/features/business-operations/types";
import { normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

type MenuFormState = {
  name: string;
  description: string;
  price: string;
  minimum_grams: string;
  quota_enabled: boolean;
  quota_total: string;
  marketplace_category_ids: number[];
  is_active: boolean;
  is_visible: boolean;
  is_available: boolean;
};

type CategoryFormState = {
  marketplace_category: string;
  is_active: boolean;
  is_primary: boolean;
};

type OfferFormState = {
  title: string;
  description: string;
  price: string;
  starts_at: string;
  ends_at: string;
  daily_limit: string;
  is_active: boolean;
  is_featured: boolean;
  sort_order: string;
};

type ProfileFormState = {
  short_description: string;
  intro_text: string;
  badge_text: string;
  marketplace_is_visible: boolean;
  listing_type: string;
  is_featured: boolean;
  display_priority: string;
};

const INITIAL_MENU_FORM: MenuFormState = {
  name: "",
  description: "",
  price: "",
  minimum_grams: "",
  quota_enabled: false,
  quota_total: "",
  marketplace_category_ids: [],
  is_active: true,
  is_visible: true,
  is_available: true,
};

const INITIAL_CATEGORY_FORM: CategoryFormState = {
  marketplace_category: "",
  is_active: true,
  is_primary: false,
};

const INITIAL_OFFER_FORM: OfferFormState = {
  title: "",
  description: "",
  price: "",
  starts_at: "",
  ends_at: "",
  daily_limit: "",
  is_active: true,
  is_featured: false,
  sort_order: "",
};

const INITIAL_PROFILE_FORM: ProfileFormState = {
  short_description: "",
  intro_text: "",
  badge_text: "",
  marketplace_is_visible: true,
  listing_type: "",
  is_featured: false,
  display_priority: "",
};

function formatAmount(amount: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function summarizeMediaRole(items: BusinessMediaAsset[], assetRole: string) {
  return items.filter((item) => item.asset_role === assetRole).length;
}

function pickPrimaryCategory(categories: BusinessCategoryItem[]) {
  return categories.find((category) => category.is_primary) || null;
}

function SectionLoading() {
  return <LoadingSkeleton className="h-40" />;
}

function SectionError({ title, error }: { title: string; error: unknown }) {
  return <ErrorState title={title} description={getApiErrorMessage(error)} />;
}

function EmptySummary({ text }: { text: string }) {
  return (
    <div className="rounded-[var(--hy-radius-md)] border border-dashed border-[var(--hy-color-neutral-300)] bg-[var(--hy-color-neutral-50)] p-4 text-sm leading-6 text-[var(--hy-color-neutral-600)]">
      {text}
    </div>
  );
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

function toMenuFormState(item: BusinessMenuItem): MenuFormState {
  return {
    name: item.name,
    description: item.description || "",
    price: String(item.price_amount / 100),
    minimum_grams: item.minimum_grams === null ? "" : String(item.minimum_grams),
    quota_enabled: item.quota_enabled,
    quota_total: item.quota_remaining === null ? (item.quota_total === null ? "" : String(item.quota_total)) : String(item.quota_remaining),
    marketplace_category_ids: item.marketplace_categories.map((category) => category.id),
    is_active: item.is_active,
    is_visible: item.is_visible,
    is_available: item.is_available,
  };
}

function parsePriceToAmount(value: string) {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Ürün fiyatını geçerli bir tutar olarak girin.");
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
  return `${item.quota_remaining} kaldı`;
}

function buildMenuPayload(form: MenuFormState) {
  if (!form.name.trim()) {
    throw new Error("Ürün adı boş bırakılamaz.");
  }
  if (!form.marketplace_category_ids.length) {
    throw new Error("En az bir sistem kategorisi seçin.");
  }

  let quotaTotal: number | null = null;
  let quotaRemaining: number | null = null;
  let lowStockThreshold = 12;
  const minimumGrams = form.minimum_grams.trim() ? parseOptionalNonNegativeInteger(form.minimum_grams, "Minimum gram bilgisi") : null;

  if (form.quota_enabled) {
    quotaTotal = parseOptionalNonNegativeInteger(form.quota_total, "Kota adedi");

    if (quotaTotal === null) {
      throw new Error("Kota aktifken kota adedini doldurun.");
    }
    quotaRemaining = quotaTotal;
  }

  return {
    name: form.name.trim(),
    slug: slugify(form.name),
    description: form.description.trim(),
    minimum_grams: minimumGrams === 0 ? null : minimumGrams,
    price_amount: parsePriceToAmount(form.price),
    quota_enabled: form.quota_enabled,
    quota_total: quotaTotal,
    quota_remaining: quotaRemaining,
    low_stock_threshold: lowStockThreshold,
    marketplace_category_ids: form.marketplace_category_ids,
    is_active: form.is_active,
    is_visible: form.is_visible,
    is_available: form.is_available,
  };
}

function buildCategoryPayload(form: CategoryFormState, { includeMarketplaceCategory }: { includeMarketplaceCategory: boolean }) {
  const payload: {
    marketplace_category?: number;
    is_active: boolean;
    is_primary: boolean;
  } = {
    is_active: form.is_active,
    is_primary: form.is_primary,
  };

  if (includeMarketplaceCategory) {
    const categoryId = Number(form.marketplace_category);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      throw new Error("Geçerli bir pazar yeri kategorisi seçin.");
    }
    payload.marketplace_category = categoryId;
  }

  return payload;
}

function toDateTimeLocalValue(value: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function toOfferFormState(offer: BusinessOffer): OfferFormState {
  return {
    title: offer.title,
    description: offer.short_description || offer.description || "",
    price: String(offer.offer_price_amount / 100),
    starts_at: toDateTimeLocalValue(offer.starts_at),
    ends_at: toDateTimeLocalValue(offer.ends_at),
    daily_limit: offer.daily_limit === null ? "" : String(offer.daily_limit),
    is_active: offer.is_active,
    is_featured: offer.is_featured,
    sort_order: String(offer.sort_order),
  };
}

function toIsoDateTimeOrThrow(value: string, fieldLabel: string) {
  if (!value.trim()) {
    throw new Error(`${fieldLabel} alanını doldurun.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldLabel} için geçerli bir tarih girin.`);
  }
  return date.toISOString();
}

function buildOfferPayload(form: OfferFormState) {
  if (!form.title.trim()) {
    throw new Error("Teklif başlığı boş bırakılamaz.");
  }

  const startsAt = toIsoDateTimeOrThrow(form.starts_at, "Başlangıç tarihi");
  const endsAt = toIsoDateTimeOrThrow(form.ends_at, "Bitiş tarihi");

  if (new Date(startsAt).getTime() >= new Date(endsAt).getTime()) {
    throw new Error("Bitiş tarihi başlangıç tarihinden sonra olmalıdır.");
  }

  const payload: {
    title: string;
    short_description?: string;
    description?: string;
    offer_price_amount: number;
    starts_at: string;
    ends_at: string;
    daily_limit?: number | null;
    is_active: boolean;
    is_featured: boolean;
    sort_order?: number;
  } = {
    title: form.title.trim(),
    offer_price_amount: parsePriceToAmount(form.price),
    starts_at: startsAt,
    ends_at: endsAt,
    is_active: form.is_active,
    is_featured: form.is_featured,
  };

  const description = form.description.trim();
  if (description) {
    payload.short_description = description;
    payload.description = description;
  }

  if (form.daily_limit.trim()) {
    const limit = Number(form.daily_limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Günlük limit tam sayı ve pozitif olmalıdır.");
    }
    payload.daily_limit = limit;
  } else {
    payload.daily_limit = null;
  }

  if (form.sort_order.trim()) {
    const sortOrder = Number(form.sort_order);
    if (!Number.isInteger(sortOrder) || sortOrder < 0) {
      throw new Error("Sıralama değeri sıfır veya daha büyük bir tam sayı olmalıdır.");
    }
    payload.sort_order = sortOrder;
  }

  return payload;
}

function toProfileFormState(profile: BusinessProfileOperations): ProfileFormState {
  return {
    short_description: profile.short_description || "",
    intro_text: profile.intro_text || "",
    badge_text: profile.badge_text || "",
    marketplace_is_visible: profile.marketplace_is_visible,
    listing_type: profile.listing_type || "",
    is_featured: profile.is_featured,
    display_priority: String(profile.display_priority ?? 0),
  };
}

function buildProfilePayload(form: ProfileFormState) {
  const payload: {
    short_description: string;
    intro_text: string;
    badge_text: string;
    marketplace_is_visible: boolean;
    listing_type?: string;
    is_featured?: boolean;
    display_priority?: number;
  } = {
    short_description: form.short_description.trim(),
    intro_text: form.intro_text.trim(),
    badge_text: form.badge_text.trim(),
    marketplace_is_visible: form.marketplace_is_visible,
  };

  const listingType = form.listing_type.trim();
  if (listingType) {
    payload.listing_type = listingType;
  }

  payload.is_featured = form.is_featured;

  const priorityText = form.display_priority.trim();
  if (priorityText) {
    const priority = Number(priorityText);
    if (!Number.isInteger(priority) || priority < 0) {
      throw new Error("Sıralama önceliği sıfır veya daha büyük bir tam sayı olmalıdır.");
    }
    payload.display_priority = priority;
  } else {
    payload.display_priority = 0;
  }

  return payload;
}

function CategoryCheckboxList({
  categories,
  selectedIds,
  onToggle,
}: {
  categories: BusinessCategoryItem[];
  selectedIds: number[];
  onToggle: (categoryId: number) => void;
}) {
  const visibleCategories = categories.filter((category) => category.is_selected);

  if (!visibleCategories.length) {
    return <p className="text-sm text-[var(--hy-color-neutral-500)]">Seçilebilir sistem kategorisi bulunmuyor.</p>;
  }

  return (
    <div className="grid gap-2 md:grid-cols-2">
      {visibleCategories.map((category) => {
        const checked = selectedIds.includes(category.id);
        return (
          <label
            key={category.id}
            className="flex cursor-pointer items-start gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(category.id)}
              className="mt-1 h-4 w-4 rounded border-[var(--hy-color-neutral-300)] text-[var(--hy-color-primary-600)]"
            />
            <span className="min-w-0">
              <span className="block font-semibold text-[var(--hy-color-neutral-900)]">{category.name}</span>
              <span className="block text-[var(--hy-color-neutral-500)]">{category.description || "Açıklama eklenmemiş."}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default function OpsBusinessCatalogPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryEnabled = businessId !== null;
  const queryClient = useQueryClient();

  const [menuMode, setMenuMode] = useState<"create" | "edit" | null>(null);
  const [editingMenuItemId, setEditingMenuItemId] = useState<number | null>(null);
  const [menuForm, setMenuForm] = useState<MenuFormState>(INITIAL_MENU_FORM);
  const [menuFeedback, setMenuFeedback] = useState<{ tone: "success" | "danger"; title: string; description?: string } | null>(null);
  const [categoryMode, setCategoryMode] = useState<"create" | "edit" | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(INITIAL_CATEGORY_FORM);
  const [categoryFeedback, setCategoryFeedback] = useState<{ tone: "success" | "danger"; title: string; description?: string } | null>(null);
  const [offerMode, setOfferMode] = useState<"create" | "edit" | null>(null);
  const [editingOfferId, setEditingOfferId] = useState<number | null>(null);
  const [offerForm, setOfferForm] = useState<OfferFormState>(INITIAL_OFFER_FORM);
  const [offerFeedback, setOfferFeedback] = useState<{ tone: "success" | "danger"; title: string; description?: string } | null>(null);
  const [profileMode, setProfileMode] = useState<"edit" | null>(null);
  const [profileForm, setProfileForm] = useState<ProfileFormState>(INITIAL_PROFILE_FORM);
  const [profileFeedback, setProfileFeedback] = useState<{ tone: "success" | "danger"; title: string; description?: string } | null>(null);

  const menuItemsQuery = useQuery({
    queryKey: ["ops", "business-catalog", businessId, "menu-items"],
    queryFn: () => listBusinessMenuItems(businessId as number),
    enabled: queryEnabled,
  });
  const categoriesQuery = useQuery({
    queryKey: ["ops", "business-catalog", businessId, "categories"],
    queryFn: () => listBusinessCategories(businessId as number),
    enabled: queryEnabled,
  });
  const offersQuery = useQuery({
    queryKey: ["ops", "business-catalog", businessId, "offers"],
    queryFn: () => listBusinessOffers(businessId as number),
    enabled: queryEnabled,
  });
  const mediaQuery = useQuery({
    queryKey: ["ops", "business-catalog", businessId, "media"],
    queryFn: () => listBusinessMediaAssets(businessId as number),
    enabled: queryEnabled,
  });
  const profileQuery = useQuery({
    queryKey: ["ops", "business-catalog", businessId, "profile"],
    queryFn: () => getBusinessProfileOperations(businessId as number),
    enabled: queryEnabled,
  });

  const menuItemsData = menuItemsQuery.data;
  const menuItems = menuItemsData ?? [];
  const categories = categoriesQuery.data ?? [];
  const offersData = offersQuery.data;
  const offers = offersData ?? [];
  const mediaAssets = mediaQuery.data ?? [];
  const profile = profileQuery.data ?? null;
  const primaryCategory = pickPrimaryCategory(categories);
  const selectedCategories = categories.filter((category) => category.is_selected);
  const availableCategoryOptions = categories.filter((category) => !category.is_selected);
  const editingCategory = categories.find((category) => category.id === editingCategoryId) || null;
  const editingMenuItem = useMemo(
    () => menuItemsData?.find((item) => item.id === editingMenuItemId) || null,
    [editingMenuItemId, menuItemsData],
  );
  const editingOffer = useMemo(
    () => offersData?.find((item) => item.id === editingOfferId) || null,
    [editingOfferId, offersData],
  );

  const invalidateMenuItems = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ops", "business-catalog", businessId, "menu-items"],
    });
  };
  const invalidateCategories = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ops", "business-catalog", businessId, "categories"],
    });
  };
  const invalidateOffers = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ops", "business-catalog", businessId, "offers"],
    });
  };
  const invalidateProfile = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ops", "business-catalog", businessId, "profile"],
    });
  };

  const createMenuMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null) {
        throw new Error("İşletme bilgisi okunamadı.");
      }
      return createBusinessMenuItem(businessId, buildMenuPayload(menuForm));
    },
    onSuccess: async () => {
      await invalidateMenuItems();
      setMenuFeedback({
        tone: "success",
        title: "Ürün eklendi",
        description: "Bu işlem işletmenin müşteriye görünen menüsünü günceller.",
      });
      setMenuMode(null);
      setMenuForm(INITIAL_MENU_FORM);
    },
    onError: (error) => {
      setMenuFeedback({
        tone: "danger",
        title: "Ürün eklenemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const updateMenuMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null || editingMenuItemId === null) {
        throw new Error("Düzenlenecek ürün bulunamadı.");
      }
      return updateBusinessMenuItem(businessId, editingMenuItemId, buildMenuPayload(menuForm));
    },
    onSuccess: async () => {
      await invalidateMenuItems();
      setMenuFeedback({
        tone: "success",
        title: "Ürün güncellendi",
        description: "Bu işlem işletmenin müşteriye görünen menüsünü günceller.",
      });
      setMenuMode(null);
      setEditingMenuItemId(null);
      setMenuForm(INITIAL_MENU_FORM);
    },
    onError: (error) => {
      setMenuFeedback({
        tone: "danger",
        title: "Ürün güncellenemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const deleteMenuMutation = useMutation({
    mutationFn: async (menuItemId: number) => {
      if (businessId === null) {
        throw new Error("İşletme bilgisi okunamadı.");
      }
      return deleteBusinessMenuItem(businessId, menuItemId);
    },
    onSuccess: async () => {
      await invalidateMenuItems();
      setMenuFeedback({
        tone: "success",
        title: "Ürün menüden kaldırıldı",
        description: "Bu işlem işletmenin müşteriye görünen menüsünü günceller.",
      });
      if (menuMode === "edit") {
        setMenuMode(null);
        setEditingMenuItemId(null);
        setMenuForm(INITIAL_MENU_FORM);
      }
    },
    onError: (error) => {
      setMenuFeedback({
        tone: "danger",
        title: "Ürün silinemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null) {
        throw new Error("İşletme bilgisi okunamadı.");
      }
      return createBusinessCategory(
        businessId,
        buildCategoryPayload(categoryForm, { includeMarketplaceCategory: true }),
      );
    },
    onSuccess: async () => {
      await invalidateCategories();
      setCategoryFeedback({
        tone: "success",
        title: "Kategori eklendi",
        description: "Bu işlem işletmenin müşteriye görünen kategori eşleşmelerini günceller.",
      });
      setCategoryMode(null);
      setEditingCategoryId(null);
      setCategoryForm(INITIAL_CATEGORY_FORM);
    },
    onError: (error) => {
      setCategoryFeedback({
        tone: "danger",
        title: "Kategori eklenemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null || editingCategoryId === null) {
        throw new Error("Düzenlenecek kategori bulunamadı.");
      }
      return updateBusinessCategory(
        businessId,
        editingCategoryId,
        buildCategoryPayload(categoryForm, { includeMarketplaceCategory: false }),
      );
    },
    onSuccess: async () => {
      await invalidateCategories();
      setCategoryFeedback({
        tone: "success",
        title: "Kategori güncellendi",
        description: "Bu işlem işletmenin müşteriye görünen kategori eşleşmelerini günceller.",
      });
      setCategoryMode(null);
      setEditingCategoryId(null);
      setCategoryForm(INITIAL_CATEGORY_FORM);
    },
    onError: (error) => {
      setCategoryFeedback({
        tone: "danger",
        title: "Kategori güncellenemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (categoryId: number) => {
      if (businessId === null) {
        throw new Error("İşletme bilgisi okunamadı.");
      }
      return deleteBusinessCategory(businessId, categoryId);
    },
    onSuccess: async () => {
      await invalidateCategories();
      setCategoryFeedback({
        tone: "success",
        title: "Kategori kaldırıldı",
        description: "Bu işlem işletmenin müşteriye görünen kategori eşleşmelerini günceller.",
      });
      if (categoryMode === "edit") {
        setCategoryMode(null);
        setEditingCategoryId(null);
        setCategoryForm(INITIAL_CATEGORY_FORM);
      }
    },
    onError: (error) => {
      setCategoryFeedback({
        tone: "danger",
        title: "Kategori silinemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const createOfferMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null) {
        throw new Error("İşletme bilgisi okunamadı.");
      }
      return createBusinessOffer(businessId, buildOfferPayload(offerForm));
    },
    onSuccess: async () => {
      await invalidateOffers();
      setOfferFeedback({
        tone: "success",
        title: "Teklif eklendi",
        description: "Bu işlem işletmenin müşteriye görünen teklif ve kampanya bilgisini günceller.",
      });
      setOfferMode(null);
      setEditingOfferId(null);
      setOfferForm(INITIAL_OFFER_FORM);
    },
    onError: (error) => {
      setOfferFeedback({
        tone: "danger",
        title: "Teklif eklenemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const updateOfferMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null || editingOfferId === null) {
        throw new Error("Düzenlenecek teklif bulunamadı.");
      }
      return updateBusinessOffer(businessId, editingOfferId, buildOfferPayload(offerForm));
    },
    onSuccess: async () => {
      await invalidateOffers();
      setOfferFeedback({
        tone: "success",
        title: "Teklif güncellendi",
        description: "Bu işlem işletmenin müşteriye görünen teklif ve kampanya bilgisini günceller.",
      });
      setOfferMode(null);
      setEditingOfferId(null);
      setOfferForm(INITIAL_OFFER_FORM);
    },
    onError: (error) => {
      setOfferFeedback({
        tone: "danger",
        title: "Teklif güncellenemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const deleteOfferMutation = useMutation({
    mutationFn: async (offerId: number) => {
      if (businessId === null) {
        throw new Error("İşletme bilgisi okunamadı.");
      }
      return deleteBusinessOffer(businessId, offerId);
    },
    onSuccess: async () => {
      await invalidateOffers();
      setOfferFeedback({
        tone: "success",
        title: "Teklif kaldırıldı",
        description: "Bu işlem işletmenin müşteriye görünen teklif ve kampanya bilgisini günceller.",
      });
      if (offerMode === "edit") {
        setOfferMode(null);
        setEditingOfferId(null);
        setOfferForm(INITIAL_OFFER_FORM);
      }
    },
    onError: (error) => {
      setOfferFeedback({
        tone: "danger",
        title: "Teklif silinemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      if (businessId === null) {
        throw new Error("İşletme bilgisi okunamadı.");
      }
      return updateBusinessProfileOperations(businessId, buildProfilePayload(profileForm));
    },
    onSuccess: async () => {
      await invalidateProfile();
      setProfileFeedback({
        tone: "success",
        title: "Profil bilgileri güncellendi",
        description: "Bu işlem işletmenin müşteriye görünen profil açıklaması, rozet metni ve görünürlüğünü günceller.",
      });
      setProfileMode(null);
    },
    onError: (error) => {
      setProfileFeedback({
        tone: "danger",
        title: "Profil bilgileri güncellenemedi",
        description: getApiErrorMessage(error),
      });
    },
  });

  const isSubmittingMenu = createMenuMutation.isPending || updateMenuMutation.isPending;
  const isSubmittingCategory = createCategoryMutation.isPending || updateCategoryMutation.isPending;
  const isSubmittingOffer = createOfferMutation.isPending || updateOfferMutation.isPending;
  const isSubmittingProfile = updateProfileMutation.isPending;
  const quotaInputsDisabled = !menuForm.quota_enabled || isSubmittingMenu;
  const quotaInputClass = `w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)] disabled:cursor-not-allowed disabled:border-[var(--hy-color-neutral-200)] disabled:bg-[var(--hy-color-neutral-100)] disabled:text-[var(--hy-color-neutral-400)] ${
    menuForm.quota_enabled ? "bg-white" : "bg-[var(--hy-color-neutral-100)]"
  }`;

  function openCreateMenuForm() {
    setMenuFeedback(null);
    setMenuMode("create");
    setEditingMenuItemId(null);
    setMenuForm(INITIAL_MENU_FORM);
  }

  function openEditMenuForm(item: BusinessMenuItem) {
    setMenuFeedback(null);
    setMenuMode("edit");
    setEditingMenuItemId(item.id);
    setMenuForm(toMenuFormState(item));
  }

  function closeMenuForm() {
    setMenuMode(null);
    setEditingMenuItemId(null);
    setMenuForm(INITIAL_MENU_FORM);
  }

  function openCreateCategoryForm() {
    setCategoryFeedback(null);
    setCategoryMode("create");
    setEditingCategoryId(null);
    setCategoryForm(INITIAL_CATEGORY_FORM);
  }

  function openEditCategoryForm(category: BusinessCategoryItem) {
    setCategoryFeedback(null);
    setCategoryMode("edit");
    setEditingCategoryId(category.id);
    setCategoryForm({
      marketplace_category: String(category.id),
      is_active: category.is_active,
      is_primary: category.is_primary,
    });
  }

  function closeCategoryForm() {
    setCategoryMode(null);
    setEditingCategoryId(null);
    setCategoryForm(INITIAL_CATEGORY_FORM);
  }

  function openCreateOfferForm() {
    setOfferFeedback(null);
    setOfferMode("create");
    setEditingOfferId(null);
    setOfferForm(INITIAL_OFFER_FORM);
  }

  function openEditOfferForm(offer: BusinessOffer) {
    setOfferFeedback(null);
    setOfferMode("edit");
    setEditingOfferId(offer.id);
    setOfferForm(toOfferFormState(offer));
  }

  function closeOfferForm() {
    setOfferMode(null);
    setEditingOfferId(null);
    setOfferForm(INITIAL_OFFER_FORM);
  }

  function openProfileForm() {
    if (!profile) return;
    setProfileFeedback(null);
    setProfileMode("edit");
    setProfileForm(toProfileFormState(profile));
  }

  function closeProfileForm() {
    setProfileMode(null);
    if (profile) {
      setProfileForm(toProfileFormState(profile));
    } else {
      setProfileForm(INITIAL_PROFILE_FORM);
    }
  }

  function toggleMarketplaceCategory(categoryId: number) {
    setMenuForm((current) => {
      const exists = current.marketplace_category_ids.includes(categoryId);
      return {
        ...current,
        marketplace_category_ids: exists
          ? current.marketplace_category_ids.filter((id) => id !== categoryId)
          : [...current.marketplace_category_ids, categoryId],
      };
    });
  }

  async function handleSubmitMenuForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMenuFeedback(null);

    try {
      buildMenuPayload(menuForm);
    } catch (error) {
      setMenuFeedback({
        tone: "danger",
        title: "Form tamamlanamadı",
        description: error instanceof Error ? error.message : "Ürün bilgilerini kontrol edin.",
      });
      return;
    }

    if (menuMode === "create") {
      await createMenuMutation.mutateAsync();
      return;
    }

    if (menuMode === "edit") {
      await updateMenuMutation.mutateAsync();
    }
  }

  async function handleDeleteMenuItem(item: BusinessMenuItem) {
    const confirmed = window.confirm(`"${item.name}" ürününü silmek istediğinize emin misiniz?`);
    if (!confirmed) return;
    setMenuFeedback(null);
    await deleteMenuMutation.mutateAsync(item.id);
  }

  async function handleSubmitCategoryForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCategoryFeedback(null);

    try {
      buildCategoryPayload(categoryForm, { includeMarketplaceCategory: categoryMode === "create" });
    } catch (error) {
      setCategoryFeedback({
        tone: "danger",
        title: "Form tamamlanamadı",
        description: error instanceof Error ? error.message : "Kategori bilgilerini kontrol edin.",
      });
      return;
    }

    if (categoryMode === "create") {
      await createCategoryMutation.mutateAsync();
      return;
    }

    if (categoryMode === "edit") {
      await updateCategoryMutation.mutateAsync();
    }
  }

  async function handleDeleteCategory(category: BusinessCategoryItem) {
    const confirmed = window.confirm(`"${category.name}" kategori eşleşmesini silmek istediğinize emin misiniz?`);
    if (!confirmed) return;
    setCategoryFeedback(null);
    await deleteCategoryMutation.mutateAsync(category.id);
  }

  async function handleSubmitOfferForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOfferFeedback(null);

    try {
      buildOfferPayload(offerForm);
    } catch (error) {
      setOfferFeedback({
        tone: "danger",
        title: "Form tamamlanamadı",
        description: error instanceof Error ? error.message : "Teklif bilgilerini kontrol edin.",
      });
      return;
    }

    if (offerMode === "create") {
      await createOfferMutation.mutateAsync();
      return;
    }

    if (offerMode === "edit") {
      await updateOfferMutation.mutateAsync();
    }
  }

  async function handleDeleteOffer(offer: BusinessOffer) {
    const confirmed = window.confirm(`"${offer.title}" teklifini silmek istediğinize emin misiniz?`);
    if (!confirmed) return;
    setOfferFeedback(null);
    await deleteOfferMutation.mutateAsync(offer.id);
  }

  async function handleSubmitProfileForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileFeedback(null);

    try {
      buildProfilePayload(profileForm);
    } catch (error) {
      setProfileFeedback({
        tone: "danger",
        title: "Form tamamlanamadı",
        description: error instanceof Error ? error.message : "Profil alanlarını kontrol edin.",
      });
      return;
    }

    await updateProfileMutation.mutateAsync();
  }

  return (
    <OpsPageShell
      title="İçerik / menüler"
      description="Seçili işletmenin müşteri tarafında görünen menü, kategori, teklif, görsel ve profil alanlarını buradan yönet."
    >
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme numarası okunamadı." /> : null}

      <Card variant="surface">
        <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between" padding="lg">
          <div className="space-y-3">
            <Badge tone="primary">Ops içerik yönetimi</Badge>
            <div>
              <h2 className="text-xl font-semibold text-[var(--hy-color-neutral-950)]">Menü ve vitrin kontrolü</h2>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--hy-color-neutral-600)]">
                Menü ekleme, kategori eşleştirme, teklif ve profil görünürlüğü bu ekranda kontrollü şekilde güncellenir.
              </p>
            </div>
          </div>
          <OpsLinkRow
            links={[
              { href: "/ops/isletmeler", label: "İşletmelere dön" },
              ...(businessId !== null ? [{ href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı", primary: true }] : []),
            ]}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card variant="surface">
          <CardContent className="space-y-2" padding="md">
            <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Menü ürünleri</p>
            <p className="text-3xl font-bold tracking-tight text-[var(--hy-color-neutral-950)]">{menuItems.length}</p>
            <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">Listelenen ürün kaydı</p>
          </CardContent>
        </Card>
        <Card variant="surface">
          <CardContent className="space-y-2" padding="md">
            <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Kategoriler</p>
            <p className="text-3xl font-bold tracking-tight text-[var(--hy-color-neutral-950)]">{categories.length}</p>
            <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">Sistem eşleşme kaydı</p>
          </CardContent>
        </Card>
        <Card variant="surface">
          <CardContent className="space-y-2" padding="md">
            <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Teklifler</p>
            <p className="text-3xl font-bold tracking-tight text-[var(--hy-color-neutral-950)]">{offers.length}</p>
            <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">Kampanya ve vitrin teklifi</p>
          </CardContent>
        </Card>
        <Card variant="surface">
          <CardContent className="space-y-2" padding="md">
            <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Görseller</p>
            <p className="text-3xl font-bold tracking-tight text-[var(--hy-color-neutral-950)]">{mediaAssets.length}</p>
            <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">Logo, kapak ve galeri kaydı</p>
          </CardContent>
        </Card>
        <Card variant="surface">
          <CardContent className="space-y-2" padding="md">
            <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Profil görünürlüğü</p>
            <div className="pt-1">
              <OpsStatus label={profile?.marketplace_is_visible ? "VISIBLE" : "HIDDEN"} />
            </div>
            <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">Müşteri keşfinde görünürlük durumu</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <OpsSectionCard
          title="Menü ürünleri"
          description="Müşteriye görünen ürün adı, fiyatı, kategori eşleşmesi ve yayın durumu."
        >
          <div className="mb-5 flex flex-col gap-3 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-warning-100)] bg-[var(--hy-color-warning-50)] p-4">
            <p className="text-sm font-semibold text-[var(--hy-color-warning-700)]">Bu işlem işletmenin müşteriye görünen menüsünü günceller.</p>
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button size="sm" onClick={openCreateMenuForm}>
                Yeni ürün ekle
              </Button>
              {menuMode ? (
                <Button size="sm" variant="ghost" onClick={closeMenuForm}>
                  Formu kapat
                </Button>
              ) : null}
            </div>
          </div>

          {menuFeedback ? (
            <div className="mb-5">
              <OpsActionResult tone={menuFeedback.tone === "success" ? "success" : "danger"} title={menuFeedback.title} description={menuFeedback.description} />
            </div>
          ) : null}

          {menuMode ? (
            <div className="mb-5 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
              <form className="space-y-4" onSubmit={handleSubmitMenuForm}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--hy-color-neutral-950)]">
                      {menuMode === "create" ? "Yeni ürün ekle" : "Ürünü düzenle"}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--hy-color-neutral-600)]">
                      Temel ürün alanlarını güncelleyin. Kayıt sonrası liste otomatik yenilenir.
                    </p>
                  </div>
                  {menuMode === "edit" && editingMenuItem ? <Badge tone="secondary">#{editingMenuItem.id}</Badge> : null}
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Ürün adı</span>
                    <input
                      value={menuForm.name}
                      onChange={(event) => setMenuForm((current) => ({ ...current, name: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      placeholder="Örn. Et Döner Menü"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Fiyat</span>
                    <input
                      value={menuForm.price}
                      onChange={(event) => setMenuForm((current) => ({ ...current, price: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      placeholder="Örn. 145"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Minimum gram</span>
                    <input
                      value={menuForm.minimum_grams}
                      onChange={(event) => setMenuForm((current) => ({ ...current, minimum_grams: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      placeholder="Örn. 350"
                      inputMode="numeric"
                    />
                  </label>
                </div>

                <div className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-white p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--hy-color-neutral-900)]">Menü kotası</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--hy-color-neutral-600)]">
                        Sadece satışa açılacak adet girilir. Sipariş ödemesi tamamlandıkça kalan kota otomatik düşer.
                      </p>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-full bg-[var(--hy-color-neutral-50)] px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={menuForm.quota_enabled}
                        disabled={isSubmittingMenu}
                        onChange={(event) => setMenuForm((current) => ({ ...current, quota_enabled: event.target.checked }))}
                      />
                      <span>Kota aktif</span>
                    </label>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,280px)_1fr] md:items-end">
                    <label className="space-y-2 text-sm">
                      <span className="font-semibold text-[var(--hy-color-neutral-800)]">Kota adedi</span>
                      <input
                        value={menuForm.quota_total}
                        onChange={(event) => setMenuForm((current) => ({ ...current, quota_total: event.target.value }))}
                        className={quotaInputClass}
                        placeholder="Örn. 100"
                        inputMode="numeric"
                        disabled={quotaInputsDisabled}
                      />
                    </label>
                    <p className="rounded-[var(--hy-radius-sm)] bg-[var(--hy-color-neutral-50)] px-3 py-2.5 text-xs font-medium leading-5 text-[var(--hy-color-neutral-600)]">
                      Bu değer kaydedildiğinde mevcut kalan kota bu adede ayarlanır. Kalan 0 olursa ürün müşteri tarafında Tükendi görünür.
                    </p>
                  </div>
                  {!menuForm.quota_enabled ? (
                    <p className="mt-3 rounded-[var(--hy-radius-sm)] bg-[var(--hy-color-neutral-50)] px-3 py-2 text-xs font-medium leading-5 text-[var(--hy-color-neutral-600)]">
                      Kota kapalıyken bu ürün müşteri tarafında sınırsız kabul edilir.
                    </p>
                  ) : null}
                </div>

                <label className="space-y-2 text-sm block">
                  <span className="font-semibold text-[var(--hy-color-neutral-800)]">Açıklama</span>
                  <textarea
                    value={menuForm.description}
                    onChange={(event) => setMenuForm((current) => ({ ...current, description: event.target.value }))}
                    className="min-h-28 w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                    placeholder="Ürünün müşteriye görünecek kısa açıklaması"
                  />
                </label>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-[var(--hy-color-neutral-800)]">Sistem kategorileri</p>
                  {categoriesQuery.isPending ? <LoadingSkeleton className="h-24" /> : null}
                  {categoriesQuery.isError ? <SectionError title="Kategori listesi yüklenemedi" error={categoriesQuery.error} /> : null}
                  {!categoriesQuery.isPending && !categoriesQuery.isError ? (
                    <CategoryCheckboxList
                      categories={categories}
                      selectedIds={menuForm.marketplace_category_ids}
                      onToggle={toggleMarketplaceCategory}
                    />
                  ) : null}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={menuForm.is_active}
                      onChange={(event) => setMenuForm((current) => ({ ...current, is_active: event.target.checked }))}
                    />
                    <span>Aktif</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={menuForm.is_visible}
                      onChange={(event) => setMenuForm((current) => ({ ...current, is_visible: event.target.checked }))}
                    />
                    <span>Görünür</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={menuForm.is_available}
                      onChange={(event) => setMenuForm((current) => ({ ...current, is_available: event.target.checked }))}
                    />
                    <span>Satışta</span>
                  </label>
                </div>

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button type="submit" loading={isSubmittingMenu} loadingText={menuMode === "create" ? "Ürün ekleniyor..." : "Ürün güncelleniyor..."}>
                    {menuMode === "create" ? "Yeni ürün ekle" : "Ürünü düzenle"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={closeMenuForm} disabled={isSubmittingMenu}>
                    Vazgeç
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {menuItemsQuery.isPending ? <SectionLoading /> : null}
          {menuItemsQuery.isError ? <SectionError title="Menü ürünleri yüklenemedi" error={menuItemsQuery.error} /> : null}
          {!menuItemsQuery.isPending && !menuItemsQuery.isError ? (
            menuItems.length ? (
              <div className="space-y-3">
                {menuItems.slice(0, 6).map((item: BusinessMenuItem) => (
                  <div key={item.id} className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold text-[var(--hy-color-neutral-950)]">{item.name}</p>
                          <p className="text-sm text-[var(--hy-color-neutral-600)]">{item.category_name || "Kategori bilgisi yok"}</p>
                          {item.description ? <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">{item.description}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="secondary">{formatAmount(item.price_amount)}</Badge>
                          {item.minimum_grams ? <Badge tone="secondary">Min. {item.minimum_grams} gr</Badge> : null}
                          <Badge tone={item.is_active ? "success" : "neutral"}>{item.is_active ? "Aktif" : "Pasif"}</Badge>
                          <Badge tone={item.is_visible ? "success" : "warning"}>{item.is_visible ? "Görünür" : "Gizli"}</Badge>
                          <Badge tone={item.is_available ? "success" : "warning"}>{item.is_available ? "Satışta" : "Kapalı"}</Badge>
                          <Badge tone={!item.quota_enabled ? "secondary" : item.quota_remaining === 0 ? "warning" : "primary"}>
                            {formatMenuQuotaBadge(item)}
                          </Badge>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {item.marketplace_categories.map((category) => (
                          <Badge key={`${item.id}-${category.id}`} tone={category.is_primary ? "primary" : "secondary"}>
                            {category.name}
                          </Badge>
                        ))}
                      </div>

                      <div className="grid gap-2 sm:flex sm:flex-wrap">
                        <Button size="sm" variant="secondary" onClick={() => openEditMenuForm(item)}>
                          Ürünü düzenle
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={deleteMenuMutation.isPending && deleteMenuMutation.variables === item.id}
                          loadingText="Siliniyor..."
                          onClick={() => handleDeleteMenuItem(item)}
                        >
                          Ürünü sil
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {menuItems.length > 6 ? (
                  <p className="text-sm text-[var(--hy-color-neutral-500)]">Toplam {menuItems.length} ürün kaydı bulunuyor. Bu ekranda ilk 6 kayıt özetlenir.</p>
                ) : null}
              </div>
            ) : (
              <EmptySummary text="Bu işletme için kayıtlı menü ürünü görünmüyor. Operasyon ekibi ilk ürünü bu ekrandan ekleyebilir." />
            )
          ) : null}
        </OpsSectionCard>

        <OpsSectionCard
          title="Kategoriler"
          description="Sistem kategorileriyle eşleşme ve ana kategori bilgisi bu alanda okunur şekilde özetlenir."
        >
          <div className="mb-5 flex flex-col gap-3 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-warning-100)] bg-[var(--hy-color-warning-50)] p-4">
            <p className="text-sm font-semibold text-[var(--hy-color-warning-700)]">Bu işlem işletmenin müşteriye görünen kategori eşleşmelerini günceller.</p>
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button
                size="sm"
                onClick={openCreateCategoryForm}
                disabled={!availableCategoryOptions.length}
              >
                Yeni kategori ekle
              </Button>
              {categoryMode ? (
                <Button size="sm" variant="ghost" onClick={closeCategoryForm}>
                  Formu kapat
                </Button>
              ) : null}
            </div>
            {!availableCategoryOptions.length ? (
              <p className="text-sm leading-6 text-[var(--hy-color-warning-700)]">
                Yeni kategori eklemek için pazar yeri kategori listesi API desteği doğrulanmalıdır.
              </p>
            ) : null}
          </div>

          {categoryFeedback ? (
            <div className="mb-5">
              <OpsActionResult tone={categoryFeedback.tone === "success" ? "success" : "danger"} title={categoryFeedback.title} description={categoryFeedback.description} />
            </div>
          ) : null}

          {categoryMode ? (
            <div className="mb-5 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
              <form className="space-y-4" onSubmit={handleSubmitCategoryForm}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--hy-color-neutral-950)]">
                      {categoryMode === "create" ? "Yeni kategori ekle" : "Kategoriyi düzenle"}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--hy-color-neutral-600)]">
                      Kategori eşleşmesini güvenli alanlarla güncelleyin. Kayıt sonrası liste otomatik yenilenir.
                    </p>
                  </div>
                  {categoryMode === "edit" && editingCategory ? <Badge tone="secondary">#{editingCategory.id}</Badge> : null}
                </div>

                {categoryMode === "create" ? (
                  <label className="space-y-2 text-sm block">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Pazar yeri kategorisi</span>
                    <select
                      value={categoryForm.marketplace_category}
                      onChange={(event) => setCategoryForm((current) => ({ ...current, marketplace_category: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                    >
                      <option value="">Kategori seçin</option>
                      {availableCategoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3">
                    <p className="text-sm font-semibold text-[var(--hy-color-neutral-900)]">{editingCategory?.name || "Kategori"}</p>
                    <p className="mt-1 text-sm text-[var(--hy-color-neutral-500)]">
                      {editingCategory?.description || "Açıklama eklenmemiş."}
                    </p>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={categoryForm.is_active}
                      onChange={(event) => setCategoryForm((current) => ({ ...current, is_active: event.target.checked }))}
                    />
                    <span>Aktif</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={categoryForm.is_primary}
                      onChange={(event) => setCategoryForm((current) => ({ ...current, is_primary: event.target.checked }))}
                    />
                    <span>Ana kategori</span>
                  </label>
                </div>

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button
                    type="submit"
                    loading={isSubmittingCategory}
                    loadingText={categoryMode === "create" ? "Kategori ekleniyor..." : "Kategori güncelleniyor..."}
                  >
                    {categoryMode === "create" ? "Yeni kategori ekle" : "Kategoriyi düzenle"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={closeCategoryForm} disabled={isSubmittingCategory}>
                    Vazgeç
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {categoriesQuery.isPending ? <SectionLoading /> : null}
          {categoriesQuery.isError ? <SectionError title="Kategori bilgileri yüklenemedi" error={categoriesQuery.error} /> : null}
          {!categoriesQuery.isPending && !categoriesQuery.isError ? (
            selectedCategories.length ? (
              <div className="space-y-4">
                <OpsKeyValueGrid
                  items={[
                    { label: "Toplam eşleşme", value: `${selectedCategories.length} kategori` },
                    { label: "Ana kategori", value: primaryCategory?.name || "Belirlenmemiş" },
                  ]}
                />
                <div className="space-y-3">
                  {selectedCategories.slice(0, 6).map((category: BusinessCategoryItem) => (
                    <div key={category.id} className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="space-y-1">
                            <p className="font-semibold text-[var(--hy-color-neutral-950)]">{category.name}</p>
                            <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">{category.description || "Açıklama eklenmemiş."}</p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {category.is_primary ? <Badge tone="primary">Ana kategori</Badge> : null}
                            <Badge tone={category.is_active ? "success" : "neutral"}>{category.is_active ? "Aktif" : "Pasif"}</Badge>
                            <Badge tone="secondary">{category.public_menu_item_count} ürün</Badge>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <div className="grid gap-2 sm:flex sm:flex-wrap">
                            <Button size="sm" variant="secondary" onClick={() => openEditCategoryForm(category)}>
                              Kategoriyi düzenle
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              loading={deleteCategoryMutation.isPending && deleteCategoryMutation.variables === category.id}
                              loadingText="Siliniyor..."
                              onClick={() => handleDeleteCategory(category)}
                            >
                              Kategoriyi sil
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptySummary text="Bu işletme için kategori eşleşmesi görünmüyor. Uygun pazar yeri kategorisi varsa operasyon ekibi ilk eşleşmeyi bu ekrandan ekleyebilir." />
            )
          ) : null}
        </OpsSectionCard>

        <OpsSectionCard
          title="Teklifler"
          description="Kampanya, indirim, tarih ve limit bilgileri merkezi ekip tarafından izlenmeden önce burada özetlenir."
        >
          <div className="mb-5 flex flex-col gap-3 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-warning-100)] bg-[var(--hy-color-warning-50)] p-4">
            <p className="text-sm font-semibold text-[var(--hy-color-warning-700)]">Bu işlem işletmenin müşteriye görünen teklif ve kampanya bilgisini günceller.</p>
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button size="sm" onClick={openCreateOfferForm}>
                Yeni teklif ekle
              </Button>
              {offerMode ? (
                <Button size="sm" variant="ghost" onClick={closeOfferForm}>
                  Formu kapat
                </Button>
              ) : null}
            </div>
          </div>

          {offerFeedback ? (
            <div className="mb-5">
              <OpsActionResult tone={offerFeedback.tone === "success" ? "success" : "danger"} title={offerFeedback.title} description={offerFeedback.description} />
            </div>
          ) : null}

          {offerMode ? (
            <div className="mb-5 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
              <form className="space-y-4" onSubmit={handleSubmitOfferForm}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-[var(--hy-color-neutral-950)]">
                      {offerMode === "create" ? "Yeni teklif ekle" : "Teklifi düzenle"}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[var(--hy-color-neutral-600)]">
                      Teklifin temel müşteri görünümünü güncelleyin. Kayıt sonrası liste otomatik yenilenir.
                    </p>
                  </div>
                  {offerMode === "edit" && editingOffer ? <Badge tone="secondary">#{editingOffer.id}</Badge> : null}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Teklif başlığı</span>
                    <input
                      value={offerForm.title}
                      onChange={(event) => setOfferForm((current) => ({ ...current, title: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      placeholder="Örn. Öğle kampanyası"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Teklif fiyatı</span>
                    <input
                      value={offerForm.price}
                      onChange={(event) => setOfferForm((current) => ({ ...current, price: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      placeholder="Örn. 129"
                      inputMode="decimal"
                    />
                  </label>
                </div>

                <label className="space-y-2 text-sm block">
                  <span className="font-semibold text-[var(--hy-color-neutral-800)]">Açıklama</span>
                  <textarea
                    value={offerForm.description}
                    onChange={(event) => setOfferForm((current) => ({ ...current, description: event.target.value }))}
                    className="min-h-28 w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                    placeholder="Teklifin kısa açıklaması"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Başlangıç tarihi</span>
                    <input
                      type="datetime-local"
                      value={offerForm.starts_at}
                      onChange={(event) => setOfferForm((current) => ({ ...current, starts_at: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Bitiş tarihi</span>
                    <input
                      type="datetime-local"
                      value={offerForm.ends_at}
                      onChange={(event) => setOfferForm((current) => ({ ...current, ends_at: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Günlük limit</span>
                    <input
                      value={offerForm.daily_limit}
                      onChange={(event) => setOfferForm((current) => ({ ...current, daily_limit: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      placeholder="Boş bırakılırsa sınırsız"
                      inputMode="numeric"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Sıralama</span>
                    <input
                      value={offerForm.sort_order}
                      onChange={(event) => setOfferForm((current) => ({ ...current, sort_order: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      placeholder="Örn. 10"
                      inputMode="numeric"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={offerForm.is_active}
                      onChange={(event) => setOfferForm((current) => ({ ...current, is_active: event.target.checked }))}
                    />
                    <span>Aktif</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={offerForm.is_featured}
                      onChange={(event) => setOfferForm((current) => ({ ...current, is_featured: event.target.checked }))}
                    />
                    <span>Öne çıkar</span>
                  </label>
                </div>

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button
                    type="submit"
                    loading={isSubmittingOffer}
                    loadingText={offerMode === "create" ? "Teklif ekleniyor..." : "Teklif güncelleniyor..."}
                  >
                    {offerMode === "create" ? "Yeni teklif ekle" : "Teklifi düzenle"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={closeOfferForm} disabled={isSubmittingOffer}>
                    Vazgeç
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {offersQuery.isPending ? <SectionLoading /> : null}
          {offersQuery.isError ? <SectionError title="Teklif bilgileri yüklenemedi" error={offersQuery.error} /> : null}
          {!offersQuery.isPending && !offersQuery.isError ? (
            offers.length ? (
              <div className="space-y-3">
                {offers.slice(0, 6).map((offer: BusinessOffer) => (
                  <div key={offer.id} className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold text-[var(--hy-color-neutral-950)]">{offer.title}</p>
                          <p className="text-sm text-[var(--hy-color-neutral-600)]">{offer.short_description || offer.description || "Açıklama eklenmemiş."}</p>
                          <p className="text-xs text-[var(--hy-color-neutral-500)]">
                            {formatDateTime(offer.starts_at)} - {formatDateTime(offer.ends_at)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="secondary">{formatAmount(offer.offer_price_amount)}</Badge>
                          <Badge tone={offer.is_active ? "success" : "neutral"}>{offer.is_active ? "Aktif" : "Pasif"}</Badge>
                          {offer.is_featured ? <Badge tone="primary">Öne çıkarılmış</Badge> : null}
                          {offer.daily_limit !== null ? <Badge tone="warning">Günlük limit: {offer.daily_limit}</Badge> : null}
                        </div>
                      </div>

                      <div className="grid gap-2 sm:flex sm:flex-wrap">
                        <Button size="sm" variant="secondary" onClick={() => openEditOfferForm(offer)}>
                          Teklifi düzenle
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          loading={deleteOfferMutation.isPending && deleteOfferMutation.variables === offer.id}
                          loadingText="Siliniyor..."
                          onClick={() => handleDeleteOffer(offer)}
                        >
                          Teklifi sil
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {offers.length > 6 ? (
                  <p className="text-sm text-[var(--hy-color-neutral-500)]">Toplam {offers.length} teklif kaydı bulunuyor. Bu ekranda ilk 6 kayıt özetlenir.</p>
                ) : null}
              </div>
            ) : (
              <EmptySummary text="Bu işletme için aktif ya da geçmiş teklif kaydı görünmüyor." />
            )
          ) : null}
        </OpsSectionCard>

        <OpsSectionCard
          title="Görsel medya"
          description="Logo, kapak ve galeri görselleri burada yalnızca okunur özet ve sayısal dağılımla gösterilir."
        >
          {mediaQuery.isPending ? <SectionLoading /> : null}
          {mediaQuery.isError ? <SectionError title="Görsel medya yüklenemedi" error={mediaQuery.error} /> : null}
          {!mediaQuery.isPending && !mediaQuery.isError ? (
            mediaAssets.length ? (
              <div className="space-y-4">
                <OpsKeyValueGrid
                  items={[
                    { label: "Toplam medya", value: `${mediaAssets.length} kayıt` },
                    { label: "Logo", value: summarizeMediaRole(mediaAssets, "LOGO") },
                    { label: "Kapak", value: summarizeMediaRole(mediaAssets, "COVER") },
                    { label: "Galeri", value: summarizeMediaRole(mediaAssets, "GALLERY") },
                  ]}
                />
                <div className="space-y-3">
                  {mediaAssets.slice(0, 6).map((asset: BusinessMediaAsset) => (
                    <div key={asset.id} className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-1">
                          <p className="font-semibold text-[var(--hy-color-neutral-950)]">{asset.alt_text || `Medya #${asset.id}`}</p>
                          <p className="text-sm text-[var(--hy-color-neutral-600)] break-all">{asset.url || asset.file_url || asset.file_path}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge tone="secondary">{asset.asset_role}</Badge>
                          <Badge tone={asset.is_active ? "success" : "neutral"}>{asset.is_active ? "Aktif" : "Pasif"}</Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptySummary text="Bu işletme için medya kaydı görünmüyor." />
            )
          ) : null}
        </OpsSectionCard>

        <OpsSectionCard
          title="Profil görünürlüğü"
          description="Müşteriye görünen kısa açıklama, rozet metni ve pazar yeri görünürlüğü burada okunur olarak incelenir."
        >
          <div className="mb-5 flex flex-col gap-3 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-warning-100)] bg-[var(--hy-color-warning-50)] p-4">
            <p className="text-sm font-semibold text-[var(--hy-color-warning-700)]">Bu işlem işletmenin müşteriye görünen profil açıklaması, rozet metni ve görünürlüğünü günceller.</p>
            <div className="grid gap-2 sm:flex sm:flex-wrap">
              <Button size="sm" onClick={openProfileForm} disabled={!profile}>
                Profil bilgilerini düzenle
              </Button>
              {profileMode ? (
                <Button size="sm" variant="ghost" onClick={closeProfileForm}>
                  Formu kapat
                </Button>
              ) : null}
            </div>
          </div>

          {profileFeedback ? (
            <div className="mb-5">
              <OpsActionResult tone={profileFeedback.tone === "success" ? "success" : "danger"} title={profileFeedback.title} description={profileFeedback.description} />
            </div>
          ) : null}

          {profileMode ? (
            <div className="mb-5 rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
              <form className="space-y-4" onSubmit={handleSubmitProfileForm}>
                <div>
                  <h3 className="text-base font-semibold text-[var(--hy-color-neutral-950)]">Profil bilgilerini düzenle</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--hy-color-neutral-600)]">
                    Müşteriye görünen açıklama ve görünürlük alanlarını güncelleyin. Kayıt sonrası profil özeti yenilenir.
                  </p>
                </div>

                <label className="space-y-2 text-sm block">
                  <span className="font-semibold text-[var(--hy-color-neutral-800)]">Kısa açıklama</span>
                  <textarea
                    value={profileForm.short_description}
                    onChange={(event) => setProfileForm((current) => ({ ...current, short_description: event.target.value }))}
                    className="min-h-24 w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                  />
                </label>

                <label className="space-y-2 text-sm block">
                  <span className="font-semibold text-[var(--hy-color-neutral-800)]">Tanıtım metni</span>
                  <textarea
                    value={profileForm.intro_text}
                    onChange={(event) => setProfileForm((current) => ({ ...current, intro_text: event.target.value }))}
                    className="min-h-28 w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                  />
                </label>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Rozet metni</span>
                    <input
                      value={profileForm.badge_text}
                      onChange={(event) => setProfileForm((current) => ({ ...current, badge_text: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                    />
                  </label>

                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Listeleme türü</span>
                    <input
                      value={profileForm.listing_type}
                      onChange={(event) => setProfileForm((current) => ({ ...current, listing_type: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="font-semibold text-[var(--hy-color-neutral-800)]">Sıralama önceliği</span>
                    <input
                      value={profileForm.display_priority}
                      onChange={(event) => setProfileForm((current) => ({ ...current, display_priority: event.target.value }))}
                      className="w-full rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-300)] bg-white px-3 py-2.5 text-sm outline-none transition focus:border-[var(--hy-color-primary-400)]"
                      inputMode="numeric"
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={profileForm.marketplace_is_visible}
                      onChange={(event) => setProfileForm((current) => ({ ...current, marketplace_is_visible: event.target.checked }))}
                    />
                    <span>Pazar yerinde görünür</span>
                  </label>
                  <label className="flex items-center gap-3 rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-white px-3 py-3 text-sm">
                    <input
                      type="checkbox"
                      checked={profileForm.is_featured}
                      onChange={(event) => setProfileForm((current) => ({ ...current, is_featured: event.target.checked }))}
                    />
                    <span>Öne çıkar</span>
                  </label>
                </div>

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  <Button type="submit" loading={isSubmittingProfile} loadingText="Profil güncelleniyor...">
                    Profil bilgilerini düzenle
                  </Button>
                  <Button type="button" variant="secondary" onClick={closeProfileForm} disabled={isSubmittingProfile}>
                    Vazgeç
                  </Button>
                </div>
              </form>
            </div>
          ) : null}

          {profileQuery.isPending ? <SectionLoading /> : null}
          {profileQuery.isError ? <SectionError title="Profil bilgileri yüklenemedi" error={profileQuery.error} /> : null}
          {!profileQuery.isPending && !profileQuery.isError && profile ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <OpsStatus label={profile.marketplace_is_visible ? "VISIBLE" : "HIDDEN"} />
                <OpsStatus label={profile.is_featured ? "FEATURED" : "STANDARD"} />
                <Badge tone="secondary">{profile.listing_type || "STANDARD"}</Badge>
              </div>
              <OpsKeyValueGrid
                items={[
                  { label: "İşletme adı", value: profile.business_name || "-" },
                  { label: "Rozet metni", value: profile.badge_text || "Tanımlı değil" },
                  { label: "Sıralama önceliği", value: profile.display_priority },
                ]}
              />
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                  <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Kısa açıklama</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--hy-color-neutral-700)]">{profile.short_description || "Kısa açıklama eklenmemiş."}</p>
                </div>
                <div className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                  <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Tanıtım metni</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--hy-color-neutral-700)]">{profile.intro_text || "Tanıtım metni eklenmemiş."}</p>
                </div>
              </div>
            </div>
          ) : null}
        </OpsSectionCard>
      </div>
    </OpsPageShell>
  );
}
