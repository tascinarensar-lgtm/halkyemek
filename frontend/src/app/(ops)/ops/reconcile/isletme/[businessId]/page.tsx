"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsEmpty, OpsJsonCard, OpsLinkRow, OpsPageShell } from "@/components/ops-console/shared";
import { getReconcileBusiness } from "@/features/ops-console/api";
import { asArray, normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsReconcileBusinessPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const reconcileQuery = useQuery({ queryKey: ["ops", "reconcile", businessId], queryFn: () => getReconcileBusiness(businessId as number), enabled: businessId !== null });
  const issues = asArray(reconcileQuery.data?.issues);

  return (
    <OpsPageShell title="Business reconcile" description="İşletme bazlı mutabakat özeti ve issue listesi.">
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki businessId değeri okunamadı." /> : null}
      <OpsLinkRow links={businessId ? [{ href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" }] : []} />
      {reconcileQuery.isPending ? <LoadingSkeleton /> : null}
      {reconcileQuery.isError ? <ErrorState title="Reconcile verisi yüklenemedi" description={getApiErrorMessage(reconcileQuery.error)} /> : null}
      {reconcileQuery.data ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <OpsJsonCard title="Summary" value={safeJsonStringify(reconcileQuery.data.summary)} description="Backend summary alanı eksik gelse bile ekran kırılmaz." />
          {issues.length > 0 ? (
            <OpsJsonCard title="Issues" value={safeJsonStringify(issues)} description={`Toplam issue: ${issues.length}`} />
          ) : (
            <OpsEmpty title="Issue yok" description="Bu işletme için açık mutabakat problemi görünmüyor." />
          )}
        </div>
      ) : null}
    </OpsPageShell>
  );
}
