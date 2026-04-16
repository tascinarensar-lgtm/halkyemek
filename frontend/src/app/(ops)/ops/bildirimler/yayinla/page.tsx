"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { OpsActionResult, OpsLinkRow, OpsPageShell } from "@/components/ops-console/shared";
import { queueBroadcast } from "@/features/ops-console/api";
import { asNumber, hasNonEmptyText, parseJsonObjectInput } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsBroadcastPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL");
  const [district, setDistrict] = useState("");
  const [payload, setPayload] = useState("{}");
  const [lastQueued, setLastQueued] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const payloadError = useMemo(() => {
    try {
      parseJsonObjectInput(payload);
      return "";
    } catch (error) {
      return getApiErrorMessage(error);
    }
  }, [payload]);

  const targetingWarning = useMemo(() => {
    if (!hasNonEmptyText(district)) return "";
    return "District filtresi aktif business membership üstünden uygulanır. Bu yüzden district doldurulduğunda hedef kitle beklediğinizden dar olabilir.";
  }, [district]);

  const mutation = useMutation({
    mutationFn: () => queueBroadcast({ title: title.trim(), body: body.trim(), audience, district: district.trim() || undefined, payload: parseJsonObjectInput(payload) }),
    onSuccess: (data) => {
      const queued = asNumber((data as { queued?: number }).queued, 0);
      setLastQueued(queued);
      setLastError(null);
      toast.success(queued > 0 ? `Broadcast kuyruğa alındı: ${queued}` : "Broadcast kabul edildi ama hedef kullanıcı bulunmadı");
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastError(message);
      setLastQueued(null);
      toast.error(message);
    },
  });

  return (
    <OpsPageShell title="Broadcast yayınla" description="Admin broadcast endpointine title/body/audience/payload ile bağlanır.">
      <OpsLinkRow links={[{ href: "/ops", label: "Dashboard" }]} />
      {lastError ? <OpsActionResult tone="danger" title="Broadcast başarısız" description={lastError} /> : null}
      {lastQueued !== null ? <OpsActionResult tone={lastQueued > 0 ? "success" : "warning"} title="Broadcast sonucu" description={lastQueued > 0 ? `Queued user sayısı: ${lastQueued}. Tekrar submit engellendi ve sonuç görünür bırakıldı.` : "İstek başarılıydı ancak kuyruklanan kullanıcı bulunmadı. Audience/district kombinasyonunu yeniden kontrol edin."} /> : null}
      <Card>
        <CardContent className="max-w-3xl space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1"><p className="text-sm font-medium">Title</p><input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" /></div>
            <div className="space-y-1"><p className="text-sm font-medium">Audience</p><select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm"><option value="ALL">ALL</option><option value="CUSTOMERS">CUSTOMERS</option><option value="BUSINESS_MEMBERS">BUSINESS_MEMBERS</option></select></div>
          </div>
          <div className="space-y-1"><p className="text-sm font-medium">Body</p><textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-28 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" /></div>
          <div className="space-y-1"><p className="text-sm font-medium">District (opsiyonel)</p><input value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="BEYLIKDUZU" className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm" />{targetingWarning ? <p className="text-xs text-amber-700">{targetingWarning}</p> : null}</div>
          <div className="space-y-1"><p className="text-sm font-medium">Payload JSON</p><textarea value={payload} onChange={(e) => setPayload(e.target.value)} className="min-h-40 w-full rounded-xl border border-zinc-300 px-3 py-2 font-mono text-sm" />{payloadError ? <p className="text-xs text-red-600">{payloadError}</p> : <p className="text-xs text-zinc-500">Payload boş bırakılırsa boş nesne gönderilir.</p>}</div>
          <button disabled={mutation.isPending || !title.trim() || !body.trim() || Boolean(payloadError)} onClick={() => mutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">{mutation.isPending ? "Kuyruğa alınıyor..." : "Broadcast kuyruğa al"}</button>
        </CardContent>
      </Card>
    </OpsPageShell>
  );
}
