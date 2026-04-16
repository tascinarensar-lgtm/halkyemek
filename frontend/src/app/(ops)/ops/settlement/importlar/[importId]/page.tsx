"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsActionResult, OpsCell, OpsEmpty, OpsKeyValueGrid, OpsLinkRow, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { getSettlementImportDetail, retrySettlementImport } from "@/features/ops-console/api";
import { asRecord, invalidateOpsQueries, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsSettlementImportDetailPage() {
  const params = useParams<{ importId: string }>();
  const importId = normalizeOpsId(params.importId);
  const queryClient = useQueryClient();
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const detailQuery = useQuery({ queryKey: ["ops", "settlement-import", importId], queryFn: () => getSettlementImportDetail(importId as number), enabled: importId !== null });
  const retryBlockedReason = useMemo(() => {
    const appliedStatus = String(detailQuery.data?.import.applied_status || "").toUpperCase();
    if (!detailQuery.data) return "";
    if (appliedStatus === "APPLIED") {
      return "Bu import zaten APPLIED durumda. Aynı import üzerinde tekrar retry butonu operatöre yanlış hareket hissi vereceği için kapatıldı.";
    }
    return "";
  }, [detailQuery.data]);
  const retryMutation = useMutation({ mutationFn: () => retrySettlementImport(importId as number), onSuccess: async (response) => { const summary = asRecord(asRecord(response.data).summary); toast.success("Import retry tamamlandı"); await invalidateOpsQueries(queryClient, [["ops", "settlement-import", importId], ["ops", "settlement-imports"], ["ops", "settlement-dashboard"], ["ops", "settlement-records"]]); await detailQuery.refetch(); setRetryMessage(`Retry tamamlandı. created=${summary.created_records ?? "-"}, processed=${summary.processed_records ?? "-"}.`); }, onError: (error) => { const message = getApiErrorMessage(error); setRetryMessage(`Retry başarısız: ${message}`); toast.error(message); } });

  return (
    <OpsPageShell title="Settlement import detay" description="Import summary, preview records ve retry aksiyonu.">
      {importId === null ? <ErrorState title="Geçersiz import" description="URL içindeki importId değeri okunamadı." /> : null}
      <OpsLinkRow links={importId ? [{ href: "/ops/settlement/importlar", label: "Import listesi" }, { href: "/ops/settlement/kayitlar", label: "Record listesi" }] : []} />
      {retryMessage ? <OpsActionResult tone={retryMessage.startsWith("Retry başarısız") ? "danger" : "success"} title="Retry sonucu" description={retryMessage} /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="Import detayı yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
        <>
          <div className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between"><div className="space-y-2"><div className="flex flex-wrap gap-2"><OpsStatus label={detailQuery.data.import.applied_status} /><OpsStatus label={detailQuery.data.import.parse_status} /></div>{retryBlockedReason ? <p className="text-xs text-amber-700">{retryBlockedReason}</p> : null}</div><button disabled={retryMutation.isPending || Boolean(retryBlockedReason)} onClick={() => retryMutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">{retryMutation.isPending ? "Retry çalışıyor..." : "Retry import"}</button></div>
          <OpsKeyValueGrid items={[
            { label: "Original filename", value: detailQuery.data.import.original_filename || "-" },
            { label: "Checksum", value: detailQuery.data.import.checksum_sha256 || "-" },
            { label: "Imported by", value: detailQuery.data.import.imported_by_username || detailQuery.data.import.imported_by_label || "-" },
            { label: "Error", value: detailQuery.data.import.error_message || "-" },
          ]} />
          {detailQuery.data.records_preview.length > 0 ? <OpsTable columns={["Record", "Match", "Review", "Aksiyon"]}>{detailQuery.data.records_preview.map((record) => <tr key={record.id}><OpsCell><p className="font-medium">#{record.id}</p><p className="text-xs text-zinc-500">provider ref: {record.provider_reference || "-"}</p></OpsCell><OpsCell><p>{record.match_type || "-"}</p><p className="text-xs text-zinc-500">{record.unmatched_reason_label || "-"}</p></OpsCell><OpsCell><div className="flex flex-wrap gap-2"><OpsStatus label={record.review_status} /><OpsStatus label={record.is_processed ? "PROCESSED" : "OPEN"} /></div></OpsCell><OpsCell><Link href={`/ops/settlement/kayitlar/${record.id}`} className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium">Record detay</Link></OpsCell></tr>)}</OpsTable> : <OpsEmpty title="Preview kaydı yok" description="Bu import için gösterilecek preview satırı yok." />}
        </>
      ) : null}
    </OpsPageShell>
  );
}
