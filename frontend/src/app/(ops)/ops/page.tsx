"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { OpsCell, OpsEmpty, OpsErrorCard, OpsMetricCard, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { getOpsDashboard, getOpsMetrics } from "@/features/ops-console/api";
import { asNumber, asRecord } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsDashboardPage() {
  const dashboardQuery = useQuery({ queryKey: ["ops", "dashboard"], queryFn: getOpsDashboard });
  const metricsQuery = useQuery({ queryKey: ["ops", "metrics"], queryFn: getOpsMetrics });

  const payouts = asRecord(dashboardQuery.data?.payouts);
  const earnings = asRecord(dashboardQuery.data?.earnings);
  const counts = asRecord(metricsQuery.data?.counts);
  const payoutsByStatus = asRecord(metricsQuery.data?.payouts_by_status);

  return (
    <OpsPageShell title="Ops dashboard" description="Payout, settlement ve sistem yoğunluğunu tek ekranda özetle.">
      {dashboardQuery.isPending || metricsQuery.isPending ? <LoadingSkeleton /> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <OpsMetricCard label="Dispatch bekleyen payout" value={asNumber(payouts.due_to_dispatch)} />
        <OpsMetricCard label="Failed payout" value={asNumber(payouts.failed_total)} />
        <OpsMetricCard
          label="Pending wallet işlemi"
          value={asNumber(counts.pending_wallet_transactions)}
          hint="Metrics endpoint settlement dışı genel kuyruk yükünü de içerir."
        />
        <OpsMetricCard label="Confirmed payout" value={asNumber(payouts.confirmed_total)} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Finans özeti</h2>
              <Link href="/ops/payoutlar" className="text-sm font-medium text-zinc-700">Payout listesi</Link>
            </div>
            {dashboardQuery.isError ? (
              <OpsErrorCard title="Dashboard endpointi okunamadı" description={getApiErrorMessage(dashboardQuery.error)} />
            ) : (
              <OpsTable columns={["Alan", "Değer"]}>
                <tr><OpsCell>Pending earning</OpsCell><OpsCell>{asNumber(earnings.pending)}</OpsCell></tr>
                <tr><OpsCell>Eligible earning</OpsCell><OpsCell>{asNumber(earnings.eligible)}</OpsCell></tr>
                <tr><OpsCell>Paid earning</OpsCell><OpsCell>{asNumber(earnings.paid)}</OpsCell></tr>
                <tr><OpsCell>Sent waiting confirm</OpsCell><OpsCell>{asNumber(payouts.sent_waiting_confirm)}</OpsCell></tr>
              </OpsTable>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Sistem sayaçları</h2>
              <Link href="/ops/settlement" className="text-sm font-medium text-zinc-700">Settlement merkezi</Link>
            </div>
            {metricsQuery.isError ? (
              <OpsErrorCard title="Metrics endpointi okunamadı" description={getApiErrorMessage(metricsQuery.error)} />
            ) : Object.keys(counts).length > 0 ? (
              <OpsTable columns={["Sayaç", "Toplam"]}>
                {Object.entries(counts).map(([key, value]) => (
                  <tr key={key}><OpsCell>{key}</OpsCell><OpsCell>{asNumber(value)}</OpsCell></tr>
                ))}
              </OpsTable>
            ) : (
              <OpsEmpty title="Sayaç verisi yok" description="Metrics endpointi boş cevap döndü." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Payout status dağılımı</h2>
            <div className="flex gap-2 text-sm">
              <Link href="/ops/isletmeler" className="rounded-xl bg-zinc-100 px-3 py-2 font-medium">İşletmeler</Link>
              <Link href="/ops/bildirimler/yayinla" className="rounded-xl bg-zinc-950 px-3 py-2 font-medium text-white">Broadcast</Link>
            </div>
          </div>
          {metricsQuery.isError ? (
            <OpsErrorCard title="Payout dağılımı okunamadı" description={getApiErrorMessage(metricsQuery.error)} />
          ) : Object.keys(payoutsByStatus).length > 0 ? (
            <OpsTable columns={["Status", "Adet", "Gözlem"]}>
              {Object.entries(payoutsByStatus).map(([key, value]) => (
                <tr key={key}>
                  <OpsCell><OpsStatus label={key} /></OpsCell>
                  <OpsCell>{asNumber(value)}</OpsCell>
                  <OpsCell>{key === "FAILED" ? "Retry veya confirm gerektirebilir." : key === "SENT" ? "Provider sync ve settlement ile izlenmeli." : "Normal akış."}</OpsCell>
                </tr>
              ))}
            </OpsTable>
          ) : (
            <OpsEmpty title="Payout dağılımı yok" description="Henüz payout statü dağılımı üretilmemiş." />
          )}
        </CardContent>
      </Card>
    </OpsPageShell>
  );
}
