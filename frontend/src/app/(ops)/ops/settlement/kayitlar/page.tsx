"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { OpsCell, OpsEmpty, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { buttonClassName } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { listSettlementRecords } from "@/features/ops-console/api";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";

const REVIEW_OPTIONS = [
  { value: "", label: "Tüm inceleme durumları" },
  { value: "OPEN", label: "Açık" },
  { value: "ACKNOWLEDGED", label: "İşleme alındı" },
  { value: "RETRY_SCHEDULED", label: "Yeniden deneme planlandı" },
  { value: "RESOLVED", label: "Çözüldü" },
];

export default function OpsSettlementRecordsPage() {
  const [reviewStatus, setReviewStatus] = useState("");
  const recordsQuery = useQuery({
    queryKey: ["ops", "settlement-records", reviewStatus],
    queryFn: () => listSettlementRecords({ review_status: reviewStatus || undefined }),
  });

  return (
    <OpsPageShell
      title="Mutabakat kayıtları"
      description="Sağlayıcı ödeme dökümü satırlarının PaymentIntent, işletme, hakediş ve ödeme kayıtlarıyla eşleşme durumunu inceleyin."
    >
      <Card variant="surface">
        <CardContent className="space-y-4" padding="lg">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">İnceleme filtresi</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Açık veya eşleşmeyen kayıtları filtreleyerek finansal kontrol gerektiren satırlara hızlıca ulaşabilirsiniz.
            </p>
          </div>
          <select
            value={reviewStatus}
            onChange={(event) => setReviewStatus(event.target.value)}
            className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950 sm:w-auto"
          >
            {REVIEW_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      {recordsQuery.isPending ? <LoadingSkeleton /> : null}
      {recordsQuery.isError ? <ErrorState title="Mutabakat kayıtları yüklenemedi" description={getApiErrorMessage(recordsQuery.error)} /> : null}
      {recordsQuery.data ? (
        recordsQuery.data.results.length > 0 ? (
          <OpsTable columns={["Kayıt", "Tutar / referans", "Bağlantılı kayıtlar", "Eşleşme", "Aksiyon"]}>
            {recordsQuery.data.results.map((record) => (
              <tr key={record.id}>
                <OpsCell>
                  <div className="min-w-[170px]">
                    <p className="font-semibold text-zinc-950">Kayıt #{record.id}</p>
                    <p className="text-xs text-zinc-500">İçe aktarım: {record.import_id || "-"}</p>
                    <p className="text-xs text-zinc-500">Oluşturulma: {formatDateTime(record.created_at)}</p>
                  </div>
                </OpsCell>
                <OpsCell>
                  <div className="min-w-[230px]">
                    <p>{formatCurrency(record.amount, record.currency)}</p>
                    <p className="break-words text-xs text-zinc-500">Sağlayıcı referansı: {record.provider_reference || "-"}</p>
                    <p className="break-words text-xs text-zinc-500">Conversation ID: {record.conversation_id || "-"}</p>
                  </div>
                </OpsCell>
                <OpsCell>
                  <div className="min-w-[180px] text-sm text-zinc-700">
                    <p>İşletme: {record.business ? `#${record.business}` : "-"}</p>
                    <p>PaymentIntent: {record.payment_intent ? `#${record.payment_intent}` : "-"}</p>
                    <p>Hakediş: {record.payout ? `#${record.payout}` : "-"}</p>
                  </div>
                </OpsCell>
                <OpsCell>
                  <div className="min-w-[210px] space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <OpsStatus label={record.review_status} />
                      <OpsStatus label={record.is_processed ? "PROCESSED" : "OPEN"} />
                    </div>
                    <p className="text-sm">{record.match_type || "Eşleşme bilgisi yok"}</p>
                    <p className="text-xs text-zinc-500">{record.unmatched_reason_label || record.processing_error || "-"}</p>
                  </div>
                </OpsCell>
                <OpsCell>
                  <Link href={`/ops/settlement/kayitlar/${record.id}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                    Detay
                  </Link>
                </OpsCell>
              </tr>
            ))}
          </OpsTable>
        ) : (
          <OpsEmpty
            title="Eşleşen mutabakat kaydı yok"
            description="Seçili filtreyle görüntülenecek kayıt bulunamadı. Filtreyi temizleyerek tüm kayıtları görebilirsiniz."
          />
        )
      ) : null}
    </OpsPageShell>
  );
}
