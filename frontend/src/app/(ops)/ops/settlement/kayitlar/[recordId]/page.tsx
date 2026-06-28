"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  OpsActionResult,
  OpsJsonCard,
  OpsKeyValueGrid,
  OpsLinkRow,
  OpsPageShell,
  OpsSectionCard,
  OpsStatus,
} from "@/components/ops-console/shared";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getSettlementRecordDetail, reprocessSettlementRecord, reviewSettlementRecord } from "@/features/ops-console/api";
import { asRecord, invalidateOpsQueries, isSettlementReviewEditable, normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";

type ResultState = {
  tone: "success" | "danger";
  title: string;
  description: string;
};

const REVIEW_OPTIONS = [
  { value: "OPEN", label: "Açık" },
  { value: "ACKNOWLEDGED", label: "İşleme alındı" },
  { value: "RETRY_SCHEDULED", label: "Yeniden deneme planlandı" },
  { value: "RESOLVED", label: "Çözüldü" },
];

export default function OpsSettlementRecordDetailPage() {
  const params = useParams<{ recordId: string }>();
  const recordId = normalizeOpsId(params.recordId);
  const queryClient = useQueryClient();
  const [reviewStatus, setReviewStatus] = useState("ACKNOWLEDGED");
  const [operatorNote, setOperatorNote] = useState("");
  const [lastResult, setLastResult] = useState<ResultState | null>(null);

  const detailQuery = useQuery({
    queryKey: ["ops", "settlement-record", recordId],
    queryFn: () => getSettlementRecordDetail(recordId as number),
    enabled: recordId !== null,
  });

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

  const reprocessMutation = useMutation({
    mutationFn: () => reprocessSettlementRecord(recordId as number),
    onSuccess: async (response) => {
      const data = asRecord(response.data);
      setLastResult({
        tone: "success",
        title: "Kayıt yeniden işlendi",
        description: `İşlendi: ${String(data.processed ?? false)} · Sonraki aksiyon: ${String(data.next_action ?? "-")}.`,
      });
      toast.success("Mutabakat kaydı yeniden işlendi");
      await refresh();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "Yeniden işleme başarısız", description: message });
      toast.error(message);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () => reviewSettlementRecord(recordId as number, { review_status: reviewStatus, operator_note: operatorNote }),
    onSuccess: async () => {
      setLastResult({
        tone: "success",
        title: "İnceleme durumu güncellendi",
        description: `Yeni inceleme durumu: ${reviewStatus}.`,
      });
      toast.success("İnceleme durumu güncellendi");
      await refresh();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "İnceleme güncellenemedi", description: message });
      toast.error(message);
    },
  });

  const reviewLockedMessage = useMemo(() => {
    if (!detailQuery.data) return "";
    if (!isSettlementReviewEditable(reviewMutation.isPending || reprocessMutation.isPending, canReview)) {
      return "Backend bu kayıt için inceleme aksiyonunu şu anda kapalı tutuyor.";
    }
    if (!reviewDirty) {
      return "Kaydedilecek yeni inceleme değişikliği yok.";
    }
    return "";
  }, [canReview, detailQuery.data, reviewDirty, reviewMutation.isPending, reprocessMutation.isPending]);

  return (
    <OpsPageShell
      title="Mutabakat kayıt detayı"
      description="Tek bir sağlayıcı dökümü satırının sistem kayıtlarıyla eşleşmesini, manuel inceleme notunu ve yeniden işleme aksiyonunu yönetin."
    >
      {recordId === null ? <ErrorState title="Geçersiz kayıt" description="URL içindeki kayıt numarası okunamadı." /> : null}
      <OpsLinkRow links={recordId ? [{ href: "/ops/settlement/kayitlar", label: "Kayıt listesi" }] : []} />
      {lastResult ? <OpsActionResult tone={lastResult.tone} title={lastResult.title} description={lastResult.description} /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="Mutabakat kayıt detayı yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
        <>
          <OpsSectionCard title={`Kayıt #${detailQuery.data.record.id}`} description="Durum rozetleri kayıt üzerindeki güncel inceleme, aksiyon ve işlenme bilgisini gösterir.">
            <div className="flex flex-wrap gap-2">
              <OpsStatus label={detailQuery.data.record.review_status} />
              <OpsStatus label={detailQuery.data.record.next_action || "-"} />
              <OpsStatus label={detailQuery.data.record.is_processed ? "PROCESSED" : "OPEN"} />
              {operatorFlags.stale_manual_review ? <OpsStatus label="STALE_MANUAL_REVIEW" /> : null}
            </div>
          </OpsSectionCard>

          <div className="grid gap-6 xl:grid-cols-2">
            <OpsKeyValueGrid
              items={[
                { label: "Tutar", value: formatCurrency(detailQuery.data.record.amount, detailQuery.data.record.currency) },
                { label: "Sağlayıcı", value: detailQuery.data.record.provider || "-" },
                { label: "Sağlayıcı referansı", value: detailQuery.data.record.provider_reference || "-" },
                { label: "Conversation ID", value: detailQuery.data.record.conversation_id || "-" },
                { label: "Sağlayıcı ödeme dökümü referansı", value: detailQuery.data.record.settlement_reference_code || "-" },
                { label: "Alt üye işyeri anahtarı", value: detailQuery.data.record.submerchant_key || "-" },
              ]}
            />
            <OpsKeyValueGrid
              items={[
                { label: "İçe aktarım", value: detailQuery.data.record.import_id ? `#${detailQuery.data.record.import_id}` : "-" },
                { label: "İşletme", value: detailQuery.data.record.business ? `#${detailQuery.data.record.business}` : "-" },
                { label: "Sipariş", value: detailQuery.data.record.order ? `#${detailQuery.data.record.order}` : "-" },
                { label: "PaymentIntent", value: detailQuery.data.record.payment_intent ? `#${detailQuery.data.record.payment_intent}` : "-" },
                { label: "Ödeme kaydı", value: detailQuery.data.record.payout ? `#${detailQuery.data.record.payout}` : "-" },
                { label: "Hakediş durumu", value: detailQuery.data.record.payout_status || "-" },
              ]}
            />
          </div>

          <OpsKeyValueGrid
            items={[
              { label: "Eşleşme tipi", value: detailQuery.data.record.match_type || "-" },
              { label: "Eşleşmeme nedeni", value: detailQuery.data.record.unmatched_reason_label || detailQuery.data.record.unmatched_reason_code || "-" },
              { label: "PaymentIntent durumu", value: detailQuery.data.record.payment_intent_status || "-" },
              { label: "İşlenme zamanı", value: formatDateTime(detailQuery.data.record.processed_at) },
              { label: "Son yeniden deneme", value: formatDateTime(detailQuery.data.record.last_retry_at) },
              { label: "Sonraki yeniden deneme", value: formatDateTime(detailQuery.data.record.next_retry_at) },
            ]}
          />

          <div className="grid gap-6 xl:grid-cols-2">
            <OpsSectionCard
              title="Manuel inceleme"
              description="Bu alan finans ekibinin kayda dair kararını ve notunu tutar. Backend izin vermiyorsa işlem kapalı kalır."
            >
              {reviewLockedMessage ? (
                <OpsActionResult tone={reviewDirty ? "default" : "warning"} title="İnceleme koruması" description={reviewLockedMessage} />
              ) : null}
              <select
                value={reviewStatus}
                onChange={(event) => setReviewStatus(event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
              >
                {REVIEW_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <textarea
                value={operatorNote}
                onChange={(event) => setOperatorNote(event.target.value)}
                placeholder="Örn. Sağlayıcı referansı ödeme kaydıyla eşleşti, açık sorun yok."
                className="min-h-28 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
              />
              <Button
                disabled={Boolean(reviewLockedMessage)}
                onClick={() => reviewMutation.mutate()}
                loading={reviewMutation.isPending}
                loadingText="Kaydediliyor..."
              >
                İncelemeyi kaydet
              </Button>
            </OpsSectionCard>

            <OpsJsonCard
              title="Kayıt yaşam döngüsü"
              description="Yeniden işleme öncesi ve sonrası teknik olay zinciri. İnceleme gerektiğinde teknik ekip için korunur."
              value={safeJsonStringify(detailQuery.data.record.lifecycle_events || [])}
            />
          </div>

          {canReprocess ? (
            <OpsActionResult
              tone="warning"
              title="Yeniden işleme aksiyonu"
              description="Bu aksiyon mevcut kaydı sistem eşleşme kurallarıyla tekrar işler. Domain mantığı backend tarafından korunur; emin olmadan çalıştırmayın."
            />
          ) : (
            <OpsActionResult tone="warning" title="Bu kayıt için yeniden işleme kapalı" description="Backend bu kayıt için can_reprocess=false döndürdüğü için aksiyon butonu gizlendi." />
          )}
          {canReprocess ? (
            <div>
              <Button
                disabled={reprocessMutation.isPending || reviewMutation.isPending || isProcessed}
                onClick={() => reprocessMutation.mutate()}
                loading={reprocessMutation.isPending}
                loadingText="Yeniden işleniyor..."
              >
                Kaydı yeniden işle
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
    </OpsPageShell>
  );
}
