"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { OpsCell, OpsEmpty, OpsJsonCard, OpsLinkRow, OpsPageShell, OpsSectionCard, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getReconcileBusiness } from "@/features/ops-console/api";
import { asArray, asNumber, asRecord, asText, normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

function formatSummaryKey(key: string) {
  const labels: Record<string, string> = {
    matched: "Eşleşen kayıt",
    unmatched: "Eşleşmeyen kayıt",
    issues: "Açık sorun",
    total: "Toplam kayıt",
    total_amount: "Toplam tutar",
    payment_intents: "PaymentIntent",
    payouts: "Ödeme kaydı",
    business_earnings: "İşletme hakedişi",
  };
  return labels[key] || key.replace(/_/g, " ");
}

function getIssueTitle(issue: unknown, index: number) {
  const record = asRecord(issue);
  return asText(record.title, "") || asText(record.reason, "") || asText(record.type, "") || `Sorun #${index + 1}`;
}

function getIssueDescription(issue: unknown) {
  const record = asRecord(issue);
  return asText(record.description, "") || asText(record.message, "") || asText(record.detail, "") || "Detay için teknik kayıt içeriğini inceleyin.";
}

export default function OpsReconcileBusinessPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const reconcileQuery = useQuery({
    queryKey: ["ops", "reconcile", businessId],
    queryFn: () => getReconcileBusiness(businessId as number),
    enabled: businessId !== null,
  });

  const issues = asArray(reconcileQuery.data?.issues);
  const summary = asRecord(reconcileQuery.data?.summary);
  const summaryRows = useMemo(() => Object.entries(summary).slice(0, 10), [summary]);

  return (
    <OpsPageShell
      title="İşletme mutabakat kontrolü"
      description="Seçili işletmenin sağlayıcı dökümleri ile sistem kayıtları arasındaki uyumu kontrol edin."
    >
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme numarası okunamadı." /> : null}
      <OpsLinkRow links={businessId ? [{ href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" }] : []} />
      {reconcileQuery.isPending ? <LoadingSkeleton /> : null}
      {reconcileQuery.isError ? <ErrorState title="Mutabakat kontrolü yüklenemedi" description={getApiErrorMessage(reconcileQuery.error)} /> : null}

      {reconcileQuery.data ? (
        <>
          <OpsSectionCard
            title={`İşletme #${businessId} mutabakat özeti`}
            description="Bu ekran yalnızca kontrol sonucunu gösterir. Eşleştirme ve finans hesaplama backend tarafında korunur."
          >
            <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
              <div className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Genel durum</p>
                <div className="mt-3">
                  <OpsStatus label={issues.length > 0 ? "UNMATCHED" : "MATCHED"} />
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--hy-color-neutral-600)]">{issues.length > 0 ? "Açık uyumsuzluk görünüyor." : "Açık mutabakat sorunu görünmüyor."}</p>
              </div>
              <div className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Açık sorun</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--hy-color-neutral-950)]">{issues.length}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--hy-color-neutral-600)]">Eşleşmeyen veya açıklama gerektiren kayıt sayısı.</p>
              </div>
              <div className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4">
                <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">Özet alanı</p>
                <p className="mt-3 text-3xl font-bold tracking-tight text-[var(--hy-color-neutral-950)]">{summaryRows.length}</p>
                <p className="mt-3 text-sm leading-6 text-[var(--hy-color-neutral-600)]">Backend özetinde dönen okunabilir alan sayısı.</p>
              </div>
            </div>
          </OpsSectionCard>

          <div className="rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4 text-sm leading-6 text-[var(--hy-color-neutral-700)]">
            <p className="font-semibold text-[var(--hy-color-neutral-950)]">
              {issues.length > 0 ? "Bu işletme için manuel finans incelemesi önerilir." : "Bu işletme için açık mutabakat uyarısı görünmüyor."}
            </p>
            <p className="mt-2">Eşleştirme davranışı veya hakediş üretimi bu ekrandan değiştirilmez.</p>
          </div>

          {summaryRows.length > 0 ? (
            <OpsSectionCard title="Kontrol özeti" description="Backend özet alanları Türkçe başlıklarla gösterilir.">
              <OpsTable columns={["Alan", "Değer"]}>
                {summaryRows.map(([key, value]) => (
                  <tr key={key}>
                    <OpsCell>{formatSummaryKey(key)}</OpsCell>
                    <OpsCell>{typeof value === "number" ? asNumber(value) : asText(value, safeJsonStringify(value))}</OpsCell>
                  </tr>
                ))}
              </OpsTable>
            </OpsSectionCard>
          ) : (
            <OpsEmpty title="Özet verisi yok" description="Backend özet alanı boş döndü. Sorun listesi varsa aşağıda görüntülenir." />
          )}

          {issues.length > 0 ? (
            <OpsSectionCard title="Uyumsuzluklar" description="Sorunlar kısa açıklamayla listelenir. Teknik kayıt içeriği korunur.">
              <div className="space-y-3">
                {issues.map((issue, index) => (
                  <div key={index} className="rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-warning-100)] bg-[var(--hy-color-warning-50)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <OpsStatus label="UNMATCHED" />
                      <p className="font-semibold text-[var(--hy-color-warning-700)]">{getIssueTitle(issue, index)}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[var(--hy-color-warning-700)]">{getIssueDescription(issue)}</p>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-sm font-semibold text-[var(--hy-color-warning-700)]">Teknik detayı göster</summary>
                      <pre className="mt-3 overflow-x-auto rounded-[var(--hy-radius-sm)] border border-white/60 bg-white/70 p-3 text-xs leading-6 text-[var(--hy-color-warning-700)]">
                        {safeJsonStringify(issue)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            </OpsSectionCard>
          ) : (
            <OpsEmpty title="Açık uyumsuzluk yok" description="Bu işletme için açık mutabakat problemi görünmüyor." />
          )}

          <OpsJsonCard
            title="Ham mutabakat özeti"
            value={safeJsonStringify(reconcileQuery.data.summary)}
            description="Teknik inceleme gerektiğinde backend özet alanı olduğu gibi korunur."
          />
        </>
      ) : null}
    </OpsPageShell>
  );
}
