"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsLinkRow, OpsPageShell } from "@/components/ops-console/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
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
    if (!hasNonEmptyText(worker)) return "İşleyen servis adı boş bırakılamaz.";
    if (isLimitInvalid) return "İşlenecek kayıt limiti 1 veya daha büyük olmalıdır.";
    return "";
  }, [isLimitInvalid, worker]);

  const mutation = useMutation({
    mutationFn: () => dispatchPayouts(limit, normalizedWorker),
    onSuccess: async (response) => {
      const processed = asNumber(asRecord(response.data).processed);
      setLastProcessed(processed);
      setLastError(null);
      toast.success(processed > 0 ? "Ödeme gönderimi çalıştı" : "İşlenecek hakediş bulunamadı");
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
    <OpsPageShell
      title="Ödeme gönderimi"
      description="Vadesi gelen veya yeniden deneme bekleyen hakediş kayıtları için ödeme gönderimi hazırlığını kontrollü şekilde başlatın."
    >
      <OpsLinkRow links={[{ href: "/ops/payoutlar", label: "Hakediş listesi" }]} />
      <OpsActionResult
        tone="danger"
        title="Yüksek riskli finans aksiyonu"
        description="Bu işlem uygun hakediş kayıtlarını ödeme gönderimi kuyruğuna alabilir. Aynı anda tekrar tıklama, eski liste üzerinden işlem yapma veya gereğinden yüksek limit finansal takip karmaşası yaratabilir."
      />
      {lastError ? <OpsActionResult tone="danger" title="Ödeme gönderimi başlatılamadı" description={lastError} /> : null}
      {lastProcessed !== null ? (
        <OpsActionResult
          tone={lastProcessed > 0 ? "success" : "warning"}
          title="Ödeme gönderimi tamamlandı"
          description={
            lastProcessed > 0
              ? `İşlenen ödeme kaydı sayısı: ${lastProcessed}. Hakediş listesi, genel özet ve metrikler yeniden sorgulandı.`
              : "İstek başarılıydı fakat gönderime uygun ödeme kaydı bulunmadı. Ekran verileri yine de yenilendi."
          }
        />
      ) : null}

      <Card variant="surface">
        <CardContent className="max-w-3xl space-y-6" padding="lg">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950">Gönderim ayarları</h2>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Limit, bu çalıştırmada en fazla kaç ödeme kaydının işleneceğini belirler. Servis adı ise operasyon kaydında bu işlemi hangi
              işleyicinin başlattığını izlemek için kullanılır.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm font-medium">İşlenecek kayıt limiti</span>
              <input
                type="number"
                min={1}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value || 1))}
                className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
              />
              <span className="block text-xs text-zinc-500">Küçük limitlerle ilerlemek finansal kontrolü kolaylaştırır.</span>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">İşleyen servis adı</span>
              <input
                value={worker}
                onChange={(event) => setWorker(event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
              />
              <span className="block text-xs text-zinc-500">Gönderilecek servis adı: {normalizedWorker}</span>
            </label>
          </div>

          {validationMessage ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{validationMessage}</p>
          ) : (
            <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
              İşlem hazır. Buton yalnızca istek devam ederken kapatılır ve başarılı işlemden sonra finans ekranları yenilenir.
            </p>
          )}

          <Button
            disabled={mutation.isPending || Boolean(validationMessage)}
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            loadingText="Ödeme gönderimi çalışıyor..."
          >
            Ödeme gönderimini başlat
          </Button>
        </CardContent>
      </Card>
    </OpsPageShell>
  );
}
