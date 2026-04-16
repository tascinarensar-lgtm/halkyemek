"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsActionResult, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { confirmPayout, getPayoutDetail } from "@/features/ops-console/api";
import { asRecord, canManuallyConfirmPayout, invalidateOpsQueries, isPayoutTerminalStatus, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

export default function OpsPayoutConfirmPage() {
  const params = useParams<{ payoutId: string }>();
  const queryClient = useQueryClient();
  const payoutId = normalizeOpsId(params.payoutId);
  const [note, setNote] = useState("");
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const payoutQuery = useQuery({ queryKey: ["ops", "payout", payoutId], queryFn: () => getPayoutDetail(payoutId as number), enabled: payoutId !== null });

  const payoutStatus = String(payoutQuery.data?.status || "").toUpperCase();
  const alreadyTerminal = isPayoutTerminalStatus(payoutStatus);
  const allowConfirm = canManuallyConfirmPayout(payoutStatus);

  const mutation = useMutation({
    mutationFn: () => confirmPayout(payoutId as number, note.trim()),
    onSuccess: async (response) => {
      const data = asRecord(response.data);
      const changed = Boolean(data.changed);
      const status = typeof data.status === "string" ? data.status : "CONFIRMED";
      setResultMessage(changed ? `Payout confirm tamamlandı. Yeni durum: ${status}.` : `Payout zaten daha önce işlenmiş. Son durum: ${status}.`);
      toast.success(changed ? "Payout confirm tamamlandı" : "Payout tekrar confirm edilmedi");
      await invalidateOpsQueries(queryClient, [["ops", "payout", payoutId], ["ops", "payouts"], ["ops", "dashboard"], ["ops", "metrics"]]);
      await payoutQuery.refetch();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setResultMessage(`Confirm başarısız: ${message}`);
      toast.error(message);
    },
  });

  const confirmBlockedReason = useMemo(() => {
    if (!payoutQuery.data) return "";
    if (alreadyTerminal) {
      return `Bu payout artık ${payoutStatus} statüsünde. Tekrar manual confirm gönderilmesi operatöre yanlış başarı hissi vereceği için buton kapatıldı.`;
    }
    if (!allowConfirm) {
      return `Manual confirm yalnızca gönderim sonrası veya retry incelemesi gereken payoutlarda anlamlıdır. Güncel durum: ${payoutStatus || "-"}.`;
    }
    return "";
  }, [allowConfirm, alreadyTerminal, payoutQuery.data, payoutStatus]);

  return (
    <OpsPageShell title="Payout confirm" description="Manual confirm işlemini kontrollü şekilde uygula.">
      {payoutId === null ? <ErrorState title="Geçersiz payout" description="URL içindeki payoutId değeri okunamadı." /> : null}
      <OpsLinkRow links={payoutId ? [
        { href: "/ops/payoutlar", label: "Payout listesi" },
        { href: `/ops/payoutlar/${payoutId}`, label: "Payout detayı" },
      ] : []} />
      {resultMessage ? <OpsActionResult tone={resultMessage.startsWith("Confirm başarısız") ? "danger" : resultMessage.includes("zaten") ? "warning" : "success"} title="Confirm sonucu" description={resultMessage} /> : null}
      {payoutQuery.isPending ? <LoadingSkeleton /> : null}
      {payoutQuery.isError ? <ErrorState title="Payout detayı yüklenemedi" description={getApiErrorMessage(payoutQuery.error)} /> : null}
      {payoutQuery.data ? (
        <Card>
          <CardContent className="max-w-2xl space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2"><OpsStatus label={payoutQuery.data.status} /></div>
              <p className="text-sm text-zinc-600">Payout #{payoutQuery.data.id} · business #{payoutQuery.data.business}</p>
              <p className="text-xs text-zinc-500">created_at: {formatDateTime(payoutQuery.data.created_at)} · sent_at: {formatDateTime(payoutQuery.data.sent_at)} · confirmed_at: {formatDateTime(payoutQuery.data.confirmed_at)}</p>
            </div>
            {confirmBlockedReason ? <OpsActionResult tone={alreadyTerminal ? "warning" : "default"} title="Confirm guard" description={confirmBlockedReason} /> : null}
            <div className="space-y-1"><p className="text-sm font-medium">Operator note</p><textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-32 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" placeholder="Confirm notu (opsiyonel)" /></div>
            <div className="flex gap-3">
              <button disabled={mutation.isPending || Boolean(confirmBlockedReason)} onClick={() => mutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">{mutation.isPending ? "Confirm ediliyor..." : "Confirm et"}</button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </OpsPageShell>
  );
}
