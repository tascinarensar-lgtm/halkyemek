"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { OpsActionResult, OpsLinkRow, OpsPageShell } from "@/components/ops-console/shared";
import { dispatchPayouts } from "@/features/ops-console/api";
import { asNumber, asRecord, hasNonEmptyText, invalidateOpsQueries } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsPayoutDispatchPage() {
  const [limit, setLimit] = useState(50);
  const [worker, setWorker] = useState("ops-console");
  const [lastProcessed, setLastProcessed] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const normalizedWorker = worker.trim() || "ops-console";
  const isLimitInvalid = !Number.isFinite(limit) || limit <= 0;
  const validationMessage = useMemo(() => {
    if (!hasNonEmptyText(worker)) return "Worker adı boş bırakılamaz.";
    if (isLimitInvalid) return "Limit 1 veya daha büyük olmalı.";
    return "";
  }, [isLimitInvalid, worker]);

  const mutation = useMutation({
    mutationFn: () => dispatchPayouts(limit, normalizedWorker),
    onSuccess: async (response) => {
      const processed = asNumber(asRecord(response.data).processed);
      setLastProcessed(processed);
      setLastError(null);
      toast.success(processed > 0 ? "Dispatch job çalıştı" : "Dispatch çalıştı, işlenecek payout bulunmadı");
      await invalidateOpsQueries(queryClient, [["ops", "payouts"], ["ops", "dashboard"], ["ops", "metrics"]]);
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastError(message);
      setLastProcessed(null);
      toast.error(message);
    },
  });

  return (
    <OpsPageShell title="Dispatch due payouts" description="Due/failed payoutları ops console üzerinden tetikle.">
      <OpsLinkRow links={[{ href: "/ops/payoutlar", label: "Payout listesi" }]} />
      <OpsActionResult tone="warning" title="Yüksek riskli aksiyon" description="Dispatch tetiklemesi duplicate click ve stale liste riski doğurabileceği için istek pending iken buton kapalı tutulur; başarı sonrası payout listesi ve dashboard tekrar sorgulanır." />
      {lastError ? <OpsActionResult tone="danger" title="Dispatch başarısız" description={lastError} /> : null}
      {lastProcessed !== null ? <OpsActionResult tone={lastProcessed > 0 ? "success" : "warning"} title="Dispatch tamamlandı" description={lastProcessed > 0 ? `İşlenen payout sayısı: ${lastProcessed}. Liste ve dashboard cache’i yenilendi.` : "İstek başarılıydı fakat işlenecek due payout bulunmadı. Ekranlar yine de yeniden sorgulandı."} /> : null}
      <Card>
        <CardContent className="max-w-xl space-y-4">
          <div className="space-y-1"><p className="text-sm font-medium">Limit</p><input type="number" min={1} value={limit} onChange={(e) => setLimit(Number(e.target.value || 1))} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" /></div>
          <div className="space-y-1"><p className="text-sm font-medium">Worker</p><input value={worker} onChange={(e) => setWorker(e.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" /></div>
          {validationMessage ? <p className="text-xs text-red-600">{validationMessage}</p> : <p className="text-xs text-zinc-500">Gönderilecek worker: {normalizedWorker}</p>}
          <button disabled={mutation.isPending || Boolean(validationMessage)} onClick={() => mutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">{mutation.isPending ? "Dispatch çalışıyor..." : "Dispatch çalıştır"}</button>
        </CardContent>
      </Card>
    </OpsPageShell>
  );
}
