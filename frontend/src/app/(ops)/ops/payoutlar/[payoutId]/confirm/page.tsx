"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsKeyValueGrid, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { AmountText } from "@/components/ui/amount-text";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { confirmPayout, getPayoutDetail } from "@/features/ops-console/api";
import { asRecord, canManuallyConfirmPayout, invalidateOpsQueries, isPayoutTerminalStatus, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

export default function OpsPayoutConfirmPage() {
  const params = useParams<{ payoutId: string }>();
  const queryClient = useQueryClient();
  const payoutId = normalizeOpsId(params.payoutId);
  const [note, setNote] = useState("");
  const [resultMessage, setResultMessage] = useState<{ tone: "success" | "warning" | "danger"; title: string; description: string } | null>(null);
  const payoutQuery = useQuery({
    queryKey: ["ops", "payout", payoutId],
    queryFn: () => getPayoutDetail(payoutId as number),
    enabled: payoutId !== null,
  });

  const payoutStatus = String(payoutQuery.data?.status || "").toUpperCase();
  const alreadyTerminal = isPayoutTerminalStatus(payoutStatus);
  const allowConfirm = canManuallyConfirmPayout(payoutStatus);

  const mutation = useMutation({
    mutationFn: () => confirmPayout(payoutId as number, note.trim()),
    onSuccess: async (response) => {
      const data = asRecord(response.data);
      const changed = Boolean(data.changed);
      const status = typeof data.status === "string" ? data.status : "CONFIRMED";
      setResultMessage({
        tone: changed ? "success" : "warning",
        title: changed ? "Ödeme onayı kaydedildi" : "Ödeme kaydı tekrar onaylanmadı",
        description: changed
          ? `Hakediş kaydı onaylandı. Yeni durum: ${status}.`
          : `Bu ödeme kaydı daha önce işlenmiş görünüyor. Son durum: ${status}.`,
      });
      toast.success(changed ? "Ödeme onayı kaydedildi" : "Ödeme kaydı tekrar onaylanmadı");
      await invalidateOpsQueries(queryClient, [["ops", "payout", payoutId], ["ops", "payouts"], ["ops", "dashboard"], ["ops", "metrics"]]);
      await payoutQuery.refetch();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setResultMessage({
        tone: "danger",
        title: "Ödeme onayı tamamlanamadı",
        description: message,
      });
      toast.error(message);
    },
  });

  const confirmBlockedReason = useMemo(() => {
    if (!payoutQuery.data) return "";
    if (alreadyTerminal) {
      return `Bu ödeme kaydı artık ${payoutStatus} durumunda. Tekrar manuel onay göndermek finansal kayıt algısını bozabileceği için buton kapatıldı.`;
    }
    if (!allowConfirm) {
      return `Manuel ödeme onayı yalnızca sağlayıcıya gönderilmiş veya yeniden deneme incelemesi gereken kayıtlarda kullanılmalıdır. Güncel durum: ${payoutStatus || "-"}.`;
    }
    return "";
  }, [allowConfirm, alreadyTerminal, payoutQuery.data, payoutStatus]);

  return (
    <OpsPageShell
      title="Ödeme onayı"
      description="Manuel onay gerektiren hakediş kayıtlarını kontrollü şekilde inceleyip finansal kanıtla eşleştirerek onaylayın."
    >
      {payoutId === null ? <ErrorState title="Geçersiz ödeme kaydı" description="URL içindeki ödeme kaydı numarası okunamadı." /> : null}
      <OpsLinkRow
        links={
          payoutId
            ? [
                { href: "/ops/payoutlar", label: "Hakediş listesi" },
                { href: `/ops/payoutlar/${payoutId}`, label: "Hakediş detayı" },
              ]
            : []
        }
      />
      {resultMessage ? <OpsActionResult tone={resultMessage.tone} title={resultMessage.title} description={resultMessage.description} /> : null}
      {payoutQuery.isPending ? <LoadingSkeleton /> : null}
      {payoutQuery.isError ? <ErrorState title="Hakediş detayı yüklenemedi" description={getApiErrorMessage(payoutQuery.error)} /> : null}
      {payoutQuery.data ? (
        <>
          <OpsActionResult
            tone="danger"
            title="Yanlış onay finansal tutarsızlık yaratabilir"
            description="Bu işlemden önce ödeme kanıtı, tutar, işletme numarası ve sağlayıcı referansı eşleşmelidir. Emin değilseniz onay vermeyin."
          />

          <Card variant="surface">
            <CardContent className="space-y-6" padding="lg">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-zinc-950">Onaylanacak hakediş #{payoutQuery.data.id}</h2>
                    <OpsStatus label={payoutQuery.data.status} />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">
                    Bu ekranda yalnızca mevcut ödeme kaydı için manuel ödeme onayı verilir. Tutar veya işletme bilgisi frontend’de
                    yeniden hesaplanmaz.
                  </p>
                  <div className="mt-3 text-2xl font-semibold">
                    <AmountText amount={payoutQuery.data.amount} currency={payoutQuery.data.currency} />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-danger-100)] bg-[var(--hy-color-danger-50)] p-4">
                  <p className="text-sm font-semibold text-[var(--hy-color-danger-700)]">Tutar kontrolü</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--hy-color-danger-700)]">Gönderilen tutar ile kanıt üzerindeki tutar aynı olmalıdır.</p>
                </div>
                <div className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-danger-100)] bg-[var(--hy-color-danger-50)] p-4">
                  <p className="text-sm font-semibold text-[var(--hy-color-danger-700)]">İşletme kontrolü</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--hy-color-danger-700)]">Yanlış işletme için onay vermek finansal kaydı bozar.</p>
                </div>
                <div className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-danger-100)] bg-[var(--hy-color-danger-50)] p-4">
                  <p className="text-sm font-semibold text-[var(--hy-color-danger-700)]">Referans kontrolü</p>
                  <p className="mt-2 text-sm leading-6 text-[var(--hy-color-danger-700)]">Sağlayıcı referansı ve ödeme kanıtı birebir eşleşmelidir.</p>
                </div>
              </div>

              <OpsKeyValueGrid
                items={[
                  { label: "İşletme", value: `#${payoutQuery.data.business}` },
                  { label: "Durum", value: <OpsStatus label={payoutQuery.data.status} /> },
                  { label: "Sağlayıcı referansı", value: payoutQuery.data.provider_reference || "-" },
                  { label: "Sağlayıcı ödeme numarası", value: payoutQuery.data.provider_payout_id || "-" },
                  { label: "Oluşturulma", value: formatDateTime(payoutQuery.data.created_at) },
                  { label: "Gönderilme", value: formatDateTime(payoutQuery.data.sent_at) },
                  { label: "Onaylanma", value: formatDateTime(payoutQuery.data.confirmed_at) },
                  { label: "Son hata kodu", value: payoutQuery.data.last_error_code || "-" },
                ]}
              />

              {confirmBlockedReason ? (
                <OpsActionResult tone={alreadyTerminal ? "warning" : "default"} title="Onay koruması" description={confirmBlockedReason} />
              ) : (
                <OpsActionResult
                  tone="warning"
                  title="Onay verilebilir görünüyor"
                  description="Yine de ödeme kanıtını kontrol etmeden ilerlemeyin. Bu buton mevcut ödeme kaydı için manuel onay isteği gönderir."
                />
              )}

              <label className="space-y-1">
                <span className="text-sm font-medium">Operasyon notu</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="min-h-32 w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
                  placeholder="Örn. Banka dekontu ve sağlayıcı referansı kontrol edildi."
                />
                <span className="block text-xs text-zinc-500">Not opsiyoneldir, ancak finansal iz için kısa kontrol notu girmeniz önerilir.</span>
              </label>

              <div className="flex flex-wrap gap-3">
                <Button
                  disabled={mutation.isPending || Boolean(confirmBlockedReason)}
                  onClick={() => mutation.mutate()}
                  loading={mutation.isPending}
                  loadingText="Onay gönderiliyor..."
                >
                  Ödeme onayını ver
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </OpsPageShell>
  );
}
