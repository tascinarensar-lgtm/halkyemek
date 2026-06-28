"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { OpsActionResult, OpsCell, OpsEmpty, OpsErrorCard, OpsMetricCard, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { AmountText } from "@/components/ui/amount-text";
import { buttonClassName } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { listPayouts } from "@/features/ops-console/api";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatCurrency, formatDateTime } from "@/lib/utils/format";

export default function OpsPayoutListPage() {
  const payoutsQuery = useQuery({ queryKey: ["ops", "payouts"], queryFn: listPayouts });

  const summary = useMemo(() => {
    const items = payoutsQuery.data ?? [];
    return {
      count: items.length,
      totalAmount: items.reduce((total, item) => total + item.amount, 0),
      failedCount: items.filter((item) => String(item.status).toUpperCase().includes("FAIL")).length,
      waitingConfirmCount: items.filter((item) => String(item.status).toUpperCase() === "SENT").length,
    };
  }, [payoutsQuery.data]);

  return (
    <OpsPageShell
      title="Hakediş kayıtları"
      description="İşletmelere yapılacak ödeme kayıtlarını ve onay adımlarını takip edin."
    >
      <OpsActionResult
        tone="warning"
        title="Finansal kontrol gerektiren ekran"
        description="Onay vermeden önce tutar, işletme numarası ve sağlayıcı referansını ödeme kanıtıyla eşleştirin."
      />

      {payoutsQuery.isPending ? <LoadingSkeleton /> : null}
      {payoutsQuery.isError ? <OpsErrorCard title="Hakediş kayıtları yüklenemedi" description={getApiErrorMessage(payoutsQuery.error)} /> : null}

      {payoutsQuery.data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OpsMetricCard label="Toplam kayıt" value={summary.count} hint="Bu ekranda dönen ödeme kaydı sayısı." />
            <OpsMetricCard label="Toplam tutar" value={formatCurrency(summary.totalAmount)} hint="Listelenen kayıtların görünen toplamı." />
            <OpsMetricCard label="Onay bekleyen" value={summary.waitingConfirmCount} hint="Sağlayıcıya gönderilmiş, operasyon onayı bekleyen kayıtlar." />
            <OpsMetricCard label="Sorunlu kayıt" value={summary.failedCount} hint="Hata veya yeniden deneme incelemesi gerektirebilir." />
          </div>

          <Card>
            <CardContent className="space-y-5" padding="lg">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Ödeme kayıtları</h2>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">Her satır bir işletme hakediş kaydını temsil eder.</p>
                </div>
                <Link href="/ops/payoutlar/dispatch" className={buttonClassName({ size: "md" })}>
                  Ödeme gönderimi ekranı
                </Link>
              </div>

              {payoutsQuery.data.length > 0 ? (
                <OpsTable columns={["Ödeme kaydı", "İşletme", "Tutar", "Deneme / tarih", "İşlem"]}>
                  {payoutsQuery.data.map((item) => (
                    <tr key={item.id}>
                      <OpsCell>
                        <div className="min-w-[220px] space-y-1">
                          <p className="font-semibold text-zinc-950">Hakediş #{item.id}</p>
                          <p className="break-words text-xs text-zinc-500">Sağlayıcı referansı: {item.provider_reference || "-"}</p>
                          <p className="text-xs text-zinc-500">Oluşturulma: {formatDateTime(item.created_at)}</p>
                        </div>
                      </OpsCell>
                      <OpsCell>
                        <div className="min-w-[150px] space-y-1.5">
                          <p className="font-medium">İşletme #{item.business}</p>
                          <OpsStatus label={item.status} />
                        </div>
                      </OpsCell>
                      <OpsCell>
                        <div className="text-base font-semibold">
                          <AmountText amount={item.amount} currency={item.currency} />
                        </div>
                      </OpsCell>
                      <OpsCell>
                        <div className="min-w-[170px] space-y-1">
                          <p>{item.attempt_count} gönderim denemesi</p>
                          <p className="text-xs text-zinc-500">Sonraki deneme: {formatDateTime(item.next_retry_at)}</p>
                        </div>
                      </OpsCell>
                      <OpsCell>
                        <div className="flex min-w-[220px] flex-wrap gap-2">
                          <Link href={`/ops/payoutlar/${item.id}/confirm`} className={buttonClassName({ size: "sm" })}>
                            Ödeme onayı
                          </Link>
                          <Link href={`/ops/payoutlar/${item.id}`} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                            Detay
                          </Link>
                        </div>
                      </OpsCell>
                    </tr>
                  ))}
                </OpsTable>
              ) : (
                <OpsEmpty
                  title="Hakediş kaydı bulunamadı"
                  description="Şu anda işletmelere aktarım için listelenen ödeme kaydı yok. Yeni kayıtlar oluştuğunda bu alanda görünecek."
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </OpsPageShell>
  );
}
