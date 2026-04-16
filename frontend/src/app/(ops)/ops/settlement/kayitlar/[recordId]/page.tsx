"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsActionResult, OpsJsonCard, OpsKeyValueGrid, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { getSettlementRecordDetail, reprocessSettlementRecord, reviewSettlementRecord } from "@/features/ops-console/api";
import { asRecord, invalidateOpsQueries, isSettlementReviewEditable, normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsSettlementRecordDetailPage() {
  const params = useParams<{ recordId: string }>();
  const recordId = normalizeOpsId(params.recordId);
  const queryClient = useQueryClient();
  const [reviewStatus, setReviewStatus] = useState("ACKNOWLEDGED");
  const [operatorNote, setOperatorNote] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const detailQuery = useQuery({ queryKey: ["ops", "settlement-record", recordId], queryFn: () => getSettlementRecordDetail(recordId as number), enabled: recordId !== null });

  useEffect(() => {
    if (!detailQuery.data) return;
    setReviewStatus(detailQuery.data.record.review_status || "ACKNOWLEDGED");
    setOperatorNote(detailQuery.data.record.operator_note || "");
  }, [detailQuery.data]);

  const refresh = async () => {
    await invalidateOpsQueries(queryClient, [["ops", "settlement-record", recordId], ["ops", "settlement-records"], ["ops", "settlement-dashboard"]]);
    await detailQuery.refetch();
  };

  const operatorFlags = asRecord(detailQuery.data?.operator_flags);
  const canReprocess = Boolean(operatorFlags.can_reprocess);
  const canReview = Boolean(operatorFlags.can_review);
  const isProcessed = Boolean(detailQuery.data?.record.is_processed);
  const baselineStatus = detailQuery.data?.record.review_status || "ACKNOWLEDGED";
  const baselineNote = detailQuery.data?.record.operator_note || "";
  const reviewDirty = reviewStatus !== baselineStatus || operatorNote !== baselineNote;

  const reprocessMutation = useMutation({ mutationFn: () => reprocessSettlementRecord(recordId as number), onSuccess: async (response) => { const data = asRecord(response.data); setLastResult(`Reprocess tamamlandı. processed=${String(data.processed ?? false)}, next_action=${String(data.next_action ?? "-")}.`); toast.success("Record reprocess tetiklendi"); await refresh(); }, onError: (error) => { const message = getApiErrorMessage(error); setLastResult(`Reprocess başarısız: ${message}`); toast.error(message); } });
  const reviewMutation = useMutation({ mutationFn: () => reviewSettlementRecord(recordId as number, { review_status: reviewStatus, operator_note: operatorNote }), onSuccess: async () => { setLastResult(`Review güncellendi. Yeni status: ${reviewStatus}.`); toast.success("Review güncellendi"); await refresh(); }, onError: (error) => { const message = getApiErrorMessage(error); setLastResult(`Review güncellenemedi: ${message}`); toast.error(message); } });

  const reviewLockedMessage = useMemo(() => {
    if (!detailQuery.data) return "";
    if (!isSettlementReviewEditable(reviewMutation.isPending || reprocessMutation.isPending, canReview)) {
      return "Backend bu kayıt için review aksiyonunu şu anda kapalı tutuyor.";
    }
    if (!reviewDirty) {
      return "Kaydedilecek yeni review değişikliği yok.";
    }
    return "";
  }, [canReview, detailQuery.data, reviewDirty, reviewMutation.isPending, reprocessMutation.isPending]);

  return (
    <OpsPageShell title="Settlement record detay" description="Manual review notu ve reprocess aksiyonu aynı sayfada.">
      {recordId === null ? <ErrorState title="Geçersiz record" description="URL içindeki recordId değeri okunamadı." /> : null}
      <OpsLinkRow links={recordId ? [{ href: "/ops/settlement/kayitlar", label: "Record listesi" }] : []} />
      {lastResult ? <OpsActionResult tone={lastResult.includes("başarısız") || lastResult.includes("güncellenemedi") ? "danger" : "success"} title="Record aksiyon sonucu" description={lastResult} /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="Record detayı yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
        <>
          <div className="flex flex-wrap gap-2 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><OpsStatus label={detailQuery.data.record.review_status} /><OpsStatus label={detailQuery.data.record.next_action || "-"} /><OpsStatus label={detailQuery.data.record.is_processed ? "PROCESSED" : "OPEN"} />{operatorFlags.stale_manual_review ? <OpsStatus label="STALE_MANUAL_REVIEW" /> : null}</div>
          <OpsKeyValueGrid items={[
            { label: "Import ID", value: detailQuery.data.record.import_id || "-" },
            { label: "Provider reference", value: detailQuery.data.record.provider_reference || "-" },
            { label: "Match type", value: detailQuery.data.record.match_type || "-" },
            { label: "Reason", value: detailQuery.data.record.unmatched_reason_label || detailQuery.data.record.unmatched_reason_code || "-" },
            { label: "Payout status", value: detailQuery.data.record.payout_status || "-" },
            { label: "Payment intent status", value: detailQuery.data.record.payment_intent_status || "-" },
          ]} />
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-semibold">Review güncelle</h3>{reviewLockedMessage ? <OpsActionResult tone={reviewDirty ? "default" : "warning"} title="Review guard" description={reviewLockedMessage} /> : null}<select value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"><option value="OPEN">OPEN</option><option value="ACKNOWLEDGED">ACKNOWLEDGED</option><option value="RETRY_SCHEDULED">RETRY_SCHEDULED</option><option value="RESOLVED">RESOLVED</option></select><textarea value={operatorNote} onChange={(e) => setOperatorNote(e.target.value)} placeholder="Operator note" className="min-h-28 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" /><button disabled={Boolean(reviewLockedMessage)} onClick={() => reviewMutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">{reviewMutation.isPending ? "Kaydediliyor..." : "Review kaydet"}</button></div>
            <OpsJsonCard title="Lifecycle events" description="Reprocess öncesi event zinciri" value={safeJsonStringify(detailQuery.data.record.lifecycle_events || [])} />
          </div>
          {canReprocess ? <div><button disabled={reprocessMutation.isPending || reviewMutation.isPending || isProcessed} onClick={() => reprocessMutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">{reprocessMutation.isPending ? "Reprocess çalışıyor..." : "Reprocess çalıştır"}</button></div> : <OpsActionResult tone="warning" title="Bu kayıt için reprocess kapalı" description="Backend operator_flags.can_reprocess=false döndüğü için aksiyon butonu gizlendi." />}
        </>
      ) : null}
    </OpsPageShell>
  );
}
