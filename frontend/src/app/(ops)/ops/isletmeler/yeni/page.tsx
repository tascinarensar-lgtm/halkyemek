"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, ImagePlus, MapPin, Plus, ShieldCheck, Store, Trash2, UserRound, UtensilsCrossed } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { ProtectedPageShell } from "@/components/layout/protected-page-shell";
import { Container } from "@/components/ui/Container";
import { EmptyState } from "@/components/ui/empty-state";
import { createBusinessMediaAsset, createBusinessMenuItem, listBusinessCategories, uploadBusinessMediaAsset } from "@/features/business-operations/api";
import type { BusinessCategoryItem } from "@/features/business-operations/types";
import { createOpsBusiness, upsertOpsBusinessMembership } from "@/features/ops-console/api";
import type { OpsBusinessCreateResponse } from "@/features/ops-console/types";
import { invalidateOpsQueries } from "@/features/ops-console/utils";
import { createBusinessSurpriseDeal } from "@/features/surprise-deals/api";
import { getApiErrorMessage } from "@/lib/api/errors";

type FormState = {
  business_name: string;
  category: string;
  supports_halkyemek: boolean;
  supports_halktasarruf: boolean;
  address_line: string;
  google_maps_url: string;
  latitude: string;
  longitude: string;
  kyc_contact_name: string;
  kyc_contact_surname: string;
  kyc_identity_number: string;
  kyc_tax_number: string;
  kyc_iban: string;
  short_description: string;
  listing_type: string;
  publish_now: boolean;
};

type StaffRow = {
  user_id: string;
  role: string;
};

type MediaState = {
  cover_url: string;
  logo_url: string;
  cover_file: File | null;
  logo_file: File | null;
};

type MenuRow = {
  name: string;
  price: string;
  description: string;
  minimum_grams: string;
  category: string;
  image_url: string;
  image_file: File | null;
  quota_enabled: boolean;
  quota_total: string;
};

type SurpriseDealRow = {
  title: string;
  description: string;
  original_value: string;
  sale_price: string;
  quantity_total: string;
  grams: string;
  pickup_end: string;
  min_contents_note: string;
  allergens_note: string;
  image_url: string;
  image_file: File | null;
};

type CreateResult = {
  business: OpsBusinessCreateResponse;
  staffCount: number;
  contentCount: number;
  mediaCount: number;
  warnings: string[];
};

const HALKYEMEK_CATEGORY_OPTIONS = ["Burger", "Pizza", "Döner", "Kebap"];
const HALKTASARRUF_CATEGORY_OPTIONS = [
  "Fırın & Pastane",
  "Kafe & Kahve Zincirleri",
  "Marketler",
  "Fast Food Restoranları",
  "Döner-Kebap İşletmeleri",
];
const PRODUCT_OPTIONS = {
  halkyemek: {
    label: "HalkYemek",
    intro: "QR, menü ve cüzdan akışında çalışacak klasik HalkYemek işletmesi.",
    accentClassName: "border-rose-200 bg-rose-50 text-[#f50555]",
    iconClassName: "bg-[#f50555]",
    buttonClassName: "bg-[#f50555] hover:bg-[#dc004c] shadow-[0_18px_42px_rgba(245,5,85,0.28)]",
  },
  halktasarruf: {
    label: "HalkTasarruf",
    intro: "Sürpriz paket ve teslim saatleri akışında çalışacak fırsat işletmesi.",
    accentClassName: "border-violet-200 bg-violet-50 text-violet-700",
    iconClassName: "bg-[linear-gradient(135deg,#5B21B6,#7C3AED)]",
    buttonClassName: "bg-[linear-gradient(135deg,#5B21B6,#7C3AED)] hover:brightness-110 shadow-[0_18px_42px_rgba(109,40,217,0.28)]",
  },
} as const;
const ROLE_OPTIONS = [
  { value: "OWNER", label: "İşletme sahibi" },
  { value: "MANAGER", label: "Yönetici" },
  { value: "CASHIER", label: "Kasa görevlisi" },
];
const LISTING_OPTIONS = [
  { value: "CONTRACTED", label: "Anlaşmalı işletme" },
  { value: "VOLUNTEER", label: "Gönüllü işletme" },
];

const INITIAL_FORM: FormState = {
  business_name: "",
  category: "Burger",
  supports_halkyemek: true,
  supports_halktasarruf: false,
  address_line: "",
  google_maps_url: "",
  latitude: "",
  longitude: "",
  kyc_contact_name: "",
  kyc_contact_surname: "",
  kyc_identity_number: "",
  kyc_tax_number: "",
  kyc_iban: "",
  short_description: "",
  listing_type: "CONTRACTED",
  publish_now: true,
};

const INITIAL_STAFF_ROW: StaffRow = { user_id: "", role: "OWNER" };
const INITIAL_MENU_ROW: MenuRow = {
  name: "",
  price: "",
  description: "",
  minimum_grams: "",
  category: "Burger",
  image_url: "",
  image_file: null,
  quota_enabled: false,
  quota_total: "",
};
const MAX_MEDIA_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
const INITIAL_MEDIA_STATE: MediaState = { cover_url: "", logo_url: "", cover_file: null, logo_file: null };

