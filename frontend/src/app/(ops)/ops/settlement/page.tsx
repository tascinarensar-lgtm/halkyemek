"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";

import { OpsCell, OpsEmpty, OpsErrorCard, OpsMetricCard, OpsPageShell, OpsSectionCard, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { buttonClassName } from "@/components/ui/Button";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getSettlementDashboard } from "@/features/ops-console/api";
import { asNumber, asRecord } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

function formatSummaryKey(key: string) {
  const labels: Record<string, string> = {
    created_records: "Oluşturulan kayıt",
    duplicate_records: "Tekrarlayan kayıt",
    failed_records: "Hatalı kayıt",
    processed_records: "İşlenen kayıt",
    skipped_rows: "Atlanan satır",
    unmatched_records: "Eşleşmeyen kayıt",
  };
  return labels[key] || key.replace(/_/g, " ");
}

export default function OpsSettlementPage() {
  const dashboardQuery = useQuery({ queryKey: ["ops", "settlement-dashboard"], queryFn: getSettlementDashboard });
  const heartbeats = asRecord(dashboardQuery.data?.heartbeats);
  const latestSummary = asRecord(dashboardQuery.data?.latest_import_record_summary);

  return (
    <OpsPageShell
      title="Mutabakat merkezi"
      description="Sağlayıcı ödeme dökümlerinin sistem kayıtlarıyla eşleşmesini izleyin."
    >
      <OpsSectionCard
        title="Mutabakat süreci nasıl işler?"
        description="Akış, sağlayıcı dökümü ile HalkYemek kayıtlarını karşılaştırır."
      >
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["1", "Sağlayıcı dosyası alınır", "Iyzico veya ödeme sağlayıcısından gelen döküm sisteme aktarılır."],
            ["2", "Sistem kayıtlarıyla karşılaştırılır", "PaymentIntent, işletme hakedişi ve ödeme kayıtları referanslarla eşleştirilir."],
            ["3", "Eşleşmeyen kayıtlar incelenir", "Tutar, referans, işletme ve işlem durumu kontrol edilerek manuel inceleme yapılır."],
            ["4", "Hakediş süreci güvenle ilerler", "Finansal doğrulama sonrası ödeme kayıtları daha güvenli takip edilir."],
          ].map(([step, title, text]) => (
            <div key={step} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold text-zinc-500">Adım {step}</p>
              <h3 className="mt-2 text-sm font-semibold text-zinc-950">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-zinc-600">{text}</p>
            </div>
          ))}
        </div>
      </OpsSectionCard>

      {dashboardQuery.isPending ? <LoadingSkeleton /> : null}
      {dashboardQuery.isError ? <OpsErrorCard title="Mutabakat özeti yüklenemedi" description={getApiErrorMessage(dashboardQuery.error)} /> : null}
      {dashboardQuery.data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <OpsMetricCard label="Toplam içe aktarım" value={asNumber(dashboardQuery.data.imports_total)} hint="Sisteme alınan sağlayıcı dökümü." />
            <OpsMetricCard label="Hatalı içe aktarım" value={asNumber(dashboardQuery.data.imports_failed)} hint="İçe aktarımda sorun yaşayan dökümler." />
            <OpsMetricCard label="Açık eşleşmeyen kayıt" value={asNumber(dashboardQuery.data.records_unmatched_open)} hint="Finans incelemesi bekleyen kayıtlar." />
            <OpsMetricCard label="Gecikmiş manuel inceleme" value={asNumber(dashboardQuery.data.records_stale_manual_review)} hint="Uzun süredir açık kalan incelemeler." />
          </div>

          <div className="grid gap-5 sm:gap-6 xl:grid-cols-2">
            <OpsSectionCard title="Son içe aktarım" description="En son alınan sağlayıcı ödeme dökümünün durumu.">
              {dashboardQuery.data.latest_import ? (
                <div className="space-y-4 text-sm">
                  <div className="flex flex-wrap gap-2">
                    <OpsStatus label={dashboardQuery.data.latest_import.applied_status} />
                    <OpsStatus label={dashboardQuery.data.latest_import.parse_status} />
                  </div>
                  <div>
                    <p className="font-semibold text-zinc-950">
                      {dashboardQuery.data.latest_import.original_filename || dashboardQuery.data.latest_import.source_label || "Dosya adı yok"}
                    </p>
                    <p className="mt-1 text-zinc-500">İçe aktarım zamanı: {formatDateTime(dashboardQuery.data.latest_import.imported_at)}</p>
                  </div>
                  <Link href="/ops/settlement/importlar" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                    Tüm içe aktarımları gör
                  </Link>
                </div>
              ) : (
                <OpsEmpty title="Henüz içe aktarım yok" description="Sağlayıcı ödeme dökümü yüklendiğinde son işlem özeti burada görünecek." />
              )}
            </OpsSectionCard>

              <OpsSectionCard title="Kayıt özeti" description="Mutabakat kayıtlarının işlenme ve hata durumları.">
              <OpsTable columns={["Alan", "Toplam"]}>
                <tr>
                  <OpsCell>İşlenen kayıt</OpsCell>
                  <OpsCell>{asNumber(dashboardQuery.data.records_processed)}</OpsCell>
                </tr>
                <tr>
                  <OpsCell>Hatalı kayıt</OpsCell>
                  <OpsCell>{asNumber(dashboardQuery.data.records_failed)}</OpsCell>
                </tr>
                {Object.entries(latestSummary).slice(0, 4).map(([key, value]) => (
                  <tr key={key}>
                    <OpsCell>{formatSummaryKey(key)}</OpsCell>
                    <OpsCell>{asNumber(value)}</OpsCell>
                  </tr>
                ))}
              </OpsTable>
              <Link href="/ops/settlement/kayitlar" className={buttonClassName({ size: "sm" })}>
                Mutabakat kayıtlarını aç
              </Link>
            </OpsSectionCard>
          </div>

          <OpsSectionCard title="Arka plan işlem sağlığı" description="Planlı görevlerin son durumu. Gecikme mutabakat akışını etkileyebilir.">
            <div className="grid gap-3 md:grid-cols-3">
              {Object.keys(heartbeats).length > 0 ? (
                Object.entries(heartbeats).map(([key, rawValue]) => {
                  const value = asRecord(rawValue);
                  return (
                    <div key={key} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <OpsStatus label={String(value.status || "UNKNOWN")} />
                      </div>
                      <p className="mt-2 font-semibold text-zinc-950">{key}</p>
                      <p className="mt-1 text-zinc-600">Son güncelleme: {formatDateTime(String(value.updated_at || ""))}</p>
                    </div>
                  );
                })
              ) : (
                <OpsEmpty title="Görev sağlığı verisi yok" description="Planlı görevlerden henüz heartbeat bilgisi gelmemiş." />
              )}
            </div>
          </OpsSectionCard>
        </>
      ) : null}
    </OpsPageShell>
  );
}
