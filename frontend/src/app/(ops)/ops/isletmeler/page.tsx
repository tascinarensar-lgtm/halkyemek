"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { OpsCell, OpsEmpty, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { listOpsBusinesses } from "@/features/ops-console/api";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsBusinessListPage() {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const params = useMemo(() => ({ q: q.trim(), payout_onboarding_status: statusFilter || undefined }), [q, statusFilter]);
  const businessesQuery = useQuery({ queryKey: ["ops", "businesses", params], queryFn: () => listOpsBusinesses(params) });

  return (
    <OpsPageShell title="Ops işletmeler" description="Business lifecycle, onboarding ve görünürlük bilgilerini tek listeden yönet.">
      <Card>
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="İşletme / email / contact ara" className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm lg:max-w-md" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm">
            <option value="">Tüm onboarding durumları</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <div className="text-xs text-zinc-500">Backend en fazla ilk 200 kaydı döndürür.</div>
        </CardContent>
      </Card>
      {businessesQuery.isPending ? <LoadingSkeleton /> : null}
      {businessesQuery.isError ? <ErrorState title="İşletmeler yüklenemedi" description={getApiErrorMessage(businessesQuery.error)} /> : null}
      {businessesQuery.data ? (
        businessesQuery.data.results.length > 0 ? (
          <OpsTable columns={["İşletme", "Durum", "Onboarding", "Üyelik", "Aksiyon"]}>
            {businessesQuery.data.results.map((business) => (
              <tr key={business.id}>
                <OpsCell>
                  <div className="min-w-[260px]">
                    <p className="font-medium">{business.business_name}</p>
                    <p className="text-xs text-zinc-500">#{business.id} · {business.category} · {business.district}</p>
                    <p className="mt-1 text-xs text-zinc-500">{business.contact?.email || business.contact?.full_name || business.contact?.phone || "İletişim bilgisi yok"}</p>
                  </div>
                </OpsCell>
                <OpsCell>
                  <div className="flex flex-wrap gap-2">
                    <OpsStatus label={business.is_active ? "ACTIVE" : "INACTIVE"} />
                    <OpsStatus label={business.is_approved ? "APPROVED" : "UNAPPROVED"} />
                    <OpsStatus label={business.is_listed ? "LISTED" : "UNLISTED"} />
                    <OpsStatus label={business.marketplace_is_visible ? "VISIBLE" : "HIDDEN"} />
                  </div>
                </OpsCell>
                <OpsCell>
                  <div className="space-y-2 text-sm">
                    <OpsStatus label={business.payout_onboarding_status} />
                    <p className="text-zinc-500">submerchant: {business.iyzico_submerchant_key || "-"}</p>
                  </div>
                </OpsCell>
                <OpsCell>{business.active_membership_count}</OpsCell>
                <OpsCell>
                  <div className="flex min-w-[250px] flex-wrap gap-2">
                    <Link href={`/ops/isletmeler/${business.id}`} className="rounded-xl bg-zinc-950 px-3 py-2 text-xs font-medium text-white">Detay</Link>
                    <Link href={`/ops/isletmeler/${business.id}/uyelikler`} className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium">Üyelikler</Link>
                    <Link href={`/ops/reconcile/isletme/${business.id}`} className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium">Reconcile</Link>
                  </div>
                </OpsCell>
              </tr>
            ))}
          </OpsTable>
        ) : (
          <OpsEmpty title="İşletme bulunamadı" description="Arama veya filtre sonucu eşleşen kayıt yok." />
        )
      ) : null}
    </OpsPageShell>
  );
}