function cleanOptionalText(value: string) {
  const text = value.trim();
  return text ? text : undefined;
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
    throw new Error("Tutar geçerli bir değer olmalıdır.");
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

function normalizeCoordinatePayload(value: string) {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return trimmed;
  return parsed.toFixed(6);
}

function hasMenuContent(row: MenuRow) {
  return Boolean(row.name.trim() || row.price.trim() || row.description.trim() || row.image_url.trim() || row.image_file);
}

function hasSurpriseDealContent(row: SurpriseDealRow) {
  return Boolean(
    row.title.trim() ||
      row.description.trim() ||
      row.original_value.trim() ||
      row.sale_price.trim() ||
      row.pickup_end.trim() ||
      row.min_contents_note.trim() ||
      row.allergens_note.trim() ||
      row.image_url.trim() ||
      row.image_file,
  );
}

function toIsoDateTime(value: string) {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const adjusted = new Date(date.getTime() - offset * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function createDefaultPickupEndValue() {
  const date = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const roundedMinutes = Math.ceil(date.getMinutes() / 15) * 15;
  date.setMinutes(roundedMinutes, 0, 0);
  return toDateTimeLocalValue(date.toISOString());
}

function createInitialSurpriseDealRow(): SurpriseDealRow {
  return {
    title: "",
    description: "",
    original_value: "",
    sale_price: "",
    quantity_total: "1",
    grams: "",
    pickup_end: createDefaultPickupEndValue(),
    min_contents_note: "",
    allergens_note: "",
    image_url: "",
    image_file: null,
  };
}

function getPickupDatePart(value: string) {
  return (value || createDefaultPickupEndValue()).split("T")[0] ?? "";
}

function getPickupTimePart(value: string) {
  return (value || createDefaultPickupEndValue()).split("T")[1] ?? "20:00";
}

function setPickupDatePart(value: string, nextDate: string) {
  return `${nextDate}T${getPickupTimePart(value)}`;
}

function setPickupTimePart(value: string, nextTime: string) {
  return `${getPickupDatePart(value)}T${nextTime}`;
}

function shiftPickupDate(value: string, days: number) {
  const base = toIsoDateTime(value) ?? new Date().toISOString();
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return toDateTimeLocalValue(date.toISOString()) || createDefaultPickupEndValue();
}

function formatPickupPreview(value: string) {
  const isoValue = toIsoDateTime(value);
  if (!isoValue) return "Teslim bitiş zamanını seç";
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(isoValue));
}

function isValidImageFile(file: File | null) {
  if (!file) return true;
  return IMAGE_FILE_TYPES.includes(file.type);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fieldClassName() {
  return "w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-[#f50555]/45 focus:bg-white focus:ring-4 focus:ring-rose-100";
}

function FieldLabel({ children }: { children: string }) {
  return <span className="text-sm font-semibold text-zinc-800">{children}</span>;
}

function MediaFilePicker({
  label,
  helper,
  file,
  onFileChange,
  onClear,
}: {
  label: string;
  helper: string;
  file: File | null;
  onFileChange: (file: File | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-dashed border-rose-200 bg-rose-50/45 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{label}</p>
          <p className="mt-1 text-xs leading-5 text-zinc-500">{helper}</p>
        </div>
        <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-[#f50555] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(245,5,85,0.22)] transition hover:bg-[#dc004c]">
          Görsel seç
          <input
            type="file"
            accept={IMAGE_FILE_TYPES.join(",")}
            className="sr-only"
            onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      {file ? (
        <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-white/80 bg-white px-3 py-3 text-sm text-zinc-700 sm:flex-row sm:items-center sm:justify-between">
          <span className="truncate font-medium">{file.name}</span>
          <span className="flex items-center gap-3 text-xs text-zinc-500">
            {formatFileSize(file.size)}
            <button type="button" onClick={onClear} className="font-semibold text-[#f50555] hover:text-[#dc004c]">
              Kaldır
            </button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function findCategoryId(categories: BusinessCategoryItem[], categoryName: string) {
  const normalized = slugify(categoryName);
  const exact = categories.find((category) => slugify(category.name) === normalized || category.slug === normalized);
  const fallback = categories.find((category) => category.is_selected) || categories[0];
  return exact?.id ?? fallback?.id ?? null;
}

export default function OpsBusinessCreatePage() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const currentProduct = searchParams.get("product") === "halktasarruf" ? "halktasarruf" : "halkyemek";
  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL_FORM,
    supports_halkyemek: currentProduct === "halkyemek",
    supports_halktasarruf: currentProduct === "halktasarruf",
  }));
  const [staffRows, setStaffRows] = useState<StaffRow[]>([{ ...INITIAL_STAFF_ROW }]);
  const [media, setMedia] = useState<MediaState>(INITIAL_MEDIA_STATE);
  const [menuRows, setMenuRows] = useState<MenuRow[]>([{ ...INITIAL_MENU_ROW }]);
  const [surpriseDealRows, setSurpriseDealRows] = useState<SurpriseDealRow[]>(() => [createInitialSurpriseDealRow()]);
  const [createdBusiness, setCreatedBusiness] = useState<OpsBusinessCreateResponse | null>(null);
  const [createResult, setCreateResult] = useState<CreateResult | null>(null);
  const productMeta = PRODUCT_OPTIONS[currentProduct];
  const isHalkTasarrufFlow = currentProduct === "halktasarruf";
  const activeCategoryOptions = useMemo(() => {
    const options = new Set<string>();
    if (form.supports_halkyemek) {
      HALKYEMEK_CATEGORY_OPTIONS.forEach((category) => options.add(category));
    }
    if (form.supports_halktasarruf) {
      HALKTASARRUF_CATEGORY_OPTIONS.forEach((category) => options.add(category));
    }
    return Array.from(options);
  }, [form.supports_halktasarruf, form.supports_halkyemek]);
  const selectedProductsLabel = useMemo(() => {
    const labels = [
      form.supports_halkyemek ? PRODUCT_OPTIONS.halkyemek.label : null,
      form.supports_halktasarruf ? PRODUCT_OPTIONS.halktasarruf.label : null,
    ].filter(Boolean);
    return labels.join(" + ");
  }, [form.supports_halktasarruf, form.supports_halkyemek]);

  useEffect(() => {
    if (activeCategoryOptions.length === 0) return;
    if (!activeCategoryOptions.includes(form.category)) {
      setForm((current) => ({ ...current, category: activeCategoryOptions[0] ?? current.category }));
    }
  }, [activeCategoryOptions, form.category]);

  useEffect(() => {
    if (activeCategoryOptions.length === 0) return;
    setMenuRows((rows) => {
      let hasChanged = false;
      const normalizedRows = rows.map((row) => {
        if (activeCategoryOptions.includes(row.category)) return row;
        hasChanged = true;
        return { ...row, category: activeCategoryOptions[0] ?? row.category };
      });
      return hasChanged ? normalizedRows : rows;
    });
  }, [activeCategoryOptions]);

  const validStaffRows = useMemo(
    () =>
      staffRows
        .map((row) => ({ ...row, user_id: row.user_id.trim() }))
        .filter((row) => row.user_id),
    [staffRows],
  );
  const validMenuRows = useMemo(() => menuRows.filter(hasMenuContent), [menuRows]);
  const validSurpriseDealRows = useMemo(() => surpriseDealRows.filter(hasSurpriseDealContent), [surpriseDealRows]);
  const menuMediaCount = validMenuRows.filter((row) => row.image_file || row.image_url.trim()).length;
  const contentMediaCount = isHalkTasarrufFlow
    ? validSurpriseDealRows.filter((row) => row.image_url.trim() || row.image_file).length
    : menuMediaCount;
  const mediaCount = Number(Boolean(media.cover_file || media.cover_url.trim())) + Number(Boolean(media.logo_file || media.logo_url.trim())) + contentMediaCount;
  const contentCount = isHalkTasarrufFlow ? validSurpriseDealRows.length : validMenuRows.length;

  const formIssues = useMemo(() => {
    const issues: string[] = [];
    if (!form.business_name.trim()) issues.push("İşletme adı zorunludur.");
    if (!form.category.trim()) issues.push("Kategori zorunludur.");
    if (!form.supports_halkyemek && !form.supports_halktasarruf) issues.push("İşletme en az bir üründe aktif olmalıdır.");
    if ((form.latitude.trim() && !form.longitude.trim()) || (!form.latitude.trim() && form.longitude.trim())) {
      issues.push("Enlem ve boylam birlikte girilmelidir.");
    }
    if (!isValidImageFile(media.cover_file)) issues.push("Kapak görseli JPG, PNG, WEBP, GIF veya SVG olmalıdır.");
    if (!isValidImageFile(media.logo_file)) issues.push("Logo görseli JPG, PNG, WEBP, GIF veya SVG olmalıdır.");
    if (media.cover_file && media.cover_file.size > MAX_MEDIA_FILE_BYTES) issues.push("Kapak görseli 8 MB sınırını aşamaz.");
    if (media.logo_file && media.logo_file.size > MAX_MEDIA_FILE_BYTES) issues.push("Logo görseli 8 MB sınırını aşamaz.");

    validStaffRows.forEach((row, index) => {
      if (row.user_id.includes("@")) return;
      const parsed = Number(row.user_id);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        issues.push(`${index + 1}. yetkili için kullanıcı ID veya e-posta geçerli olmalıdır.`);
      }
    });

    if (isHalkTasarrufFlow) {
      validSurpriseDealRows.forEach((row, index) => {
        if (!row.title.trim()) issues.push(`${index + 1}. paket için başlık zorunludur.`);
        if (!row.original_value.trim()) issues.push(`${index + 1}. paket için tahmini değer zorunludur.`);
        if (!row.sale_price.trim()) issues.push(`${index + 1}. paket için satış fiyatı zorunludur.`);
        if (!row.pickup_end.trim()) issues.push(`${index + 1}. paket için teslim bitiş tarihi zorunludur.`);
        if (!row.min_contents_note.trim()) issues.push(`${index + 1}. paket için minimum içerik notu zorunludur.`);
        if (!isValidImageFile(row.image_file)) issues.push(`${index + 1}. paket görseli JPG, PNG, WEBP, GIF veya SVG olmalıdır.`);
        if (row.image_file && row.image_file.size > MAX_MEDIA_FILE_BYTES) issues.push(`${index + 1}. paket görseli 8 MB sınırını aşamaz.`);

        const originalValue = Number(row.original_value.replace(",", ".").trim());
        const salePrice = Number(row.sale_price.replace(",", ".").trim());
        const quantity = Number(row.quantity_total.trim());
        const grams = row.grams.trim() ? Number(row.grams.trim()) : null;
        const pickupEnd = row.pickup_end.trim() ? new Date(row.pickup_end) : null;

        if (row.original_value.trim() && (!Number.isFinite(originalValue) || originalValue <= 0)) {
          issues.push(`${index + 1}. paket için tahmini değer geçerli olmalıdır.`);
        }
        if (row.sale_price.trim() && (!Number.isFinite(salePrice) || salePrice <= 0)) {
          issues.push(`${index + 1}. paket için satış fiyatı geçerli olmalıdır.`);
        }
        if (Number.isFinite(originalValue) && Number.isFinite(salePrice) && salePrice > originalValue) {
          issues.push(`${index + 1}. pakette satış fiyatı tahmini değerden yüksek olamaz.`);
        }
        if (!Number.isInteger(quantity) || quantity <= 0) {
          issues.push(`${index + 1}. paket için toplam adet 1 veya daha büyük olmalıdır.`);
        }
        if (grams !== null && (!Number.isInteger(grams) || grams <= 0)) {
          issues.push(`${index + 1}. paket için gram bilgisi 1 veya daha büyük olmalıdır.`);
        }
        if (pickupEnd && Number.isNaN(pickupEnd.getTime())) {
          issues.push(`${index + 1}. paket için teslim bitiş tarihi geçerli olmalıdır.`);
        }
      });
    } else {
      validMenuRows.forEach((row, index) => {
        if (!row.name.trim()) issues.push(`${index + 1}. menü için ürün adı zorunludur.`);
        if (!row.price.trim()) issues.push(`${index + 1}. menü için fiyat zorunludur.`);
        if (!isValidImageFile(row.image_file)) issues.push(`${index + 1}. menü görseli JPG, PNG, WEBP, GIF veya SVG olmalıdır.`);
        if (row.image_file && row.image_file.size > MAX_MEDIA_FILE_BYTES) issues.push(`${index + 1}. menü görseli 8 MB sınırını aşamaz.`);
        if (row.price.trim()) {
          const parsed = Number(row.price.replace(",", ".").trim());
          if (!Number.isFinite(parsed) || parsed <= 0) issues.push(`${index + 1}. menü fiyatı geçerli olmalıdır.`);
        }
        if (row.minimum_grams.trim()) {
          const grams = Number(row.minimum_grams.trim());
          if (!Number.isInteger(grams) || grams <= 0) {
            issues.push(`${index + 1}. menü için minimum gram bilgisi 1 veya daha büyük olmalıdır.`);
          }
        }
        if (row.quota_enabled) {
          const total = Number(row.quota_total.trim());
          if (!row.quota_total.trim()) issues.push(`${index + 1}. menü için kota adedi zorunludur.`);
          if (row.quota_total.trim() && (!Number.isInteger(total) || total < 0)) issues.push(`${index + 1}. menü kota adedi geçerli olmalıdır.`);
        }
      });
    }

    return issues;
  }, [form, isHalkTasarrufFlow, media.cover_file, media.logo_file, validMenuRows, validStaffRows, validSurpriseDealRows]);

  const createMutation = useMutation({
    mutationFn: async (): Promise<CreateResult> => {
      const response = await createOpsBusiness({
        business_name: form.business_name.trim(),
        category: form.category.trim(),
        supports_halkyemek: form.supports_halkyemek,
        supports_halktasarruf: form.supports_halktasarruf,
        adress: form.address_line.trim(),
        address_line: cleanOptionalText(form.address_line) ?? null,
        google_maps_url: cleanOptionalText(form.google_maps_url) ?? null,
        latitude: normalizeCoordinatePayload(form.latitude),
        longitude: normalizeCoordinatePayload(form.longitude),
        kyc_contact_name: cleanOptionalText(form.kyc_contact_name) ?? "",
        kyc_contact_surname: cleanOptionalText(form.kyc_contact_surname) ?? "",
        kyc_identity_number: cleanOptionalText(form.kyc_identity_number) ?? "",
        kyc_tax_number: cleanOptionalText(form.kyc_tax_number) ?? "",
        kyc_iban: cleanOptionalText(form.kyc_iban) ?? "",
        short_description: cleanOptionalText(form.short_description) ?? "",
        district: "BEYLIKDUZU",
        listing_type: form.listing_type,
        is_active: true,
        is_approved: form.publish_now,
        is_listed: form.publish_now,
        marketplace_is_visible: form.publish_now,
      });

      const business = response.data;
      const warnings: string[] = [];
      let staffCount = 0;
      let savedMediaCount = 0;
      let contentCount = 0;

      for (const row of validStaffRows) {
        try {
          const identifier = row.user_id.trim();
          await upsertOpsBusinessMembership(
            business.id,
            identifier.includes("@")
              ? { email: identifier, role: row.role, is_active: true, access_halkyemek: form.supports_halkyemek, access_halktasarruf: form.supports_halktasarruf }
              : { user_id: Number(identifier), role: row.role, is_active: true, access_halkyemek: form.supports_halkyemek, access_halktasarruf: form.supports_halktasarruf },
          );
          staffCount += 1;
        } catch (error) {
          warnings.push(`Yetkili ${row.user_id} bağlanamadı: ${getApiErrorMessage(error)}`);
        }
      }

      const coverUrl = media.cover_url.trim();
      const logoUrl = media.logo_url.trim();
      for (const item of [
        { file: media.cover_file, url: coverUrl, role: "COVER", label: "Kapak görseli" },
        { file: media.logo_file, url: logoUrl, role: "LOGO", label: "Logo görseli" },
      ]) {
        if (!item.file && !item.url) continue;
        try {
          if (item.file) {
            const formData = new FormData();
            formData.set("file", item.file);
            formData.set("media_type", "IMAGE");
            formData.set("asset_role", item.role);
            formData.set("alt_text", `${business.business_name} ${item.label}`);
            formData.set("is_active", "true");
            await uploadBusinessMediaAsset(business.id, formData);
          } else {
            await createBusinessMediaAsset(business.id, {
              file_url: item.url,
              media_type: "IMAGE",
              asset_role: item.role,
              alt_text: `${business.business_name} ${item.label}`,
              is_active: true,
            });
          }
          savedMediaCount += 1;
        } catch (error) {
          warnings.push(`${item.label} kaydedilemedi: ${getApiErrorMessage(error)}`);
        }
      }

      if (isHalkTasarrufFlow) {
        for (const row of validSurpriseDealRows) {
          try {
            const pickupWindowEnd = toIsoDateTime(row.pickup_end);
            if (!pickupWindowEnd) {
              throw new Error("Teslim bitiş tarihi geçerli olmalıdır.");
            }

            let uploadedImageUrl = cleanOptionalText(row.image_url);
            if (row.image_file) {
              const formData = new FormData();
              formData.set("file", row.image_file);
              formData.set("media_type", "IMAGE");
              formData.set("asset_role", "THUMBNAIL");
              formData.set("alt_text", row.title.trim() || `${business.business_name} sürpriz paket görseli`);
              formData.set("is_active", "true");
              const uploadedAsset = await uploadBusinessMediaAsset(business.id, formData);
              uploadedImageUrl = uploadedAsset.file_url || uploadedAsset.url || uploadedImageUrl;
              savedMediaCount += 1;
            }

            await createBusinessSurpriseDeal(business.id, {
              title: row.title.trim(),
              description: row.description.trim(),
              original_value_amount: parsePriceToAmount(row.original_value),
              sale_price_amount: parsePriceToAmount(row.sale_price),
              quantity_total: Number(row.quantity_total.trim()),
              grams: row.grams.trim() ? Number(row.grams.trim()) : null,
              pickup_window_start: new Date().toISOString(),
              pickup_window_end: pickupWindowEnd,
              min_contents_note: row.min_contents_note.trim(),
              allergens_note: cleanOptionalText(row.allergens_note) ?? null,
              image_url: uploadedImageUrl,
              status: form.publish_now ? "ACTIVE" : "DRAFT",
            });
            contentCount += 1;
          } catch (error) {
            warnings.push(`${row.title.trim() || "Sürpriz paket"} kaydedilemedi: ${getApiErrorMessage(error)}`);
          }
        }
      } else {
        let categories: BusinessCategoryItem[] = [];
        if (validMenuRows.length) {
          try {
            categories = await listBusinessCategories(business.id);
          } catch (error) {
            warnings.push(`Kategori listesi alınamadı: ${getApiErrorMessage(error)}`);
          }
        }

        for (const row of validMenuRows) {
          try {
            const categoryId = findCategoryId(categories, row.category);
            if (!categoryId) {
              throw new Error("Menü kategorisi bulunamadı.");
            }
            let quotaTotal: number | null = null;
            let quotaRemaining: number | null = null;
            let lowStockThreshold = 12;
            if (row.quota_enabled) {
              quotaTotal = parseOptionalNonNegativeInteger(row.quota_total, "Kota adedi");
              if (quotaTotal === null) {
                throw new Error("Kota aktifken kota adedi zorunludur.");
              }
              quotaRemaining = quotaTotal;
            }
            const menuItem = await createBusinessMenuItem(business.id, {
              name: row.name.trim(),
              slug: slugify(row.name),
              description: row.description.trim(),
              minimum_grams: row.minimum_grams.trim() ? Number(row.minimum_grams.trim()) : null,
              price_amount: parsePriceToAmount(row.price),
              quota_enabled: row.quota_enabled,
              quota_total: quotaTotal,
              quota_remaining: quotaRemaining,
              low_stock_threshold: lowStockThreshold,
              marketplace_category_ids: [categoryId],
              is_active: true,
              is_visible: true,
              is_available: true,
            });
            contentCount += 1;

            const imageUrl = row.image_url.trim();
            if (row.image_file || imageUrl) {
              try {
                if (row.image_file) {
                  const formData = new FormData();
                  formData.set("menu_item", String(menuItem.id));
                  formData.set("file", row.image_file);
                  formData.set("media_type", "IMAGE");
                  formData.set("asset_role", "THUMBNAIL");
                  formData.set("alt_text", row.name.trim());
                  formData.set("is_active", "true");
                  await uploadBusinessMediaAsset(business.id, formData);
                } else {
                  await createBusinessMediaAsset(business.id, {
                    menu_item: menuItem.id,
                    file_url: imageUrl,
                    media_type: "IMAGE",
                    asset_role: "THUMBNAIL",
                    alt_text: row.name.trim(),
                    is_active: true,
                  });
                }
                savedMediaCount += 1;
              } catch (error) {
                warnings.push(`${row.name.trim()} görseli kaydedilemedi: ${getApiErrorMessage(error)}`);
              }
            }
          } catch (error) {
            warnings.push(`${row.name.trim() || "Menü"} kaydedilemedi: ${getApiErrorMessage(error)}`);
          }
        }
      }

      return { business, staffCount, contentCount, mediaCount: savedMediaCount, warnings };
    },
    onSuccess: async (result) => {
      setCreatedBusiness(result.business);
      setCreateResult(result);
      toast.success("İşletme oluşturuldu.");
      await invalidateOpsQueries(queryClient, [["ops", "businesses"], ["ops", "business", result.business.id]]);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "İşletme oluşturulamadı."));
    },
  });

  const isSubmitDisabled = createMutation.isPending || formIssues.length > 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitDisabled) return;
    setCreatedBusiness(null);
    setCreateResult(null);
    createMutation.mutate();
  }

  function updateStaffRow(index: number, patch: Partial<StaffRow>) {
    setStaffRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function updateMenuRow(index: number, patch: Partial<MenuRow>) {
    setMenuRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function updateSurpriseDealRow(index: number, patch: Partial<SurpriseDealRow>) {
    setSurpriseDealRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  return (
    <ProtectedPageShell requireAdmin>
      <main className="bg-white py-6 sm:py-8">
        <Container size="wide">
          <form onSubmit={handleSubmit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-3xl">
                <p className={`text-xs font-semibold uppercase tracking-[0.18em] ${currentProduct === "halktasarruf" ? "text-violet-700" : "text-[#f50555]"}`}>
                  Yeni işletme kurulumu
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.055em] text-zinc-950">
                  {currentProduct === "halktasarruf" ? "HalkTasarruf işletmesi aç" : "HalkYemek işletmesi aç"}
                </h1>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  İşletmeyi, yetkilileri ve ilk içerikleri tek akışta hazırlıyoruz. İstersen aynı işletmeyi iki üründe birden aktif edip
                  tek merkezden yönetebilirsin.
                </p>
              </div>
              <div className={`rounded-[28px] border px-4 py-3 text-sm font-medium shadow-sm ${productMeta.accentClassName}`}>
                {productMeta.intro}
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              <label className={`rounded-[28px] border p-4 transition ${form.supports_halkyemek ? "border-rose-200 bg-rose-50/80" : "border-zinc-200 bg-zinc-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">HalkYemek erişimi</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Klasik menü, QR ve kasada okut akışını bu işletmede aktif eder.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.supports_halkyemek}
                    onChange={(event) => setForm((current) => ({ ...current, supports_halkyemek: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                  />
                </div>
              </label>

              <label className={`rounded-[28px] border p-4 transition ${form.supports_halktasarruf ? "border-violet-200 bg-violet-50/80" : "border-zinc-200 bg-zinc-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">HalkTasarruf erişimi</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">Sürpriz paket, fırsat teslimi ve saat bazlı tasarruf akışını açar.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={form.supports_halktasarruf}
                    onChange={(event) => setForm((current) => ({ ...current, supports_halktasarruf: event.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-violet-700"
                  />
                </div>
              </label>
            </div>
          </section>

          <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex items-center gap-3">
              <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-[0_16px_35px_rgba(15,23,42,0.18)] ${productMeta.iconClassName}`}>
                <Store className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-2xl font-semibold tracking-[-0.045em] text-zinc-950">İşletme bilgileri</h2>
                <p className="mt-1 text-sm text-zinc-500">Ad, kategori, konum, ürün kapsamı ve yayın durumu.</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <FieldLabel>İşletme adı</FieldLabel>
                  <input
                    value={form.business_name}
                    onChange={(event) => setForm((current) => ({ ...current, business_name: event.target.value }))}
                    placeholder="Örn. Beylikdüzü Lokantası"
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-2">
                  <FieldLabel>Kategori</FieldLabel>
                  <select
                    value={form.category}
                    onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                    className={fieldClassName()}
                  >
                    {activeCategoryOptions.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="space-y-2">
                <FieldLabel>Kısa açıklama</FieldLabel>
                <textarea
                  value={form.short_description}
                  onChange={(event) => setForm((current) => ({ ...current, short_description: event.target.value }))}
                  placeholder="Müşterinin kartta göreceği kısa tanıtım."
                  className={`${fieldClassName()} min-h-20 resize-none`}
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <FieldLabel>Adres</FieldLabel>
                  <input
                    value={form.address_line}
                    onChange={(event) => setForm((current) => ({ ...current, address_line: event.target.value }))}
                    placeholder="Örn. Beylikdüzü, İstanbul"
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-2">
                  <FieldLabel>Google Maps URL</FieldLabel>
                  <input
                    value={form.google_maps_url}
                    onChange={(event) => setForm((current) => ({ ...current, google_maps_url: event.target.value }))}
                    placeholder="https://maps.google.com/..."
                    className={fieldClassName()}
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-4">
                <label className="space-y-2">
                  <FieldLabel>Enlem</FieldLabel>
                  <input
                    value={form.latitude}
                    onChange={(event) => setForm((current) => ({ ...current, latitude: event.target.value }))}
                    placeholder="41.001000"
                    inputMode="decimal"
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-2">
                  <FieldLabel>Boylam</FieldLabel>
                  <input
                    value={form.longitude}
                    onChange={(event) => setForm((current) => ({ ...current, longitude: event.target.value }))}
                    placeholder="28.641000"
                    inputMode="decimal"
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-2">
                  <FieldLabel>İşletme tipi</FieldLabel>
                  <select
                    value={form.listing_type}
                    onChange={(event) => setForm((current) => ({ ...current, listing_type: event.target.value }))}
                    className={fieldClassName()}
                  >
                    {LISTING_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center justify-between gap-4 self-end rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm">
                  <span className="font-semibold text-zinc-800">Yayında</span>
                  <input
                    type="checkbox"
                    checked={form.publish_now}
                    onChange={(event) => setForm((current) => ({ ...current, publish_now: event.target.checked }))}
                    className="h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-950">Ödeme ve kimlik bilgileri</h2>
                <p className="mt-1 text-sm text-zinc-500">IBAN, hesap sahibi ve kimlik/vergi bilgileri.</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="space-y-2">
                <FieldLabel>IBAN numarası</FieldLabel>
                <input
                  value={form.kyc_iban}
                  onChange={(event) => setForm((current) => ({ ...current, kyc_iban: event.target.value }))}
                  placeholder="TR00 0000 0000 0000 0000 0000 00"
                  className={fieldClassName()}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <FieldLabel>IBAN hesap sahibi adı</FieldLabel>
                  <input
                    value={form.kyc_contact_name}
                    onChange={(event) => setForm((current) => ({ ...current, kyc_contact_name: event.target.value }))}
                    placeholder="Ad"
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-2">
                  <FieldLabel>IBAN hesap sahibi soyadı</FieldLabel>
                  <input
                    value={form.kyc_contact_surname}
                    onChange={(event) => setForm((current) => ({ ...current, kyc_contact_surname: event.target.value }))}
                    placeholder="Soyad"
                    className={fieldClassName()}
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <FieldLabel>T.C. kimlik no</FieldLabel>
                  <input
                    value={form.kyc_identity_number}
                    onChange={(event) => setForm((current) => ({ ...current, kyc_identity_number: event.target.value }))}
                    placeholder="11 haneli kimlik numarası"
                    inputMode="numeric"
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-2">
                  <FieldLabel>Vergi no</FieldLabel>
                  <input
                    value={form.kyc_tax_number}
                    onChange={(event) => setForm((current) => ({ ...current, kyc_tax_number: event.target.value }))}
                    placeholder="Varsa vergi numarası"
                    inputMode="numeric"
                    className={fieldClassName()}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-zinc-950 text-white">
                  <UserRound className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-950">Yetkili kullanıcılar</h2>
                  <p className="mt-1 text-sm text-zinc-500">{validStaffRows.length || 0} yetkili hazırlanıyor.</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStaffRows((rows) => [...rows, { ...INITIAL_STAFF_ROW, role: "MANAGER" }])}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              >
                <Plus className="h-4 w-4" />
                Yetkili ekle
              </button>
            </div>

            <div className="mt-5 grid gap-3">
              {staffRows.map((row, index) => (
                <div key={index} className="grid gap-3 rounded-[24px] border border-zinc-100 bg-zinc-50 p-3 md:grid-cols-[1fr_220px_auto]">
                  <input
                    value={row.user_id}
                    onChange={(event) => updateStaffRow(index, { user_id: event.target.value })}
                    placeholder="Kullanıcı ID veya e-posta"
                    className={fieldClassName()}
                  />
                  <select value={row.role} onChange={(event) => updateStaffRow(index, { role: event.target.value })} className={fieldClassName()}>
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setStaffRows((rows) => (rows.length === 1 ? [{ ...INITIAL_STAFF_ROW }] : rows.filter((_, rowIndex) => rowIndex !== index)))}
                    className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-zinc-600 transition hover:bg-zinc-100"
                    aria-label="Yetkili satırını kaldır"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-[#f50555]">
                <ImagePlus className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-950">Kapak ve logo</h2>
                <p className="mt-1 text-sm text-zinc-500">{mediaCount} görsel hazırlanıyor.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <MediaFilePicker
                  label="Kapak görseli"
                  helper="Ana sayfa ve işletme kartlarında kullanılacak geniş görsel."
                  file={media.cover_file}
                  onFileChange={(file) => setMedia((current) => ({ ...current, cover_file: file }))}
                  onClear={() => setMedia((current) => ({ ...current, cover_file: null }))}
                />
                <label className="space-y-2 block">
                  <FieldLabel>Kapak URL alternatifi</FieldLabel>
                  <input
                    value={media.cover_url}
                    onChange={(event) => setMedia((current) => ({ ...current, cover_url: event.target.value }))}
                    placeholder="https://.../kapak.jpg"
                    className={fieldClassName()}
                  />
                </label>
              </div>
              <div className="space-y-3">
                <MediaFilePicker
                  label="Logo"
                  helper="Küçük kartlarda ve işletme kimliğinde görünecek logo."
                  file={media.logo_file}
                  onFileChange={(file) => setMedia((current) => ({ ...current, logo_file: file }))}
                  onClear={() => setMedia((current) => ({ ...current, logo_file: null }))}
                />
                <label className="space-y-2 block">
                  <FieldLabel>Logo URL alternatifi</FieldLabel>
                  <input
                    value={media.logo_url}
                    onChange={(event) => setMedia((current) => ({ ...current, logo_url: event.target.value }))}
                    placeholder="https://.../logo.png"
                    className={fieldClassName()}
                  />
                </label>
              </div>
            </div>
          </section>

          <section className="rounded-[34px] border border-zinc-100 bg-white p-5 shadow-[0_22px_70px_rgba(15,23,42,0.06)] sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${
                    isHalkTasarrufFlow ? "bg-violet-50 text-violet-700" : "bg-rose-50 text-[#f50555]"
                  }`}
                >
                  <UtensilsCrossed className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-950">İlk içerikler</h2>
                  <p className="mt-1 text-sm text-zinc-500">
                    {contentCount} kayıt hazırlanıyor. {isHalkTasarrufFlow ? "İlk sürpriz paketleri bu ekrandan girip doğrudan HalkTasarruf akışına hazırlayabilirsin." : "HalkYemek menülerini ve kota bilgisini tek akışta hazırlayabilirsin."}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isHalkTasarrufFlow) {
                    setSurpriseDealRows((rows) => [...rows, createInitialSurpriseDealRow()]);
                    return;
                  }
                  setMenuRows((rows) => [
                    ...rows,
                    { ...INITIAL_MENU_ROW, category: activeCategoryOptions[0] ?? INITIAL_MENU_ROW.category },
                  ]);
                }}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50"
              >
                <Plus className="h-4 w-4" />
                {isHalkTasarrufFlow ? "Paket ekle" : "Menü ekle"}
              </button>
            </div>

            {isHalkTasarrufFlow ? (
              <div className="mt-5 grid gap-4">
                {surpriseDealRows.map((row, index) => (
                  <div key={index} className="rounded-[28px] border border-violet-100 bg-violet-50/45 p-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px_150px_auto]">
                      <input
                        value={row.title}
                        onChange={(event) => updateSurpriseDealRow(index, { title: event.target.value })}
                        placeholder="Sürpriz paket başlığı"
                        className={fieldClassName()}
                      />
                      <input
                        value={row.original_value}
                        onChange={(event) => updateSurpriseDealRow(index, { original_value: event.target.value })}
                        placeholder="Tahmini değer"
                        inputMode="decimal"
                        className={fieldClassName()}
                      />
                      <input
                        value={row.sale_price}
                        onChange={(event) => updateSurpriseDealRow(index, { sale_price: event.target.value })}
                        placeholder="Satış fiyatı"
                        inputMode="decimal"
                        className={fieldClassName()}
                      />
                      <input
                        value={row.grams}
                        onChange={(event) => updateSurpriseDealRow(index, { grams: event.target.value })}
                        placeholder="Gram"
                        inputMode="numeric"
                        className={fieldClassName()}
                      />
                      <button
                        type="button"
                        onClick={() => setSurpriseDealRows((rows) => (rows.length === 1 ? [createInitialSurpriseDealRow()] : rows.filter((_, rowIndex) => rowIndex !== index)))}
                        className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-zinc-600 transition hover:bg-zinc-100"
                        aria-label="Paket satırını kaldır"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
                      <label className="space-y-2 rounded-[24px] border border-violet-100 bg-white p-4">
                        <span className="block text-sm font-semibold text-zinc-900">Kota / toplam adet</span>
                        <input
                          value={row.quantity_total}
                          onChange={(event) => updateSurpriseDealRow(index, { quantity_total: event.target.value })}
                          placeholder="Kota adedi"
                          inputMode="numeric"
                          className={fieldClassName()}
                        />
                        <span className="block text-xs leading-5 text-zinc-500">
                          Bu sayı müşteriye açılacak toplam fırsat adedidir. Her başarılı siparişte otomatik düşer.
                        </span>
                      </label>
                      <div className="rounded-[24px] border border-violet-100 bg-white p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">Teslim penceresi</p>
                            <p className="mt-1 text-xs leading-5 text-zinc-500">
                              Başlangıç kaydı oluşturduğun anda otomatik başlar. Sadece bitiş tarihini belirle.
                            </p>
                          </div>
                          <span className="rounded-full bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700">
                            Otomatik başlangıç
                          </span>
                        </div>
                        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_200px]">
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Teslim günü</span>
                            <input
                              type="date"
                              value={getPickupDatePart(row.pickup_end)}
                              onChange={(event) => updateSurpriseDealRow(index, { pickup_end: setPickupDatePart(row.pickup_end, event.target.value) })}
                              className={fieldClassName()}
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Son saat</span>
                            <input
                              type="time"
                              step={900}
                              value={getPickupTimePart(row.pickup_end)}
                              onChange={(event) => updateSurpriseDealRow(index, { pickup_end: setPickupTimePart(row.pickup_end, event.target.value) })}
                              className={fieldClassName()}
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => updateSurpriseDealRow(index, { pickup_end: setPickupDatePart(row.pickup_end, getPickupDatePart(createDefaultPickupEndValue())) })}
                            className="rounded-full border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                          >
                            Bugün
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSurpriseDealRow(index, { pickup_end: shiftPickupDate(row.pickup_end, 1) })}
                            className="rounded-full border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                          >
                            Yarın
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSurpriseDealRow(index, { pickup_end: createDefaultPickupEndValue() })}
                            className="rounded-full border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                          >
                            Cihaz saatine göre yenile
                          </button>
                        </div>
                        <div className="mt-3 rounded-2xl border border-zinc-100 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                          <span className="font-semibold text-zinc-900">Teslim özeti:</span> {formatPickupPreview(row.pickup_end)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <textarea
                        value={row.description}
                        onChange={(event) => updateSurpriseDealRow(index, { description: event.target.value })}
                        placeholder="Paket açıklaması"
                        className={`${fieldClassName()} min-h-28 resize-none`}
                      />
                      <div className="grid gap-3">
                        <div className="rounded-[24px] border border-dashed border-violet-200 bg-white p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <p className="text-sm font-semibold text-zinc-900">Paket görseli</p>
                              <p className="mt-1 text-xs leading-5 text-zinc-500">Cihazından fırsat kartında görünecek görseli seç.</p>
                            </div>
                            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#5B21B6,#7C3AED)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(109,40,217,0.22)] transition hover:brightness-110">
                              Görsel seç
                              <input
                                type="file"
                                accept={IMAGE_FILE_TYPES.join(",")}
                                className="sr-only"
                                onChange={(event) => updateSurpriseDealRow(index, { image_file: event.target.files?.[0] ?? null })}
                              />
                            </label>
                          </div>
                          {row.image_file ? (
                            <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm text-zinc-700 sm:flex-row sm:items-center sm:justify-between">
                              <span className="truncate font-medium">{row.image_file.name}</span>
                              <span className="flex items-center gap-3 text-xs text-zinc-500">
                                {formatFileSize(row.image_file.size)}
                                <button
                                  type="button"
                                  onClick={() => updateSurpriseDealRow(index, { image_file: null })}
                                  className="font-semibold text-violet-700 hover:text-violet-800"
                                >
                                  Kaldır
                                </button>
                              </span>
                            </div>
                          ) : null}
                          <input
                            value={row.image_url}
                            onChange={(event) => updateSurpriseDealRow(index, { image_url: event.target.value })}
                            placeholder="İstersen URL alternatifi: https://.../paket.jpg"
                            className={`${fieldClassName()} mt-3`}
                          />
                        </div>
                        <input
                          value={row.min_contents_note}
                          onChange={(event) => updateSurpriseDealRow(index, { min_contents_note: event.target.value })}
                          placeholder="Minimum içerik notu"
                          className={fieldClassName()}
                        />
                        <input
                          value={row.allergens_note}
                          onChange={(event) => updateSurpriseDealRow(index, { allergens_note: event.target.value })}
                          placeholder="Alerjen notu"
                          className={fieldClassName()}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 grid gap-4">
                {menuRows.map((row, index) => (
                  <div key={index} className="rounded-[28px] border border-zinc-100 bg-zinc-50 p-4">
                    <div className="grid gap-3 lg:grid-cols-[1fr_130px_130px_180px_auto]">
                      <input
                        value={row.name}
                        onChange={(event) => updateMenuRow(index, { name: event.target.value })}
                        placeholder="Menü adı"
                        className={fieldClassName()}
                      />
                      <input
                        value={row.price}
                        onChange={(event) => updateMenuRow(index, { price: event.target.value })}
                        placeholder="Fiyat"
                        inputMode="decimal"
                        className={fieldClassName()}
                      />
                      <input
                        value={row.minimum_grams}
                        onChange={(event) => updateMenuRow(index, { minimum_grams: event.target.value })}
                        placeholder="Min. gr"
                        inputMode="numeric"
                        className={fieldClassName()}
                      />
                      <select value={row.category} onChange={(event) => updateMenuRow(index, { category: event.target.value })} className={fieldClassName()}>
                        {activeCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setMenuRows((rows) => (rows.length === 1 ? [{ ...INITIAL_MENU_ROW }] : rows.filter((_, rowIndex) => rowIndex !== index)))}
                        className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-zinc-600 transition hover:bg-zinc-100"
                        aria-label="Menü satırını kaldır"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="rounded-[24px] border border-dashed border-rose-200 bg-white p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-zinc-900">Menü görseli</p>
                          <p className="mt-1 text-xs leading-5 text-zinc-500">Ürün fotoğrafını hızlıca ekle.</p>
                          </div>
                          <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-[#f50555] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(245,5,85,0.22)] transition hover:bg-[#dc004c]">
                          Görsel seç
                            <input
                              type="file"
                              accept={IMAGE_FILE_TYPES.join(",")}
                              className="sr-only"
                              onChange={(event) => updateMenuRow(index, { image_file: event.target.files?.[0] ?? null })}
                            />
                          </label>
                        </div>
                        {row.image_file ? (
                          <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm text-zinc-700 sm:flex-row sm:items-center sm:justify-between">
                            <span className="truncate font-medium">{row.image_file.name}</span>
                            <span className="flex items-center gap-3 text-xs text-zinc-500">
                              {formatFileSize(row.image_file.size)}
                              <button type="button" onClick={() => updateMenuRow(index, { image_file: null })} className="font-semibold text-[#f50555] hover:text-[#dc004c]">
                                Kaldır
                              </button>
                            </span>
                          </div>
                        ) : null}
                        <input
                          value={row.image_url}
                          onChange={(event) => updateMenuRow(index, { image_url: event.target.value })}
                          placeholder="URL alternatifi: https://.../menu.png"
                          className={`${fieldClassName()} mt-3`}
                        />
                      </div>
                      <input
                        value={row.description}
                        onChange={(event) => updateMenuRow(index, { description: event.target.value })}
                        placeholder="Kısa açıklama"
                        className={fieldClassName()}
                      />
                    </div>
                    <div className="mt-3 rounded-[24px] border border-rose-100 bg-white p-4">
                      <label className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                          <span className="block text-sm font-semibold text-zinc-900">Menü kotası</span>
                          <span className="mt-1 block text-xs leading-5 text-zinc-500">
                            Kota biterse ürün müşteri tarafında tükendi görünür ve sepete eklenemez.
                          </span>
                        </span>
                        <span className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-semibold text-zinc-700">
                          <input
                            type="checkbox"
                            checked={row.quota_enabled}
                            onChange={(event) => updateMenuRow(index, { quota_enabled: event.target.checked })}
                            className="h-4 w-4 rounded border-zinc-300 text-[#f50555]"
                          />
                          {row.quota_enabled ? "Kotalı" : "Sınırsız"}
                        </span>
                      </label>
                      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,280px)_1fr] md:items-end">
                        <input
                          value={row.quota_total}
                          onChange={(event) => updateMenuRow(index, { quota_total: event.target.value })}
                          placeholder="Kota adedi"
                          inputMode="numeric"
                          disabled={!row.quota_enabled}
                          className={fieldClassName()}
                        />
                        <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-xs font-medium leading-5 text-zinc-500">
                          Girilen adet başlangıç kotasıdır. Sipariş ödemesi tamamlandıkça kalan kota otomatik düşer.
                        </p>
                      </div>
                      <p className="mt-3 text-xs font-medium text-zinc-500">
                        {!row.quota_enabled
                          ? "Bu menü sınırsız satılır."
                          : row.quota_total.trim() === "0"
                            ? "Bu menü tükendi olarak görünür."
                            : row.quota_total.trim()
                              ? `${row.quota_total.trim()} adet kota tanımlanır.`
                              : "Kota müşteri kartında otomatik takip edilir."}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <section className="rounded-[34px] border border-zinc-100 bg-zinc-950 p-5 text-white shadow-[0_22px_70px_rgba(15,23,42,0.16)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">Kurulum özeti</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.045em]">Tek ekranda tamamla</h2>
            <div className="mt-4 rounded-2xl bg-white/8 px-4 py-3 text-sm text-white/80">
              <p className="font-semibold text-white">Aktif ürün alanı</p>
              <p className="mt-1">{selectedProductsLabel || "Henüz seçilmedi"}</p>
            </div>
            <div className="mt-5 grid gap-2 text-sm">
              <div className="flex justify-between rounded-2xl bg-white/8 px-3 py-2.5">
                <span className="text-white/65">Yetkili</span>
                <strong>{validStaffRows.length}</strong>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/8 px-3 py-2.5">
                <span className="text-white/65">Görsel</span>
                <strong>{mediaCount}</strong>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/8 px-3 py-2.5">
                <span className="text-white/65">İçerik</span>
                <strong>{contentCount}</strong>
              </div>
            </div>

            {formIssues.length > 0 ? (
              <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
                {formIssues.map((issue) => (
                  <p key={issue}>{issue}</p>
                ))}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitDisabled}
              className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-white/12 disabled:text-white/45 disabled:shadow-none ${productMeta.buttonClassName}`}
            >
              {createMutation.isPending ? "Kurulum kaydediliyor..." : "İşletmeyi oluştur"}
              <ArrowRight className="h-4 w-4" />
            </button>
          </section>

          {createMutation.isError ? (
            <EmptyState title="İşletme oluşturulamadı" description={getApiErrorMessage(createMutation.error)} />
          ) : null}

          {createdBusiness && createResult ? (
            <section className="rounded-[34px] border border-emerald-100 bg-emerald-50 p-5 shadow-[0_22px_70px_rgba(15,23,42,0.05)]">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-emerald-600">
                  <CheckCircle2 className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-semibold tracking-[-0.035em] text-zinc-950">{createdBusiness.business_name}</h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {createResult.staffCount} yetkili, {createResult.contentCount} içerik, {createResult.mediaCount} görsel kaydedildi.
                  </p>
                </div>
              </div>
              {createResult.warnings.length ? (
                <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
                  {createResult.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}
              <div className="mt-5 grid gap-2">
                <Link
                  href={isHalkTasarrufFlow ? `/ops/isletmeler/${createdBusiness.id}/surpriz-paketler` : `/ops/isletmeler/${createdBusiness.id}/icerik`}
                  className={`rounded-2xl px-4 py-3 text-center text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5 ${
                    isHalkTasarrufFlow ? "bg-[linear-gradient(135deg,#5B21B6,#7C3AED)]" : "bg-[#f50555]"
                  }`}
                >
                  {isHalkTasarrufFlow ? "Paketleri düzenle" : "Menüleri düzenle"}
                </Link>
                <Link href={`/ops/isletmeler/${createdBusiness.id}`} className="rounded-2xl bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-900 shadow-sm transition hover:-translate-y-0.5">
                  Detay sayfası
                </Link>
              </div>
            </section>
          ) : null}
        </aside>
          </form>
        </Container>
      </main>
    </ProtectedPageShell>
  );
}


