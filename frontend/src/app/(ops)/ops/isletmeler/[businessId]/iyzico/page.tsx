"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsJsonCard, OpsKeyValueGrid, OpsLinkRow, OpsPageShell, OpsStatus } from "@/components/ops-console/shared";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getOpsBusinessDetail, triggerOpsSubmerchant } from "@/features/ops-console/api";
import { asText, invalidateOpsQueries, normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsIyzicoPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<string | null>(null);
  const detailQuery = useQuery({ queryKey: ["ops", "business", businessId], queryFn: () => getOpsBusinessDetail(businessId as number), enabled: businessId !== null });
  const mutation = useMutation({
    mutationFn: () => triggerOpsSubmerchant(businessId as number),
    onSuccess: async () => {
      toast.success("Iyzico onboarding tetiklendi");
      setLastResult("Ops tetiklemesi gönderildi. Detail ve liste ekranı yeniden sorgulanıyor.");
      await invalidateOpsQueries(queryClient, [["ops", "business", businessId], ["ops", "businesses"]]);
      await detailQuery.refetch();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult(`Tetikleme başarısız: ${message}`);
      toast.error(message);
    },
  });

  return (
    <OpsPageShell title="Iyzico submerchant onboarding" description="KYC alanlarını görüntüle, ops tetiklemesi ile create/update akışını çalıştır.">
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki businessId değeri okunamadı." /> : null}
      <OpsLinkRow links={businessId ? [
        { href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" },
        { href: `/ops/isletmeler/${businessId}/durum`, label: "Durum" },
        { href: `/ops/isletmeler/${businessId}/uyelikler`, label: "Üyelikler" },
      ] : []} />
      {lastResult ? <OpsActionResult tone={lastResult.startsWith("Tetikleme başarısız") ? "danger" : "success"} title="Iyzico aksiyon sonucu" description={lastResult} /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="Iyzico verisi yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}
      {detailQuery.data ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <OpsStatus label={detailQuery.data.payout_onboarding_status} />
                  <OpsStatus label={asText(detailQuery.data.iyzico_onboarding.submerchant_status)} />
                </div>
                <p className="text-sm text-zinc-600">Submerchant key: {asText(detailQuery.data.iyzico_onboarding.submerchant_key)}</p>
              </div>
              <button disabled={mutation.isPending} onClick={() => mutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">
                {mutation.isPending ? "Tetikleniyor..." : "Onboarding tetikle"}
              </button>
            </CardContent>
          </Card>
          <OpsKeyValueGrid items={[
            { label: "Submerchant type", value: asText(detailQuery.data.iyzico_onboarding.submerchant_type) },
            { label: "Submerchant key", value: asText(detailQuery.data.iyzico_onboarding.submerchant_key) },
            { label: "Submerchant status", value: asText(detailQuery.data.iyzico_onboarding.submerchant_status) },
            { label: "KYC contact", value: `${asText(detailQuery.data.iyzico_onboarding.kyc_contact_name)} ${asText(detailQuery.data.iyzico_onboarding.kyc_contact_surname, "")}`.trim() || "-" },
            { label: "KYC email", value: asText(detailQuery.data.iyzico_onboarding.kyc_email) },
            { label: "KYC IBAN", value: asText(detailQuery.data.iyzico_onboarding.kyc_iban) },
          ]} />
          <OpsJsonCard title="Iyzico payload" value={safeJsonStringify(detailQuery.data.iyzico_onboarding)} description="Partial response veya hata payload’ı gelse bile ham alan korunur." />
        </>
      ) : null}
    </OpsPageShell>
  );
}
