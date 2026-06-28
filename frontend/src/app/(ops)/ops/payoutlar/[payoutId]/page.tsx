"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { OpsActionResult, OpsJsonCard, OpsKeyValueGrid, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { AmountText } from "@/components/ui/amount-text";
import { buttonClassName } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getPayoutDetail } from "@/features/ops-console/api";
import { normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

export default function OpsPayoutDetailPage() {
  const params = useParams<{ payoutId: string }>();
  const payoutId = normalizeOpsId(params.payoutId);
  const payoutQuery = useQuery({
    queryKey: ["ops", "payout", payoutId],
    queryFn: () => getPayoutDetail(payoutId as number),
    enabled: payoutId !== null,
  });

  return (
    <OpsPageShell
      title="Hakediş detayı"
      description="Ödeme kaydının tutarını, işletmesini, sağlayıcı referanslarını ve onay öncesi kontrol noktalarını inceleyin."
    >
      {payoutId === null ? <ErrorState title="Geçersiz ödeme kaydı" description="URL içindeki ödeme kaydı numarası okunamadı." /> : null}
      <OpsLinkRow links={payoutId ? [{ href: "/ops/payoutlar", label: "Hakediş listesi" }] : []} />
      {payoutQuery.isPending ? <LoadingSkeleton /> : null}
      {payoutQuery.isError ? <ErrorState title="Hakediş detayı yüklenemedi" description={getApiErrorMessage(payoutQuery.error)} /> : null}
      {payoutQuery.data ? (
        <>
          <Card variant="surface">
            <CardContent className="space-y-5" padding="lg">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-zinc-950">Hakediş #{payoutQuery.data.id}</h2>
                    <OpsStatus label={payoutQuery.data.status} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    İşletme #{payoutQuery.data.business} için oluşturulan ödeme kaydı. Onay vermeden önce tutar, işletme ve sağlayıcı
                    referansının ödeme kanıtıyla eşleştiğinden emin olun.
                  </p>
                  <div className="mt-3 text-2xl font-semibold">
                    <AmountText amount={payoutQuery.data.amount} currency={payoutQuery.data.currency} />
                  </div>
                </div>
                <Link href={`/ops/payoutlar/${payoutQuery.data.id}/confirm`} className={buttonClassName({ size: "md" })}>
                  Ödeme onayı ekranı
                </Link>
              </div>

              <OpsActionResult
                tone="warning"
                title="Onay öncesi finans kontrolü"
                description="Yanlış onay finansal tutarsızlık yaratabilir. Sağlayıcı referansı, ödeme tutarı ve işletme numarası eşleşmeden manuel onay vermeyin."
              />
            </CardContent>
          </Card>

          <OpsKeyValueGrid
            items={[
              { label: "İşletme", value: `#${payoutQuery.data.business}` },
              { label: "Para birimi", value: payoutQuery.data.currency },
              { label: "Sağlayıcı referansı", value: payoutQuery.data.provider_reference || "-" },
              { label: "Sağlayıcı ödeme numarası", value: payoutQuery.data.provider_payout_id || "-" },
              { label: "Idempotency anahtarı", value: payoutQuery.data.idempotency_key || "-" },
              { label: "Sağlayıcı kalem referansı", value: payoutQuery.data.provider_item_reference_code || "-" },
            ]}
          />

          <div className="grid gap-6 xl:grid-cols-2">
            <OpsKeyValueGrid
              items={[
                { label: "Gönderim denemesi", value: payoutQuery.data.attempt_count },
                { label: "Durum sorgu denemesi", value: payoutQuery.data.status_sync_attempt_count },
                { label: "Sonraki yeniden deneme", value: formatDateTime(payoutQuery.data.next_retry_at) },
                { label: "Son hata kodu", value: payoutQuery.data.last_error_code || "-" },
                { label: "Son hata zamanı", value: formatDateTime(payoutQuery.data.last_error_at) },
                { label: "Sağlayıcı hata mesajı", value: payoutQuery.data.provider_error || "-" },
              ]}
            />
            <OpsKeyValueGrid
              items={[
                { label: "Oluşturulma", value: formatDateTime(payoutQuery.data.created_at) },
                { label: "Gönderilme", value: formatDateTime(payoutQuery.data.sent_at) },
                { label: "Onaylanma", value: formatDateTime(payoutQuery.data.confirmed_at) },
                { label: "Batch", value: payoutQuery.data.batch || "-" },
              ]}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <OpsJsonCard
              title="Ödeme gönderimi teknik kaydı"
              value={safeJsonStringify(payoutQuery.data.provider_dispatch_payload)}
              description="Sağlayıcıya gönderilen ödeme hazırlığı yanıtı. Gerektiğinde teknik inceleme için korunur."
            />
            <OpsJsonCard
              title="Sağlayıcı durum yanıtı"
              value={safeJsonStringify(payoutQuery.data.provider_status_payload)}
              description="Sağlayıcıdan gelen son durum yanıtı. Ödeme kanıtı ve referans kontrolünde yardımcı olabilir."
            />
          </div>
        </>
      ) : null}
    </OpsPageShell>
  );
}
