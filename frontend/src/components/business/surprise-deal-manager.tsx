"use client";

import { FormEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarClock,
  PackageOpen,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Save,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { AmountText } from "@/components/ui/amount-text";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PendingButton } from "@/components/ui/pending-button";
import { StatusChip } from "@/components/ui/status-chip";
import {
  closeBusinessSurpriseDeal,
  createBusinessSurpriseDeal,
  deleteBusinessSurpriseDeal,
  listBusinessSurpriseDeals,
  updateBusinessSurpriseDeal,
} from "@/features/surprise-deals/api";
import { uploadBusinessMediaAsset } from "@/features/business-operations/api";
import { surpriseDealQueryKeys } from "@/features/surprise-deals/query-keys";
import type { CreateSurpriseDealPayload, SurpriseDealBusiness, SurpriseDealStatus } from "@/features/surprise-deals/types";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

type SurpriseDealManagerVariant = "business" | "ops";

type FormState = {
  title: string;
  description: string;
  originalValue: string;
  salePrice: string;
  quantityTotal: string;
  grams: string;
  pickupEnd: string;
  minContentsNote: string;
  allergensNote: string;
  imageUrl: string;
  imageFile: File | null;
  status: "DRAFT" | "ACTIVE";
};

const INITIAL_FORM: FormState = {
  title: "",
  description: "",
  originalValue: "",
  salePrice: "",
  quantityTotal: "1",
  grams: "",
  pickupEnd: "",
  minContentsNote: "",
  allergensNote: "",
  imageUrl: "",
  imageFile: null,
  status: "DRAFT",
};

const IMAGE_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
const MAX_MEDIA_FILE_BYTES = 8 * 1024 * 1024;

const STATUS_ACTIONS: Array<{ value: Extract<SurpriseDealStatus, "ACTIVE" | "PAUSED" | "CLOSED">; label: string }> = [
  { value: "ACTIVE", label: "Yayına al" },
  { value: "PAUSED", label: "Duraklat" },
  { value: "CLOSED", label: "Kapat" },
];

