"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsCell, OpsEmpty, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { listSettlementRecords } from "@/features/ops-console/api";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsSettlementRecordsPage() {
  const [reviewStatus, setReviewStatus] = useState("");
  const recordsQuery = useQuery({ queryKey: ["ops", "settlement-records", reviewStatus], queryFn: () => listSettlementRecords({ review_status: reviewStatus || undefined }) });

  return (
    <OpsPageShell title="Settlement kayıtları" description="Unmatched / review / reprocess akışlarının operasyon ekranı.">
      <Card><CardContent><select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm"><option value="">Tüm review status</option><option value="OPEN">OPEN</option><option value="ACKNOWLEDGED">ACKNOWLEDGED</option><option value="RETRY_SCHEDULED">RETRY_SCHEDULED</option><option value="RESOLVED">RESOLVED</option></select></CardContent></Card>
      {recordsQuery.isPending ? <LoadingSkeleton /> : null}
      {recordsQuery.isError ? <ErrorState title="Settlement kayıtları yüklenemedi" description={getApiErrorMessage(recordsQuery.error)} /> : null}
      {recordsQuery.data ? recordsQuery.data.results.length > 0 ? <OpsTable columns={["Record", "Match", "Review", "Aksiyon"]}>{recordsQuery.data.results.map((record) => <tr key={record.id}><OpsCell><p className="font-medium">#{record.id}</p><p className="text-xs text-zinc-500">import: {record.import_id || "-"}</p></OpsCell><OpsCell><p>{record.match_type || "-"}</p><p className="text-xs text-zinc-500">{record.unmatched_reason_label || record.processing_error || "-"}</p></OpsCell><OpsCell><div className="flex flex-wrap gap-2"><OpsStatus label={record.review_status} /><OpsStatus label={record.next_action || "-"} /></div></OpsCell><OpsCell><Link href={`/ops/settlement/kayitlar/${record.id}`} className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium">Detay</Link></OpsCell></tr>)}</OpsTable> : <OpsEmpty title="Settlement kaydı yok" description="Bu filtre ile eşleşen record bulunamadı." /> : null}
    </OpsPageShell>
  );
}
