"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsActionResult, OpsCell, OpsEmpty, OpsLinkRow, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { listSettlementImports, uploadSettlementFile } from "@/features/ops-console/api";
import { asNumber, asRecord, invalidateOpsQueries } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

export default function OpsSettlementImportsPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const importsQuery = useQuery({ queryKey: ["ops", "settlement-imports"], queryFn: () => listSettlementImports({}) });
  const uploadMutation = useMutation({
    mutationFn: () => file ? uploadSettlementFile(file) : Promise.reject(new Error("CSV dosyası seçin")),
    onSuccess: async (response) => {
      const data = asRecord(response.data);
      const importRecord = asRecord(data.import);
      setLastResult(`Import işlendi. import_id=${asNumber(importRecord.id, 0) || "?"}, processed=${asNumber(asRecord(data.summary).processed_records, 0)}.`);
      toast.success("Settlement import tamamlandı");
      setFile(null);
      await invalidateOpsQueries(queryClient, [["ops", "settlement-imports"], ["ops", "settlement-dashboard"]]);
      await importsQuery.refetch();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult(`Import başarısız: ${message}`);
      toast.error(message);
    },
  });

  return (
    <OpsPageShell title="Settlement importlar" description="CSV yükleme, import geçmişi ve detail/retry giriş noktası.">
      <OpsLinkRow links={[{ href: "/ops/settlement", label: "Settlement dashboard" }, { href: "/ops/settlement/kayitlar", label: "Record listesi" }]} />
      {lastResult ? <OpsActionResult tone={lastResult.startsWith("Import başarısız") ? "danger" : "success"} title="Import sonucu" description={lastResult} /> : null}
      <Card>
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm" />
          <button disabled={!file || uploadMutation.isPending} onClick={() => uploadMutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">{uploadMutation.isPending ? "İşleniyor..." : "Upload et ve işle"}</button>
          <p className="text-xs text-zinc-500">Seçili dosya: {file?.name || "-"}</p>
        </CardContent>
      </Card>
      {importsQuery.isPending ? <LoadingSkeleton /> : null}
      {importsQuery.isError ? <ErrorState title="Import listesi yüklenemedi" description={getApiErrorMessage(importsQuery.error)} /> : null}
      {importsQuery.data ? importsQuery.data.results.length > 0 ? <OpsTable columns={["Import", "Status", "Özet", "Aksiyon"]}>{importsQuery.data.results.map((item) => <tr key={item.id}><OpsCell><p className="font-medium">#{item.id} · {item.original_filename || item.source_label || "-"}</p><p className="text-xs text-zinc-500">{formatDateTime(item.imported_at)}</p></OpsCell><OpsCell><div className="flex flex-wrap gap-2"><OpsStatus label={item.parse_status} /><OpsStatus label={item.applied_status} /></div></OpsCell><OpsCell><p>rows: {item.total_rows}</p><p>processed: {item.processed_records}</p><p>unmatched: {item.unmatched_records}</p></OpsCell><OpsCell><Link href={`/ops/settlement/importlar/${item.id}`} className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium">Detay</Link></OpsCell></tr>)}</OpsTable> : <OpsEmpty title="Import kaydı yok" description="Henüz settlement import yüklenmemiş." /> : null}
    </OpsPageShell>
  );
}
