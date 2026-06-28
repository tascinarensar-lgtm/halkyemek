"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsCell, OpsEmpty, OpsLinkRow, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { listSettlementImports, uploadSettlementFile } from "@/features/ops-console/api";
import { asNumber, asRecord, invalidateOpsQueries } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

type ResultState = {
  tone: "success" | "danger";
  title: string;
  description: string;
};

export default function OpsSettlementImportsPage() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [lastResult, setLastResult] = useState<ResultState | null>(null);
  const importsQuery = useQuery({ queryKey: ["ops", "settlement-imports"], queryFn: () => listSettlementImports({}) });

  const uploadMutation = useMutation({
    mutationFn: () => (file ? uploadSettlementFile(file) : Promise.reject(new Error("Lütfen CSV dosyası seçin."))),
    onSuccess: async (response) => {
      const data = asRecord(response.data);
      const importRecord = asRecord(data.import);
      const summary = asRecord(data.summary);
      setLastResult({
        tone: "success",
        title: "Sağlayıcı dökümü işlendi",
        description: `İçe aktarım #${asNumber(importRecord.id, 0) || "?"} oluşturuldu. İşlenen kayıt: ${asNumber(summary.processed_records, 0)}.`,
      });
      toast.success("Mutabakat dosyası işlendi");
      setFile(null);
      await invalidateOpsQueries(queryClient, [["ops", "settlement-imports"], ["ops", "settlement-dashboard"]]);
      await importsQuery.refetch();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "İçe aktarım başarısız", description: message });
      toast.error(message);
    },
  });

  return (
    <OpsPageShell
      title="Sağlayıcı dökümü içe aktarımları"
      description="Ödeme sağlayıcısından gelen CSV dosyalarını yükleyin, işlenme durumunu ve eşleşmeyen kayıtları takip edin."
    >
      <OpsLinkRow links={[{ href: "/ops/settlement", label: "Mutabakat merkezi" }, { href: "/ops/settlement/kayitlar", label: "Kayıt listesi" }]} />
      {lastResult ? <OpsActionResult tone={lastResult.tone} title={lastResult.title} description={lastResult.description} /> : null}

      <Card variant="surface">
        <CardContent className="space-y-5" padding="lg">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Yeni sağlayıcı dosyası yükle</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              CSV dosyası yüklendiğinde sistem satırları okur, ödeme kayıtlarıyla karşılaştırır ve eşleşmeyenleri inceleme listesine alır.
            </p>
          </div>
          <OpsActionResult
            tone="warning"
            title="Dosya kaynağını kontrol edin"
            description="Yanlış sağlayıcı dosyası yüklemek mutabakat sonucunu yanıltabilir. Dosya tarihi, sağlayıcı ve içerik kontrolünden sonra yükleme yapın."
          />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="space-y-1">
              <span className="text-sm font-medium text-[var(--hy-color-neutral-800)]">CSV dosyası</span>
              <input type="file" accept=".csv" onChange={(event) => setFile(event.target.files?.[0] || null)} className="w-full text-sm" />
              <span className="block text-xs text-[var(--hy-color-neutral-500)]">Seçili dosya: {file?.name || "-"}</span>
            </label>
            <Button
              disabled={!file || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
              loading={uploadMutation.isPending}
              loadingText="Dosya işleniyor..."
            >
              Dosyayı içe aktar
            </Button>
          </div>
        </CardContent>
      </Card>

      {importsQuery.isPending ? <LoadingSkeleton /> : null}
      {importsQuery.isError ? <ErrorState title="İçe aktarım listesi yüklenemedi" description={getApiErrorMessage(importsQuery.error)} /> : null}
      {importsQuery.data ? (
        importsQuery.data.results.length > 0 ? (
          <OpsTable columns={["İçe aktarım", "Durum", "İşlem özeti", "Aksiyon"]}>
            {importsQuery.data.results.map((item) => (
              <tr key={item.id}>
                <OpsCell>
                  <div className="min-w-[260px]">
                    <p className="font-semibold text-zinc-950">#{item.id} · {item.original_filename || item.source_label || "Dosya adı yok"}</p>
                    <p className="text-xs text-zinc-500">İçe aktarım: {formatDateTime(item.imported_at)}</p>
                    <p className="text-xs text-zinc-500">Sağlayıcı: {item.provider || "-"}</p>
                  </div>
                </OpsCell>
                <OpsCell>
                  <div className="flex min-w-[180px] flex-wrap gap-2">
                    <OpsStatus label={item.parse_status} />
                    <OpsStatus label={item.applied_status} />
                  </div>
                </OpsCell>
                <OpsCell>
                  <div className="min-w-[190px] text-sm text-zinc-700">
                    <p>Toplam satır: {item.total_rows}</p>
                    <p>İşlenen: {item.processed_records}</p>
                    <p>Eşleşmeyen: {item.unmatched_records}</p>
                    <p>Hatalı: {item.failed_records}</p>
                  </div>
                </OpsCell>
                <OpsCell>
                  <Link href={`/ops/settlement/importlar/${item.id}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                    Detay
                  </Link>
                </OpsCell>
              </tr>
            ))}
          </OpsTable>
        ) : (
          <OpsEmpty title="Henüz içe aktarım yok" description="Sağlayıcı ödeme dökümü yüklediğinizde geçmiş kayıtlar burada listelenecek." />
        )
      ) : null}
    </OpsPageShell>
  );
}
