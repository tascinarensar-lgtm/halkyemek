"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsJsonCard, OpsKeyValueGrid, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { getPayoutDetail } from "@/features/ops-console/api";
import { normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsPayoutDetailPage() {
  const params = useParams<{ payoutId: string }>();
  const payoutId = normalizeOpsId(params.payoutId);
  const payoutQuery = useQuery({ queryKey: ["ops", "payout", payoutId], queryFn: () => getPayoutDetail(payoutId as number), enabled: payoutId !== null });

  return (
    <OpsPageShell title="Payout detay" description="Provider payload, retry alanları ve confirm öncesi inceleme görünümü.">
      {payoutId === null ? <ErrorState title="Geçersiz payout" description="URL içindeki payoutId değeri okunamadı." /> : null}
      {payoutQuery.isPending ? <LoadingSkeleton /> : null}
      {payoutQuery.isError ? <ErrorState title="Payout detayı yüklenemedi" description={getApiErrorMessage(payoutQuery.error)} /> : null}
      {payoutQuery.data ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2"><div className="flex flex-wrap gap-2"><OpsStatus label={payoutQuery.data.status} /></div><p className="text-sm text-zinc-600">Business #{payoutQuery.data.business} · provider ref: {payoutQuery.data.provider_reference || "-"}</p><div className="text-xl font-semibold"><AmountText amount={payoutQuery.data.amount} currency={payoutQuery.data.currency} /></div></div>
              <Link href={`/ops/payoutlar/${payoutQuery.data.id}/confirm`} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">Confirm ekranı</Link>
            </CardContent>
          </Card>
          <OpsKeyValueGrid items={[
            { label: "Provider payout id", value: payoutQuery.data.provider_payout_id || "-" },
            { label: "Attempt count", value: payoutQuery.data.attempt_count },
            { label: "Status sync attempts", value: payoutQuery.data.status_sync_attempt_count },
            { label: "Next retry at", value: payoutQuery.data.next_retry_at || "-" },
            { label: "Last error code", value: payoutQuery.data.last_error_code || "-" },
            { label: "Provider error", value: payoutQuery.data.provider_error || "-" },
          ]} />
          <div className="grid gap-6 xl:grid-cols-2">
            <OpsJsonCard title="Dispatch payload" value={safeJsonStringify(payoutQuery.data.provider_dispatch_payload)} />
            <OpsJsonCard title="Status payload" value={safeJsonStringify(payoutQuery.data.provider_status_payload)} />
          </div>
        </>
      ) : null}
    </OpsPageShell>
  );
}
