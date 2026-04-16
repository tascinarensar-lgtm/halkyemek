"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsEmpty, OpsMetricCard, OpsPageShell, OpsSectionCard, OpsStatus } from "@/components/ops-console/shared";
import { getSettlementDashboard } from "@/features/ops-console/api";
import { asNumber, asRecord } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

export default function OpsSettlementPage() {
  const dashboardQuery = useQuery({ queryKey: ["ops", "settlement-dashboard"], queryFn: getSettlementDashboard });
  const heartbeats = asRecord(dashboardQuery.data?.heartbeats);

  return (
    <OpsPageShell title="Settlement merkezi" description="Import, unmatched kayıt ve heartbeat durumlarını tek panelde izle.">
      {dashboardQuery.isPending ? <LoadingSkeleton /> : null}
      {dashboardQuery.isError ? <OpsSectionCard title="Settlement dashboard yüklenemedi">{getApiErrorMessage(dashboardQuery.error)}</OpsSectionCard> : null}
      {dashboardQuery.data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OpsMetricCard label="Toplam import" value={asNumber(dashboardQuery.data.imports_total)} />
            <OpsMetricCard label="Failed import" value={asNumber(dashboardQuery.data.imports_failed)} />
            <OpsMetricCard label="Open unmatched" value={asNumber(dashboardQuery.data.records_unmatched_open)} />
            <OpsMetricCard label="Stale manual review" value={asNumber(dashboardQuery.data.records_stale_manual_review)} />
          </div>
          <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <OpsSectionCard title="Latest import">
              {dashboardQuery.data.latest_import ? (
                <div className="space-y-2 text-sm"><div className="flex flex-wrap gap-2"><OpsStatus label={dashboardQuery.data.latest_import.applied_status} /><OpsStatus label={dashboardQuery.data.latest_import.parse_status} /></div><p>{dashboardQuery.data.latest_import.original_filename || dashboardQuery.data.latest_import.source_label || "-"}</p><p className="text-zinc-500">imported_at: {formatDateTime(dashboardQuery.data.latest_import.imported_at)}</p><Link href="/ops/settlement/importlar" className="text-sm font-medium text-zinc-700">Tüm importlar</Link></div>
              ) : <OpsEmpty title="Henüz import yok" description="Settlement import geçmişi oluşmamış." />}
            </OpsSectionCard>
            <OpsSectionCard title="Kayıt ekranları">
              <div className="space-y-2 text-sm"><p>Processed: {asNumber(dashboardQuery.data.records_processed)}</p><p>Failed/open: {asNumber(dashboardQuery.data.records_failed)}</p><p>Latest import summary: {JSON.stringify(dashboardQuery.data.latest_import_record_summary || {})}</p><Link href="/ops/settlement/kayitlar" className="text-sm font-medium text-zinc-700">Record listesi</Link></div>
            </OpsSectionCard>
          </div>
          <OpsSectionCard title="Job heartbeat’leri">
            <div className="grid gap-3 md:grid-cols-3">
              {Object.keys(heartbeats).length > 0 ? Object.entries(heartbeats).map(([key, rawValue]) => {
                const value = asRecord(rawValue);
                return <div key={key} className="rounded-xl bg-zinc-50 p-4 text-sm"><div className="flex flex-wrap gap-2"><OpsStatus label={String(value.status || "UNKNOWN")} /></div><p className="mt-2 font-medium">{key}</p><p className="mt-1 text-zinc-600">updated_at: {formatDateTime(String(value.updated_at || ""))}</p></div>;
              }) : <OpsEmpty title="Heartbeat yok" description="Scheduler heartbeat verisi henüz görünmüyor." />}
            </div>
          </OpsSectionCard>
        </>
      ) : null}
    </OpsPageShell>
  );
}
