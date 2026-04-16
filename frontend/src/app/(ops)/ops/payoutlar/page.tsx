"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { AmountText } from "@/components/ui/amount-text";
import { QueryState } from "@/components/ui/query-state";
import { OpsCell, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { listPayouts } from "@/features/ops-console/api";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

export default function OpsPayoutListPage() {
  const payoutsQuery = useQuery({ queryKey: ["ops", "payouts"], queryFn: listPayouts });

  return (
    <OpsPageShell title="Payout listesi" description="Payout detail, confirm ve dispatch akışlarının giriş ekranı.">
      <QueryState isPending={payoutsQuery.isPending} isError={payoutsQuery.isError} error={payoutsQuery.error} data={payoutsQuery.data} errorTitle="Payout listesi yüklenemedi" errorDescription={getApiErrorMessage(payoutsQuery.error)} emptyTitle="Payout bulunamadı" emptyDescription="Ops payout listesi şu an boş dönüyor." isEmpty={(items) => items.length === 0}>
        {(items) => (
          <OpsTable columns={["Payout", "Business", "Amount", "Retry", "Aksiyon"]}>
            {items.map((item) => (
              <tr key={item.id}>
                <OpsCell><div><p className="font-medium">#{item.id}</p><p className="text-xs text-zinc-500">{item.provider_reference || "ref yok"}</p></div></OpsCell>
                <OpsCell><div className="space-y-1"><p>{item.business}</p><OpsStatus label={item.status} /></div></OpsCell>
                <OpsCell><AmountText amount={item.amount} currency={item.currency} /></OpsCell>
                <OpsCell><p>{item.attempt_count}</p><p className="text-xs text-zinc-500">{formatDateTime(item.next_retry_at)}</p></OpsCell>
                <OpsCell><div className="flex flex-wrap gap-2"><Link href={`/ops/payoutlar/${item.id}`} className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium">Detay</Link><Link href={`/ops/payoutlar/${item.id}/confirm`} className="rounded-xl bg-zinc-950 px-3 py-2 text-xs font-medium text-white">Confirm</Link></div></OpsCell>
              </tr>
            ))}
          </OpsTable>
        )}
      </QueryState>
      <div className="flex justify-end"><Link href="/ops/payoutlar/dispatch" className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">Dispatch ekranı</Link></div>
    </OpsPageShell>
  );
}
