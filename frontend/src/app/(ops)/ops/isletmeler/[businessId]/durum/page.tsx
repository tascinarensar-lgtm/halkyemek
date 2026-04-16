"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getOpsBusinessDetail, updateOpsBusinessStatus } from "@/features/ops-console/api";
import { invalidateOpsQueries, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

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

export default function OpsBusinessStatusPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["ops", "business", businessId], queryFn: () => getOpsBusinessDetail(businessId as number), enabled: businessId !== null });
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
    <OpsPageShell title="Business status yönetimi" description="Approval, listing, görünürlük ve ops note alanlarını patch et.">
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki businessId değeri okunamadı." /> : null}
      <OpsLinkRow links={businessId ? [
        { href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" },
        { href: `/ops/isletmeler/${businessId}/uyelikler`, label: "Üyelikler" },
        { href: `/ops/isletmeler/${businessId}/iyzico`, label: "Iyzico" },
      ] : []} />
      {lastSavedAt ? <OpsActionResult title="Durum güncellemesi kaydedildi" description={`Mutation sonrası detail ve list cache yeniden sorgulandı. Son kayıt: ${new Date(lastSavedAt).toLocaleString("tr-TR")}.`} /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="Business verisi yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
        <Card>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap gap-2">
              <OpsStatus label={form.is_active ? "ACTIVE" : "INACTIVE"} />
              <OpsStatus label={form.is_approved ? "APPROVED" : "UNAPPROVED"} />
              <OpsStatus label={form.is_listed ? "LISTED" : "UNLISTED"} />
              <OpsStatus label={form.marketplace_is_visible ? "VISIBLE" : "HIDDEN"} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {[
                ["Aktif", "is_active"],
                ["Approved", "is_approved"],
                ["Listed", "is_listed"],
                ["Featured", "is_featured"],
                ["Marketplace visible", "marketplace_is_visible"],
              ].map(([label, key]) => (
                <label key={key} className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
                  <input type="checkbox" checked={Boolean(form[key as keyof typeof form])} onChange={(e) => setForm((prev) => ({ ...prev, [key]: e.target.checked }))} />
                  <span>
                    <span className="block font-medium">{label}</span>
                    <span className="mt-1 block text-zinc-600">Flag alanı backend status patch endpointine gider.</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">Listing type</p>
                <input value={form.listing_type} onChange={(e) => setForm((prev) => ({ ...prev, listing_type: e.target.value }))} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Display priority</p>
                <input type="number" min={0} value={form.display_priority} onChange={(e) => setForm((prev) => ({ ...prev, display_priority: Number(e.target.value || 0) }))} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Payout onboarding note</p>
              <textarea value={form.payout_onboarding_note} onChange={(e) => setForm((prev) => ({ ...prev, payout_onboarding_note: e.target.value }))} className="min-h-28 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-wrap gap-3">
              <button disabled={mutation.isPending || !hasChanges} onClick={() => mutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">
                {mutation.isPending ? "Kaydediliyor..." : "Kaydet"}
              </button>
              <button disabled={mutation.isPending || !hasChanges} onClick={() => setForm(baseline)} className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium disabled:bg-zinc-200">
                Formu geri al
              </button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </OpsPageShell>
  );
}
