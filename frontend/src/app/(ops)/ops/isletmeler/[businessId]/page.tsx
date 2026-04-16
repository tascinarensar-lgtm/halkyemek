"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { OpsActionResult, OpsEmpty, OpsJsonCard, OpsKeyValueGrid, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getOpsBusinessDetail } from "@/features/ops-console/api";
import type { OpsBusinessMembership } from "@/features/ops-console/types";
import { asArray, safeJsonStringify, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

export default function OpsBusinessDetailPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const detailQuery = useQuery({ queryKey: ["ops", "business", businessId], queryFn: () => getOpsBusinessDetail(businessId as number), enabled: businessId !== null });

  const memberships = asArray<OpsBusinessMembership>(detailQuery.data?.memberships);
  const onboarding = detailQuery.data?.iyzico_onboarding ?? {};

  return (
    <OpsPageShell title="İşletme detay" description="Lifecycle, contact, membership summary ve iyzico onboarding izleme ekranı.">
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki businessId değeri okunamadı." /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="İşletme detayı yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold">{detailQuery.data.business_name}</h2>
                  <OpsStatus label={detailQuery.data.payout_onboarding_status} />
                </div>
                <p className="mt-1 text-sm text-zinc-600">#{detailQuery.data.id} · {detailQuery.data.category} · {detailQuery.data.district}</p>
              </div>
              <OpsLinkRow
                links={[
                  { href: "/ops/isletmeler", label: "Listeye dön" },
                  { href: `/ops/isletmeler/${detailQuery.data.id}/durum`, label: "Durum yönet", primary: true },
                  { href: `/ops/isletmeler/${detailQuery.data.id}/uyelikler`, label: "Üyelikler" },
                  { href: `/ops/isletmeler/${detailQuery.data.id}/iyzico`, label: "Iyzico" },
                  { href: `/ops/reconcile/isletme/${detailQuery.data.id}`, label: "Reconcile" },
                ]}
              />
            </CardContent>
          </Card>

          <OpsKeyValueGrid items={[
            { label: "Listing type", value: detailQuery.data.listing_type || "-" },
            { label: "Display priority", value: detailQuery.data.display_priority },
            { label: "Adres", value: detailQuery.data.adress || "-" },
            { label: "Contact name", value: detailQuery.data.contact?.full_name || "-" },
            { label: "Contact email", value: detailQuery.data.contact?.email || "-" },
            { label: "Contact phone", value: detailQuery.data.contact?.phone || "-" },
          ]} />

          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardContent className="space-y-3">
                <h3 className="text-lg font-semibold">Lifecycle flag’leri</h3>
                <div className="flex flex-wrap gap-2">
                  <OpsStatus label={detailQuery.data.is_active ? "ACTIVE" : "INACTIVE"} />
                  <OpsStatus label={detailQuery.data.is_approved ? "APPROVED" : "UNAPPROVED"} />
                  <OpsStatus label={detailQuery.data.is_listed ? "LISTED" : "UNLISTED"} />
                  <OpsStatus label={detailQuery.data.marketplace_is_visible ? "VISIBLE" : "HIDDEN"} />
                  <OpsStatus label={detailQuery.data.is_featured ? "FEATURED" : "STANDARD"} />
                </div>
                <p className="text-sm text-zinc-600">Onboarding note: {detailQuery.data.payout_onboarding_note || "-"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-3">
                <h3 className="text-lg font-semibold">Aktif üyelik özeti</h3>
                {memberships.length > 0 ? (
                  <div className="space-y-2 text-sm">
                    {memberships.map((membership) => (
                      <div key={membership.id} className="rounded-xl bg-zinc-50 p-3">
                        <p className="font-medium">{membership.username || membership.user_id}</p>
                        <p className="text-zinc-600">{membership.email || "-"} · {membership.role}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <OpsEmpty title="Aktif üyelik yok" description="Bu işletme için aktif membership görünmüyor." />
                )}
              </CardContent>
            </Card>
          </div>

          {!Object.keys(onboarding).length ? (
            <OpsActionResult tone="warning" title="Iyzico onboarding özeti boş döndü" description="Backend partial cevap verse bile durum, üyelik ve reconcile ekranlarına geçiş korunur." />
          ) : null}

          <OpsJsonCard
            title="Iyzico onboarding özeti"
            description={`Son senkron: ${formatDateTime(String((onboarding as Record<string, unknown>).last_synced_at || "")) || "-"}`}
            value={safeJsonStringify(onboarding)}
          />
        </>
      ) : null}
    </OpsPageShell>
  );
}
