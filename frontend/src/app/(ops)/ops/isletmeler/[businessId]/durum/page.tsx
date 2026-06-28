"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getOpsBusinessDetail, updateOpsBusinessStatus } from "@/features/ops-console/api";
import { invalidateOpsQueries, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

const defaultForm = {
  is_active: false,
  is_approved: false,
  is_listed: false,
  listing_type: "STANDARD",
  is_featured: false,
  display_priority: 0,
  marketplace_is_visible: false,
  payout_onboarding_note: "",
};

type BooleanStatusKey = "is_active" | "is_approved" | "is_listed" | "is_featured" | "marketplace_is_visible";

const STATUS_TOGGLES: Array<{ key: BooleanStatusKey; label: string; description: string }> = [
  {
    key: "is_active",
    label: "İşletme aktif",
    description: "Kapalıysa işletme operasyon ekranlarında pasif kabul edilir.",
  },
  {
    key: "is_approved",
    label: "Operasyon onayı var",
    description: "Onay yoksa işletme yayına alınmadan önce operasyon kontrolü bekler.",
  },
  {
    key: "is_listed",
    label: "Listelerde yer alsın",
    description: "Açık olduğunda işletme ilgili liste ve keşif alanlarında görünebilir.",
  },
  {
    key: "is_featured",
    label: "Öne çıkarılsın",
    description: "Açık olduğunda işletme sıralamada daha görünür hale getirilebilir.",
  },
  {
    key: "marketplace_is_visible",
    label: "Pazaryerinde görünür",
    description: "Müşteri tarafında işletmenin görünmesini doğrudan etkiler.",
  },
];

export default function OpsBusinessStatusPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryClient = useQueryClient();
  const detailQuery = useQuery({
    queryKey: ["ops", "business", businessId],
    queryFn: () => getOpsBusinessDetail(businessId as number),
    enabled: businessId !== null,
  });
  const [form, setForm] = useState(defaultForm);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!detailQuery.data) return;
    setForm({
      is_active: detailQuery.data.is_active,
      is_approved: detailQuery.data.is_approved,
      is_listed: detailQuery.data.is_listed,
      listing_type: detailQuery.data.listing_type,
      is_featured: detailQuery.data.is_featured,
      display_priority: detailQuery.data.display_priority,
      marketplace_is_visible: detailQuery.data.marketplace_is_visible,
      payout_onboarding_note: detailQuery.data.payout_onboarding_note || "",
    });
  }, [detailQuery.data]);

  const baseline = useMemo(() => {
    if (!detailQuery.data) return defaultForm;
    return {
      is_active: detailQuery.data.is_active,
      is_approved: detailQuery.data.is_approved,
      is_listed: detailQuery.data.is_listed,
      listing_type: detailQuery.data.listing_type,
      is_featured: detailQuery.data.is_featured,
      display_priority: detailQuery.data.display_priority,
      marketplace_is_visible: detailQuery.data.marketplace_is_visible,
      payout_onboarding_note: detailQuery.data.payout_onboarding_note || "",
    };
  }, [detailQuery.data]);

  const hasChanges = useMemo(() => JSON.stringify(form) !== JSON.stringify(baseline), [baseline, form]);

  const mutation = useMutation({
    mutationFn: () => updateOpsBusinessStatus(businessId as number, form),
    onSuccess: async () => {
      toast.success("Durum kaydedildi");
      setLastSavedAt(new Date().toISOString());
      await invalidateOpsQueries(queryClient, [["ops", "business", businessId], ["ops", "businesses"]]);
      await detailQuery.refetch();
    },
    onError: (error) => toast.error(getApiErrorMessage(error)),
  });

  return (
    <OpsPageShell
      title="İşletme durum yönetimi"
      description="İşletmenin yayın, listeleme ve görünürlük ayarlarını güncelleyin."
    >
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme numarası okunamadı." /> : null}
      <OpsLinkRow
        links={
          businessId
            ? [
                { href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" },
                { href: `/ops/isletmeler/${businessId}/uyelikler`, label: "Yetkililer" },
                { href: `/ops/isletmeler/${businessId}/iyzico`, label: "Ödeme hesabı" },
              ]
            : []
        }
      />
      <OpsActionResult
        tone="warning"
        title="Bu sayfadaki değişiklikler müşteriye görünürlüğü etkileyebilir"
        description="Onay, listeleme ve pazaryeri görünürlüğünü değiştirirken işletmenin yayına hazır olduğundan emin olun."
      />
      {lastSavedAt ? (
        <OpsActionResult
          title="Durum güncellemesi kaydedildi"
          description={`İşletme listesi ve detay bilgisi yenilendi. Son kayıt zamanı: ${formatDateTime(lastSavedAt)}.`}
        />
      ) : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="İşletme bilgisi yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
          <Card variant="surface">
          <CardContent className="space-y-6" padding="lg">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">{detailQuery.data.business_name}</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Aşağıdaki ayarlar operasyon onayı, müşteri görünürlüğü ve liste sıralamasını belirler.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <OpsStatus label={form.is_active ? "ACTIVE" : "INACTIVE"} />
                <OpsStatus label={form.is_approved ? "APPROVED" : "UNAPPROVED"} />
                <OpsStatus label={form.is_listed ? "LISTED" : "UNLISTED"} />
                <OpsStatus label={form.marketplace_is_visible ? "VISIBLE" : "HIDDEN"} />
              </div>
            </div>

            <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
              {STATUS_TOGGLES.map((item) => (
                <label key={item.key} className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
                  <input
                    type="checkbox"
                    checked={form[item.key]}
                    onChange={(event) => setForm((prev) => ({ ...prev, [item.key]: event.target.checked }))}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-semibold text-zinc-950">{item.label}</span>
                    <span className="mt-1 block leading-6 text-zinc-600">{item.description}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="grid gap-3 sm:gap-4 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-sm font-medium">Listeleme türü</span>
                <input
                  value={form.listing_type}
                  onChange={(event) => setForm((prev) => ({ ...prev, listing_type: event.target.value }))}
                  placeholder="STANDARD"
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
                />
                <span className="block text-xs text-zinc-500">Yalnızca ihtiyaç varsa değiştirin.</span>
              </label>
              <label className="space-y-1">
                <span className="text-sm font-medium">Sıralama önceliği</span>
                <input
                  type="number"
                  min={0}
                  value={form.display_priority}
                  onChange={(event) => setForm((prev) => ({ ...prev, display_priority: Number(event.target.value || 0) }))}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
                />
                <span className="block text-xs text-zinc-500">Etki mevcut sıralama kuralına göre uygulanır.</span>
              </label>
            </div>

            <label className="space-y-1">
              <span className="text-sm font-medium">Ödeme hesabı notu</span>
              <textarea
                value={form.payout_onboarding_note}
                onChange={(event) => setForm((prev) => ({ ...prev, payout_onboarding_note: event.target.value }))}
                placeholder="Örn. Evrak kontrolü bekleniyor, banka bilgisi tekrar doğrulanacak."
                className="min-h-28 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
              />
              <span className="block text-xs text-zinc-500">Bu not ödeme hesabı sürecini ekip içinde takip etmek için kullanılır.</span>
            </label>

            <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
              <Button
                disabled={mutation.isPending || !hasChanges}
                onClick={() => mutation.mutate()}
                loading={mutation.isPending}
                loadingText="Kaydediliyor..."
                className="w-full sm:w-auto"
              >
                Değişiklikleri kaydet
              </Button>
              <Button
                disabled={mutation.isPending || !hasChanges}
                onClick={() => setForm(baseline)}
                variant="secondary"
                className="w-full sm:w-auto"
              >
                Değişiklikleri geri al
              </Button>
              {!hasChanges ? <span className="text-sm text-zinc-500">Kaydedilecek yeni değişiklik yok.</span> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </OpsPageShell>
  );
}