function parseAmountToMinorUnit(value: string) {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function parsePositiveInteger(value: string) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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

function createInitialFormState(): FormState {
  return {
    ...INITIAL_FORM,
    pickupEnd: createDefaultPickupEndValue(),
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

function getStatusLabel(status: SurpriseDealStatus) {
  switch (status) {
    case "DRAFT":
      return "Taslak";
    case "ACTIVE":
      return "Aktif";
    case "PAUSED":
      return "Duraklatıldı";
    case "CLOSED":
      return "Kapalı";
    case "EXPIRED":
      return "Süresi doldu";
    case "CANCELLED":
      return "İptal edildi";
    default:
      return status;
  }
}

function getStatusTone(status: SurpriseDealStatus) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "PAUSED" || status === "DRAFT") return "warning" as const;
  return "default" as const;
}

function buildCreatePayload(form: FormState): CreateSurpriseDealPayload {
  const originalValue = parseAmountToMinorUnit(form.originalValue);
  const salePrice = parseAmountToMinorUnit(form.salePrice);
  const quantityTotal = parsePositiveInteger(form.quantityTotal);
  const grams = form.grams.trim() ? parsePositiveInteger(form.grams) : null;
  const pickupWindowEnd = toIsoDateTime(form.pickupEnd);
  const pickupWindowStart = new Date().toISOString();

  if (!form.title.trim()) throw new Error("Paket başlığı zorunlu.");
  if (originalValue === null) throw new Error("Tahmini değer geçerli bir tutar olmalı.");
  if (salePrice === null) throw new Error("Satış tutarı geçerli bir tutar olmalı.");
  if (salePrice > originalValue) throw new Error("Satış tutarı tahmini değerden yüksek olamaz.");
  if (quantityTotal === null) throw new Error("Toplam adet 1 veya daha büyük olmalı.");
  if (!pickupWindowEnd) throw new Error("Teslim bitiş tarihi ve saati zorunlu.");
  if (new Date(pickupWindowEnd).getTime() <= new Date(pickupWindowStart).getTime()) {
    throw new Error("Teslim bitiş zamanı şu andan sonra olmalı.");
  }
  if (!form.minContentsNote.trim()) throw new Error("Minimum içerik notu zorunlu.");

  return {
    title: form.title.trim(),
    description: form.description.trim(),
    original_value_amount: originalValue,
    sale_price_amount: salePrice,
    quantity_total: quantityTotal,
    pickup_window_start: pickupWindowStart,
    pickup_window_end: pickupWindowEnd,
    min_contents_note: form.minContentsNote.trim(),
    grams,
    allergens_note: form.allergensNote.trim() || null,
    image_url: form.imageUrl.trim() || undefined,
    status: form.status,
  };
}

function buildUpdatePayload(form: FormState): Partial<CreateSurpriseDealPayload> {
  const originalValue = parseAmountToMinorUnit(form.originalValue);
  const salePrice = parseAmountToMinorUnit(form.salePrice);
  const quantityTotal = parsePositiveInteger(form.quantityTotal);
  const grams = form.grams.trim() ? parsePositiveInteger(form.grams) : null;
  const pickupWindowEnd = toIsoDateTime(form.pickupEnd);

  if (!form.title.trim()) throw new Error("Paket başlığı zorunlu.");
  if (originalValue === null) throw new Error("Tahmini değer geçerli bir tutar olmalı.");
  if (salePrice === null) throw new Error("Satış tutarı geçerli bir tutar olmalı.");
  if (salePrice > originalValue) throw new Error("Satış tutarı tahmini değerden yüksek olamaz.");
  if (quantityTotal === null) throw new Error("Toplam adet 1 veya daha büyük olmalı.");
  if (!pickupWindowEnd) throw new Error("Teslim bitiş tarihi ve saati zorunlu.");
  if (!form.minContentsNote.trim()) throw new Error("Minimum içerik notu zorunlu.");

  return {
    title: form.title.trim(),
    description: form.description.trim(),
    original_value_amount: originalValue,
    sale_price_amount: salePrice,
    quantity_total: quantityTotal,
    pickup_window_end: pickupWindowEnd,
    min_contents_note: form.minContentsNote.trim(),
    grams,
    allergens_note: form.allergensNote.trim() || null,
    image_url: form.imageUrl.trim() || undefined,
    status: form.status,
  };
}

function toFormState(deal: SurpriseDealBusiness): FormState {
  return {
    title: deal.title,
    description: deal.description || "",
    originalValue: String(deal.original_value_amount / 100),
    salePrice: String(deal.sale_price_amount / 100),
    quantityTotal: String(deal.quantity_total),
    grams: deal.grams === null ? "" : String(deal.grams),
    pickupEnd: toDateTimeLocalValue(deal.pickup_window_end) || createDefaultPickupEndValue(),
    minContentsNote: deal.min_contents_note || "",
    allergensNote: deal.allergens_note || "",
    imageUrl: deal.image_url || "",
    imageFile: null,
    status: deal.status === "ACTIVE" ? "ACTIVE" : "DRAFT",
  };
}

function fieldClassName() {
  return "w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100";
}

function SectionShell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.06)] sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.04em] text-zinc-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-500">{description}</p>
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function isValidImageFile(file: File | null) {
  if (!file) return true;
  return IMAGE_FILE_TYPES.includes(file.type);
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SurpriseDealManager({
  businessId,
  variant,
}: {
  businessId: number;
  variant: SurpriseDealManagerVariant;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => createInitialFormState());
  const [editingDealId, setEditingDealId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const formSectionRef = useRef<HTMLDivElement | null>(null);
  const queryKey = surpriseDealQueryKeys.businessList(businessId);
  const isOps = variant === "ops";

  const dealsQuery = useQuery({
    queryKey,
    queryFn: () => listBusinessSurpriseDeals(businessId),
    enabled: Number.isFinite(businessId) && businessId > 0,
  });

  const deals = useMemo(() => dealsQuery.data?.results ?? [], [dealsQuery.data?.results]);

  const summary = useMemo(
    () => ({
      total: deals.length,
      active: deals.filter((deal) => deal.status === "ACTIVE").length,
      reserved: deals.reduce((sum, deal) => sum + deal.quantity_reserved, 0),
      remaining: deals.reduce((sum, deal) => sum + deal.quantity_remaining, 0),
    }),
    [deals],
  );

  const saveMutation = useMutation({
    mutationFn: async (payload: CreateSurpriseDealPayload | Partial<CreateSurpriseDealPayload>) => {
      let nextPayload = { ...payload } as CreateSurpriseDealPayload | Partial<CreateSurpriseDealPayload>;
      if (form.imageFile) {
        const formData = new FormData();
        formData.set("file", form.imageFile);
        formData.set("media_type", "IMAGE");
        formData.set("asset_role", "THUMBNAIL");
        formData.set("alt_text", form.title.trim() || "Sürpriz paket görseli");
        formData.set("is_active", "true");
        const uploadedAsset = await uploadBusinessMediaAsset(businessId, formData);
        nextPayload = {
          ...nextPayload,
          image_url: uploadedAsset.file_url || uploadedAsset.url || nextPayload.image_url,
        };
      }
      if (editingDealId !== null) {
        return updateBusinessSurpriseDeal(businessId, editingDealId, nextPayload);
      }
      return createBusinessSurpriseDeal(businessId, nextPayload as CreateSurpriseDealPayload);
    },
    onSuccess: async () => {
      const successMessage = editingDealId !== null ? "Sürpriz paket güncellendi." : "Sürpriz paket oluşturuldu.";
      setForm(createInitialFormState());
      setEditingDealId(null);
      await queryClient.invalidateQueries({ queryKey });
      toast.success(successMessage);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, editingDealId !== null ? "Sürpriz paket güncellenemedi." : "Sürpriz paket oluşturulamadı."));
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ dealId, status }: { dealId: number; status: Extract<SurpriseDealStatus, "ACTIVE" | "PAUSED" | "CLOSED"> }) =>
      updateBusinessSurpriseDeal(businessId, dealId, { status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Paket durumu güncellendi.");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Paket durumu güncellenemedi."));
    },
    onSettled: () => setPendingAction(null),
  });

  const closeMutation = useMutation({
    mutationFn: (dealId: number) => closeBusinessSurpriseDeal(businessId, dealId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Sürpriz paket güvenli şekilde kapatıldı.");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Paket kapatılamadı."));
    },
    onSettled: () => setPendingAction(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (dealId: number) => deleteBusinessSurpriseDeal(businessId, dealId),
    onSuccess: async () => {
      setForm(createInitialFormState());
      setEditingDealId(null);
      await queryClient.invalidateQueries({ queryKey });
      toast.success("Sürpriz paket silindi.");
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Sürpriz paket silinemedi."));
    },
    onSettled: () => setPendingAction(null),
  });

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetForm() {
    setEditingDealId(null);
    setForm(createInitialFormState());
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!isValidImageFile(form.imageFile)) {
        throw new Error("Paket görseli JPG, PNG, WEBP, GIF veya SVG olmalı.");
      }
      if (form.imageFile && form.imageFile.size > MAX_MEDIA_FILE_BYTES) {
        throw new Error("Paket görseli 8 MB sınırını aşamaz.");
      }
      const payload = editingDealId !== null ? buildUpdatePayload(form) : buildCreatePayload(form);
      saveMutation.mutate(payload);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Form bilgilerini kontrol et.");
    }
  }

  function handleEdit(deal: SurpriseDealBusiness) {
    setEditingDealId(deal.id);
    setForm(toFormState(deal));
    window.requestAnimationFrame(() => {
      formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function handleDelete(deal: SurpriseDealBusiness) {
    const confirmed = typeof window === "undefined" ? true : window.confirm(`"${deal.title}" kaydını silmek istediğine emin misin?`);
    if (!confirmed) return;
    setPendingAction(`${deal.id}:delete`);
    deleteMutation.mutate(deal.id);
  }

  const pageIntro = isOps
    ? "Ops ekibi bu işletme adına sürpriz paket açabilir, düzenleyebilir, yayına alabilir veya güvenli şekilde kapatabilir."
    : "HalkTasarruf yetkili işletme ekibi paketlerini buradan ekleyebilir, düzenleyebilir ve yayınlayabilir.";

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[30px] bg-[linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)] p-5 text-white shadow-[0_24px_70px_rgba(76,29,149,0.28)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/80 ring-1 ring-white/15">
              <PackageOpen className="h-3.5 w-3.5 text-white" />
              HalkTasarruf sürpriz paketler
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-[-0.055em] sm:text-4xl">Paketlerini yayına hazırla</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-violet-50/90">{pageIntro}</p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[520px]">
            <div className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/12">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Toplam</p>
              <p className="mt-1 text-2xl font-semibold">{summary.total}</p>
            </div>
            <div className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/12">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Aktif</p>
              <p className="mt-1 text-2xl font-semibold">{summary.active}</p>
            </div>
            <div className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/12">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Kalan</p>
              <p className="mt-1 text-2xl font-semibold">{summary.remaining}</p>
            </div>
            <div className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/12">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">Rezerve</p>
              <p className="mt-1 text-2xl font-semibold">{summary.reserved}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div ref={formSectionRef}>
        <SectionShell
          title={editingDealId !== null ? "Paketi düzenle" : "Yeni paket oluştur"}
          description="Başlangıç zamanı kayıt anında otomatik başlar. Sen sadece teslim bitişini, fiyatları ve paket detayını girersin."
          action={
            editingDealId !== null ? (
              <button
                type="button"
                onClick={resetForm}
                className="inline-flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                <XCircle className="h-4 w-4" />
                Düzenlemeyi bırak
              </button>
            ) : null
          }
        >
          <form onSubmit={handleSubmit} className="grid gap-3">
            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Paket başlığı</span>
              <input
                value={form.title}
                onChange={(event) => updateField("title", event.target.value)}
                className={fieldClassName()}
                placeholder="Akşam sürpriz paketi"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Açıklama</span>
              <textarea
                value={form.description}
                onChange={(event) => updateField("description", event.target.value)}
                className={`${fieldClassName()} min-h-24 resize-none`}
                placeholder="Günün kalan taze ürünlerinden hazırlanır."
              />
            </label>


            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Tahmini değer</span>
                <input
                  value={form.originalValue}
                  onChange={(event) => updateField("originalValue", event.target.value)}
                  inputMode="decimal"
                  className={fieldClassName()}
                  placeholder="Örn. 180"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Satış tutarı</span>
                <input
                  value={form.salePrice}
                  onChange={(event) => updateField("salePrice", event.target.value)}
                  inputMode="decimal"
                  className={fieldClassName()}
                  placeholder="Örn. 99"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Kota / toplam adet</span>
                <input
                  value={form.quantityTotal}
                  onChange={(event) => updateField("quantityTotal", event.target.value)}
                  inputMode="numeric"
                  className={fieldClassName()}
                  placeholder="Örn. 12"
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Gramaj (gr)</span>
                <input
                  value={form.grams}
                  onChange={(event) => updateField("grams", event.target.value)}
                  inputMode="numeric"
                  className={fieldClassName()}
                  placeholder="Örn. 450"
                />
              </label>
            </div>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">İlk durum</span>
              <select value={form.status} onChange={(event) => updateField("status", event.target.value as FormState["status"])} className={fieldClassName()}>
                <option value="DRAFT">Taslak</option>
                <option value="ACTIVE">Aktif</option>
              </select>
            </label>

            <div className="rounded-[24px] border border-violet-100 bg-violet-50/45 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-700">Teslim penceresi</span>
                  <p className="mt-1 text-sm font-semibold text-zinc-900">Teslim bitiş tarihi ve saati</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    Başlangıç otomatik olarak şimdi başlar. Müşterinin paketi en geç ne zamana kadar alabileceğini burada belirle.
                  </p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-violet-700 ring-1 ring-violet-100">
                  Otomatik başlangıç
                </span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-[1fr_200px]">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Teslim günü</span>
                  <input
                    type="date"
                    value={getPickupDatePart(form.pickupEnd)}
                    onChange={(event) => updateField("pickupEnd", setPickupDatePart(form.pickupEnd, event.target.value))}
                    className={fieldClassName()}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Son saat</span>
                  <input
                    type="time"
                    step={900}
                    value={getPickupTimePart(form.pickupEnd)}
                    onChange={(event) => updateField("pickupEnd", setPickupTimePart(form.pickupEnd, event.target.value))}
                    className={fieldClassName()}
                  />
                </label>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateField("pickupEnd", setPickupDatePart(form.pickupEnd, getPickupDatePart(createDefaultPickupEndValue())))}
                  className="rounded-full border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                >
                  Bugün
                </button>
                <button
                  type="button"
                  onClick={() => updateField("pickupEnd", shiftPickupDate(form.pickupEnd, 1))}
                  className="rounded-full border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                >
                  Yarın
                </button>
                <button
                  type="button"
                  onClick={() => updateField("pickupEnd", createDefaultPickupEndValue())}
                  className="rounded-full border border-violet-200 bg-white px-3 py-2 text-xs font-semibold text-violet-700 transition hover:bg-violet-100"
                >
                  Cihaz saatine göre yenile
                </button>
              </div>
              <div className="mt-3 rounded-2xl border border-white/80 bg-white px-4 py-3 text-sm text-zinc-700">
                <span className="font-semibold text-zinc-900">Teslim özeti:</span> {formatPickupPreview(form.pickupEnd)}
              </div>
            </div>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Minimum içerik notu</span>
              <input
                value={form.minContentsNote}
                onChange={(event) => updateField("minContentsNote", event.target.value)}
                className={fieldClassName()}
                placeholder="En az 1 ana ürün + yan ürün"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Alerjen notu</span>
              <input
                value={form.allergensNote}
                onChange={(event) => updateField("allergensNote", event.target.value)}
                className={fieldClassName()}
                placeholder="Gluten, süt ürünü içerebilir"
              />
            </label>

            <label className="space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Görsel URL</span>
              <input
                value={form.imageUrl}
                onChange={(event) => updateField("imageUrl", event.target.value)}
                className={fieldClassName()}
                placeholder="https://.../paket.jpg"
              />
            </label>

            <div className="rounded-[24px] border border-dashed border-violet-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">Cihazdan görsel seç</p>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">İstersen görseli doğrudan cihazından yükleyip kartta kullanabilirsin.</p>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#5B21B6,#7C3AED)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_30px_rgba(109,40,217,0.22)] transition hover:brightness-110">
                  Görsel seç
                  <input
                    type="file"
                    accept={IMAGE_FILE_TYPES.join(",")}
                    className="sr-only"
                    onChange={(event) => updateField("imageFile", event.target.files?.[0] ?? null)}
                  />
                </label>
              </div>
              {form.imageFile ? (
                <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-zinc-100 bg-zinc-50 px-3 py-3 text-sm text-zinc-700 sm:flex-row sm:items-center sm:justify-between">
                  <span className="truncate font-medium">{form.imageFile.name}</span>
                  <span className="flex items-center gap-3 text-xs text-zinc-500">
                    {formatFileSize(form.imageFile.size)}
                    <button
                      type="button"
                      onClick={() => updateField("imageFile", null)}
                      className="font-semibold text-violet-700 hover:text-violet-800"
                    >
                      Kaldır
                    </button>
                  </span>
                </div>
              ) : null}
            </div>

            <PendingButton
              type="submit"
              pending={saveMutation.isPending}
              pendingText={editingDealId !== null ? "Güncelleniyor..." : "Oluşturuluyor..."}
              className="mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#5B21B6,#7C3AED)] px-5 py-3 text-sm font-semibold text-white shadow-[0_16px_34px_rgba(109,40,217,0.22)] transition hover:-translate-y-0.5 hover:brightness-110"
            >
              {editingDealId !== null ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editingDealId !== null ? "Paketi güncelle" : "Paketi oluştur"}
            </PendingButton>
          </form>
        </SectionShell>
        </div>

        <SectionShell
          title="Yayındaki ve taslaktaki paketler"
          description="Bu listedeki paketleri yayına alabilir, duraklatabilir, güvenli şekilde kapatabilir veya hiç kullanılmadıysa silebilirsin."
        >
          {dealsQuery.isPending ? (
            <div className="grid gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <LoadingSkeleton key={index} lines={5} />
              ))}
            </div>
          ) : dealsQuery.isError ? (
            <ErrorState title="Sürpriz paketler yüklenemedi" description={getApiErrorMessage(dealsQuery.error)} />
          ) : deals.length > 0 ? (
            <div className="grid gap-4">
              {deals.map((deal) => (
                <article key={deal.id} className="rounded-[28px] border border-zinc-100 bg-zinc-50/65 p-4 shadow-sm sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusChip label={getStatusLabel(deal.status)} tone={getStatusTone(deal.status)} />
                        {deal.active_reserved_count > 0 ? <StatusChip label={`${deal.active_reserved_count} aktif rezervasyon`} tone="warning" /> : null}
                      </div>
                      <h3 className="mt-3 text-xl font-semibold tracking-[-0.04em] text-zinc-950">{deal.title}</h3>
                      {deal.description ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-zinc-500">{deal.description}</p> : null}
                    </div>

                    <div className="rounded-2xl bg-zinc-950 px-4 py-3 text-white">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">Satış tutarı</p>
                      <p className="mt-1 text-xl font-semibold">
                        <AmountText amount={deal.sale_price_amount} currency={deal.currency} />
                      </p>
                    </div>
                  </div>

                  {deal.allergens_note ? (
                    <div className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{deal.allergens_note}</span>
                    </div>
                  ) : null}


                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Tahmini değer</p>
                      <p className="mt-2 font-semibold text-zinc-950">
                        <AmountText amount={deal.original_value_amount} currency={deal.currency} />
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Kota</p>
                      <p className="mt-2 font-semibold text-zinc-950">
                        {deal.quantity_total} toplam · {deal.quantity_remaining} kalan
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Teslim aralığı</p>
                      <p className="mt-2 text-sm font-semibold text-zinc-950">{formatDateTime(deal.pickup_window_start)}</p>
                      <p className="mt-1 text-sm text-zinc-500">{formatDateTime(deal.pickup_window_end)}</p>
                    </div>
                    <div className="rounded-2xl bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Gramaj</p>
                      <p className="mt-2 text-sm font-semibold text-zinc-950">{deal.grams ? `${deal.grams} gr` : "-"}</p>
                    </div>
                    <div className="rounded-2xl bg-white p-4 sm:col-span-2 xl:col-span-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Minimum içerik</p>
                      <p className="mt-2 text-sm font-semibold text-zinc-950">{deal.min_contents_note || "-"}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(deal)}
                      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:border-violet-300 hover:text-violet-700"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Düzenle
                    </button>

                    {STATUS_ACTIONS.map((option) => (
                      <PendingButton
                        key={option.value}
                        type="button"
                        pending={pendingAction === `${deal.id}:${option.value}`}
                        pendingText="Güncelleniyor..."
                        disabled={deal.status === option.value}
                        onClick={() => {
                          setPendingAction(`${deal.id}:${option.value}`);
                          statusMutation.mutate({ dealId: deal.id, status: option.value });
                        }}
                        className="inline-flex min-h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:border-violet-300 hover:text-violet-700 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                      >
                        {option.value === "ACTIVE" ? <PlayCircle className="mr-1.5 h-3.5 w-3.5" /> : null}
                        {option.value === "PAUSED" ? <PauseCircle className="mr-1.5 h-3.5 w-3.5" /> : null}
                        {option.value === "CLOSED" ? <XCircle className="mr-1.5 h-3.5 w-3.5" /> : null}
                        {option.label}
                      </PendingButton>
                    ))}

                    <PendingButton
                      type="button"
                      pending={pendingAction === `${deal.id}:close`}
                      pendingText="Kapatılıyor..."
                      disabled={deal.status === "CLOSED"}
                      onClick={() => {
                        setPendingAction(`${deal.id}:close`);
                        closeMutation.mutate(deal.id);
                      }}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl bg-zinc-950 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-500"
                    >
                      Güvenli kapat
                    </PendingButton>

                    <PendingButton
                      type="button"
                      pending={pendingAction === `${deal.id}:delete`}
                      pendingText="Siliniyor..."
                      onClick={() => handleDelete(deal)}
                      className="inline-flex min-h-10 items-center justify-center rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Sil
                    </PendingButton>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="Henüz sürpriz paket yok"
              description="İlk kaydı oluşturarak bu işletmeyi HalkTasarruf bölümünde yayına hazırlayabilirsin."
            />
          )}
        </SectionShell>
      </div>

      <section className="rounded-[28px] border border-zinc-100 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.06)] sm:p-6">
        <div className="flex items-start gap-3 rounded-2xl bg-zinc-50 px-4 py-4 text-sm leading-6 text-zinc-600">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" />
          <p>
            Paket silme sadece hiç rezerve edilmemiş kayıtlar için açıktır. Rezervasyon veya sipariş geçmişi oluştuysa güvenli kapat akışı kullanılır;
            böylece QR, finans ve geçmiş kayıtlar bozulmaz.
          </p>
        </div>
      </section>
    </div>
  );
}








