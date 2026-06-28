"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsCell, OpsEmpty, OpsKeyValueGrid, OpsLinkRow, OpsPageShell, OpsSectionCard, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { Button, buttonClassName } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getSettlementImportDetail, retrySettlementImport } from "@/features/ops-console/api";
import { asNumber, asRecord, invalidateOpsQueries, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";

type RetryResult = {
  tone: "success" | "danger";
  title: string;
  description: string;
};

export default function OpsSettlementImportDetailPage() {
  const params = useParams<{ importId: string }>();
  const importId = normalizeOpsId(params.importId);
  const queryClient = useQueryClient();
  const [retryMessage, setRetryMessage] = useState<RetryResult | null>(null);
  const detailQuery = useQuery({
    queryKey: ["ops", "settlement-import", importId],
    queryFn: () => getSettlementImportDetail(importId as number),
    enabled: importId !== null,
  });

  const retryBlockedReason = useMemo(() => {
    const appliedStatus = String(detailQuery.data?.import.applied_status || "").toUpperCase();
    if (!detailQuery.data) return "";
    if (appliedStatus === "APPLIED") {
      return "Bu içe aktarım uygulanmış durumda. Aynı dosyayı yeniden denemek finansal kayıt algısını yanıltabileceği için buton kapatıldı.";
    }
    return "";
  }, [detailQuery.data]);

  const retryMutation = useMutation({
    mutationFn: () => retrySettlementImport(importId as number),
    onSuccess: async (response) => {
      const summary = asRecord(asRecord(response.data).summary);
      toast.success("İçe aktarım yeniden denendi");
      await invalidateOpsQueries(queryClient, [["ops", "settlement-import", importId], ["ops", "settlement-imports"], ["ops", "settlement-dashboard"], ["ops", "settlement-records"]]);
      await detailQuery.refetch();
      setRetryMessage({
        tone: "success",
        title: "Yeniden deneme tamamlandı",
        description: `Oluşturulan kayıt: ${asNumber(summary.created_records)} · İşlenen kayıt: ${asNumber(summary.processed_records)}.`,
      });
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setRetryMessage({ tone: "danger", title: "Yeniden deneme başarısız", description: message });
      toast.error(message);
    },
  });

  const recordSummary = asRecord(detailQuery.data?.record_summary);

  return (
    <OpsPageShell
      title="İçe aktarım detayı"
      description="Sağlayıcı dökümünün nasıl okunduğunu, kaç kaydın işlendiğini ve hangi satırların inceleme gerektirdiğini görün."
    >
      {importId === null ? <ErrorState title="Geçersiz içe aktarım" description="URL içindeki içe aktarım numarası okunamadı." /> : null}
      <OpsLinkRow
        links={
          importId
            ? [
                { href: "/ops/settlement/importlar", label: "İçe aktarım listesi" },
                { href: "/ops/settlement/kayitlar", label: "Kayıt listesi" },
              ]
            : []
        }
      />
      {retryMessage ? <OpsActionResult tone={retryMessage.tone} title={retryMessage.title} description={retryMessage.description} /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="İçe aktarım detayı yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
        <>
          <OpsSectionCard
            title={`İçe aktarım #${detailQuery.data.import.id}`}
            description="Durumlar sağlayıcı dosyasının okunma ve sistem kayıtlarına uygulanma aşamasını gösterir."
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <OpsStatus label={detailQuery.data.import.applied_status} />
                  <OpsStatus label={detailQuery.data.import.parse_status} />
                </div>
                {retryBlockedReason ? <p className="text-sm leading-6 text-amber-700">{retryBlockedReason}</p> : null}
              </div>
              <Button
                disabled={retryMutation.isPending || Boolean(retryBlockedReason)}
                onClick={() => retryMutation.mutate()}
                loading={retryMutation.isPending}
                loadingText="Yeniden deneniyor..."
              >
                İçe aktarımı yeniden dene
              </Button>
            </div>
          </OpsSectionCard>

          <OpsKeyValueGrid
            items={[
              { label: "Dosya adı", value: detailQuery.data.import.original_filename || "-" },
              { label: "Sağlayıcı", value: detailQuery.data.import.provider || "-" },
              { label: "Kaynak türü", value: detailQuery.data.import.source_type || "-" },
              { label: "İçe aktaran", value: detailQuery.data.import.imported_by_username || detailQuery.data.import.imported_by_label || "-" },
              { label: "İçe aktarım zamanı", value: formatDateTime(detailQuery.data.import.imported_at) },
              { label: "Tamamlanma zamanı", value: formatDateTime(detailQuery.data.import.completed_at) },
              { label: "Dosya kontrol izi", value: detailQuery.data.import.checksum_sha256 || "-" },
              { label: "Hata mesajı", value: detailQuery.data.import.error_message || "-" },
            ]}
          />

          <OpsSectionCard title="İşlem kırılımı" description="Dosyanın kaç satırının işlendiğini ve kaç satırın manuel inceleme gerektirdiğini gösterir.">
            <OpsTable columns={["Alan", "Toplam"]}>
              <tr>
                <OpsCell>Toplam satır</OpsCell>
                <OpsCell>{detailQuery.data.import.total_rows}</OpsCell>
              </tr>
              <tr>
                <OpsCell>Oluşturulan kayıt</OpsCell>
                <OpsCell>{detailQuery.data.import.created_records}</OpsCell>
              </tr>
              <tr>
                <OpsCell>İşlenen kayıt</OpsCell>
                <OpsCell>{detailQuery.data.import.processed_records}</OpsCell>
              </tr>
              <tr>
                <OpsCell>Eşleşmeyen kayıt</OpsCell>
                <OpsCell>{detailQuery.data.import.unmatched_records}</OpsCell>
              </tr>
              {Object.entries(recordSummary).slice(0, 4).map(([key, value]) => (
                <tr key={key}>
                  <OpsCell>{key.replace(/_/g, " ")}</OpsCell>
                  <OpsCell>{asNumber(value)}</OpsCell>
                </tr>
              ))}
            </OpsTable>
          </OpsSectionCard>

          {detailQuery.data.records_preview.length > 0 ? (
            <OpsTable columns={["Kayıt", "Tutar / referans", "Eşleşme", "İnceleme", "Aksiyon"]}>
              {detailQuery.data.records_preview.map((record) => (
                <tr key={record.id}>
                  <OpsCell>
                    <p className="font-semibold text-zinc-950">Kayıt #{record.id}</p>
                    <p className="text-xs text-zinc-500">Satır: {record.row_number || "-"}</p>
                  </OpsCell>
                  <OpsCell>
                    <p>{formatCurrency(record.amount, record.currency)}</p>
                    <p className="break-words text-xs text-zinc-500">Sağlayıcı referansı: {record.provider_reference || "-"}</p>
                  </OpsCell>
                  <OpsCell>
                    <p>{record.match_type || "Eşleşme bilgisi yok"}</p>
                    <p className="text-xs text-zinc-500">{record.unmatched_reason_label || "-"}</p>
                  </OpsCell>
                  <OpsCell>
                    <div className="flex flex-wrap gap-2">
                      <OpsStatus label={record.review_status} />
                      <OpsStatus label={record.is_processed ? "PROCESSED" : "OPEN"} />
                    </div>
                  </OpsCell>
                  <OpsCell>
                    <Link href={`/ops/settlement/kayitlar/${record.id}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                      Kayıt detayı
                    </Link>
                  </OpsCell>
                </tr>
              ))}
            </OpsTable>
          ) : (
            <OpsEmpty title="Ön izleme kaydı yok" description="Bu içe aktarım için gösterilecek mutabakat satırı bulunamadı." />
          )}
        </>
      ) : null}
    </OpsPageShell>
  );
}
