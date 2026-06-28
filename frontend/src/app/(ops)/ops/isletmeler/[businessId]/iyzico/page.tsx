"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  OpsActionResult,
  OpsJsonCard,
  OpsKeyValueGrid,
  OpsLinkRow,
  OpsPageShell,
  OpsSectionCard,
  OpsStatus,
} from "@/components/ops-console/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { getOpsBusinessDetail, triggerOpsSubmerchant } from "@/features/ops-console/api";
import { asRecord, asText, invalidateOpsQueries, normalizeOpsId, safeJsonStringify } from "@/features/ops-console/utils";
import { cn } from "@/lib/utils/cn";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/utils/format";

type ResultState = {
  tone: "success" | "warning" | "danger";
  title: string;
  description: string;
};

type SummaryTone = "success" | "warning" | "danger" | "default";

const REQUIRED_FIELDS = [
  { key: "kyc_contact_name", label: "Yetkili adı" },
  { key: "kyc_contact_surname", label: "Yetkili soyadı" },
  { key: "kyc_email", label: "Yetkili e-posta" },
  { key: "kyc_iban", label: "IBAN" },
];

const ERROR_KEYS = ["error_message", "provider_error", "last_error", "last_error_message", "message"];
const ERROR_CODE_KEYS = ["error_code", "provider_error_code", "last_error_code", "code"];

function pickText(record: Record<string, unknown>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = asText(record[key], "");
    if (value) return value;
  }
  return fallback;
}

function hasValue(record: Record<string, unknown>, key: string) {
  return Boolean(asText(record[key], "").trim());
}

function getStatusTone(status: string, hasError: boolean, missingCount: number): SummaryTone {
  const normalized = status.toUpperCase();
  if (hasError || normalized.includes("FAIL") || normalized.includes("REJECT")) return "danger";
  if (missingCount > 0 || normalized.includes("PENDING") || normalized.includes("WAIT")) return "warning";
  if (normalized.includes("APPROVED") || normalized.includes("ACTIVE") || normalized.includes("SUCCESS")) return "success";
  return "default";
}

function SummaryCard({ title, value, description, tone = "default" }: { title: string; value: string; description: string; tone?: SummaryTone }) {
  const styles = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-red-200 bg-red-50 text-red-950",
    default: "border-zinc-200 bg-white text-zinc-950",
  } as const;

  return (
    <div className={cn("rounded-2xl border p-4", styles[tone])}>
      <p className="text-sm font-medium opacity-75">{title}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
      <p className="mt-2 text-sm leading-6 opacity-80">{description}</p>
    </div>
  );
}

export default function OpsIyzicoPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryClient = useQueryClient();
  const [lastResult, setLastResult] = useState<ResultState | null>(null);

  const detailQuery = useQuery({
    queryKey: ["ops", "business", businessId],
    queryFn: () => getOpsBusinessDetail(businessId as number),
    enabled: businessId !== null,
  });

  const onboarding = useMemo(() => asRecord(detailQuery.data?.iyzico_onboarding), [detailQuery.data?.iyzico_onboarding]);
  const submerchantKey = pickText(onboarding, ["submerchant_key", "subMerchantKey", "iyzico_submerchant_key"]);
  const submerchantStatus = pickText(onboarding, ["submerchant_status", "status", "payout_onboarding_status"], detailQuery.data?.payout_onboarding_status || "-");
  const submerchantType = pickText(onboarding, ["submerchant_type", "subMerchantType"]);
  const providerReference = pickText(onboarding, ["provider_reference", "providerReference", "reference_code", "referenceCode"]);
  const conversationId = pickText(onboarding, ["conversation_id", "conversationId"]);
  const lastSyncedAt = pickText(onboarding, ["last_synced_at", "updated_at", "created_at"]);
  const errorMessage = pickText(onboarding, ERROR_KEYS);
  const errorCode = pickText(onboarding, ERROR_CODE_KEYS);
  const missingFields = REQUIRED_FIELDS.filter((field) => !hasValue(onboarding, field.key));
  const hasOnboardingPayload = Object.keys(onboarding).length > 0;
  const hasError = Boolean(errorMessage || errorCode);
  const summaryTone = getStatusTone(submerchantStatus, hasError, missingFields.length);

  const mutation = useMutation({
    mutationFn: () => triggerOpsSubmerchant(businessId as number),
    onSuccess: async () => {
      toast.success("Ödeme hesabı isteği gönderildi");
      setLastResult({
        tone: "success",
        title: "Iyzico bağlantı isteği gönderildi",
        description: "Alt üye işyeri oluşturma veya güncelleme isteği güvenli şekilde iletildi. Sayfa bilgileri yeniden sorgulanıyor.",
      });
      await invalidateOpsQueries(queryClient, [["ops", "business", businessId], ["ops", "businesses"]]);
      await detailQuery.refetch();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({
        tone: "danger",
        title: "Iyzico işlemi tamamlanamadı",
        description: message,
      });
      toast.error(message);
    },
  });

  return (
    <OpsPageShell
      title="Ödeme sağlayıcı bağlantısı"
      description="İşletmenin Iyzico alt üye işyeri kaydını ve eksik bilgi durumunu takip edin."
    >
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme numarası okunamadı." /> : null}
      <OpsLinkRow
        links={
          businessId
            ? [
                { href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" },
                { href: `/ops/isletmeler/${businessId}/durum`, label: "Durum yönetimi" },
                { href: `/ops/isletmeler/${businessId}/uyelikler`, label: "Yetkililer" },
              ]
            : []
        }
      />
      {lastResult ? <OpsActionResult tone={lastResult.tone} title={lastResult.title} description={lastResult.description} /> : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? <ErrorState title="Ödeme sağlayıcı bilgisi yüklenemedi" description={getApiErrorMessage(detailQuery.error)} /> : null}

      {detailQuery.data ? (
        <>
          <Card variant="surface">
            <CardContent className="space-y-5" padding="lg">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-zinc-950">{detailQuery.data.business_name}</h2>
                    <OpsStatus label={detailQuery.data.payout_onboarding_status} />
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
                    Iyzico bağlantısı işletme hakedişlerinin doğru hesaba aktarılmasını destekler. Teknik referanslar korunur, operasyon aksiyonları sade gösterilir.
                  </p>
                </div>
                <Button
                  disabled={mutation.isPending || businessId === null}
                  onClick={() => mutation.mutate()}
                  loading={mutation.isPending}
                  loadingText="İstek gönderiliyor..."
                  className="w-full sm:w-auto"
                >
                  İyzico ile kontrol et / güncelle
                </Button>
              </div>

              <OpsActionResult
                tone="warning"
                title="Bu aksiyon ödeme hesabı kaydını etkileyebilir"
                description="Buton, alt üye işyeri oluşturma/güncelleme akışını tetikler. Eksik KYC bilgisi hataya neden olabilir; sonucu beklemeden tekrarlı deneme yapmayın."
              />
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              title="Bağlantı durumu"
              value={submerchantKey ? "Bağlantı kaydı var" : "Bağlantı bekliyor"}
              description={
                submerchantKey
                  ? "Alt üye işyeri anahtarı oluşmuş."
                  : "İşletme için henüz alt üye işyeri anahtarı görünmüyor."
              }
              tone={submerchantKey ? "success" : "warning"}
            />
            <SummaryCard
              title="Eksik bilgi"
              value={missingFields.length ? `${missingFields.length} alan kontrol bekliyor` : "Temel bilgiler tamam"}
              description={
                missingFields.length
                  ? `Eksik görünen alanlar: ${missingFields.map((field) => field.label).join(", ")}.`
                  : "Temel iletişim ve IBAN alanları dolu görünüyor."
              }
              tone={missingFields.length ? "warning" : "success"}
            />
            <SummaryCard
              title="Aksiyon bekleyen durum"
              value={missingFields.length ? "Bilgi tamamlanmalı" : submerchantKey ? "Acil aksiyon yok" : "Iyzico kontrolü önerilir"}
              description={
                missingFields.length
                  ? "Eksik bilgiler tamamlanmadan sağlayıcı kaydı hata verebilir."
                  : submerchantKey
                    ? "Ödeme hesabı referansı görünüyor; yalnızca ihtiyaçta aksiyon alın."
                    : "Eksik bilgi yoksa Iyzico ile kontrol ederek kayıt oluşturmayı deneyebilirsiniz."
              }
              tone={missingFields.length || !submerchantKey ? "warning" : "success"}
            />
            <SummaryCard
              title="Hata durumu"
              value={hasError ? "Hata kaydı var" : "Hata görünmüyor"}
              description={hasError ? errorMessage || `Sağlayıcı hata kodu: ${errorCode}` : "Son yanıtta operasyonu durduran bir hata mesajı görünmüyor."}
              tone={hasError ? "danger" : summaryTone}
            />
          </div>

          {!hasOnboardingPayload ? (
            <OpsActionResult
              tone="warning"
              title="Ödeme hesabı özeti henüz oluşmadı"
              description="İşletme kaydı açılmış olabilir ancak Iyzico yanıtı henüz oluşmamış. Gerekli bilgiler tamamlandıysa kontrol/güncelle aksiyonunu kullanabilirsiniz."
            />
          ) : null}

          <OpsSectionCard
            title="Operasyon için okunabilir özet"
            description="Teknik sağlayıcı yanıtını operasyon diliyle özetler. Durum rozetleri backend değerini değiştirmez."
          >
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-medium text-zinc-500">Iyzico durumu</p>
                <div className="mt-2">
                  <OpsStatus label={submerchantStatus} />
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-600">
                  Bu rozet, sağlayıcıdan gelen alt üye işyeri veya ödeme hesabı durumunun sadeleştirilmiş karşılığıdır.
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-medium text-zinc-500">Son güncelleme</p>
                <p className="mt-2 text-sm font-semibold text-zinc-950">{formatDateTime(lastSyncedAt)}</p>
                <p className="mt-3 text-sm leading-6 text-zinc-600">
                  Bu tarih yoksa sağlayıcı yanıtında zaman bilgisi gelmemiş olabilir; sistem akışı yine de korunur.
                </p>
              </div>
            </div>
          </OpsSectionCard>

          <OpsKeyValueGrid
            items={[
              { label: "Alt üye işyeri tipi", value: submerchantType || "-" },
              { label: "Alt üye işyeri anahtarı", value: submerchantKey || "-" },
              { label: "Alt üye işyeri durumu", value: submerchantStatus || "-" },
              {
                label: "Yetkili kişi",
                value:
                  `${pickText(onboarding, ["kyc_contact_name"])} ${pickText(onboarding, ["kyc_contact_surname"])}`.trim() ||
                  "-",
              },
              { label: "Yetkili e-posta", value: pickText(onboarding, ["kyc_email"], "-") },
              { label: "IBAN", value: pickText(onboarding, ["kyc_iban"], "-") },
            ]}
          />

          <OpsSectionCard
            title="Teknik referanslar"
            description="Bu bilgiler sağlayıcı ile konuşurken gerekir. Kullanıcıya gösterilmez, sadece operasyon takibi içindir."
          >
            <OpsKeyValueGrid
              items={[
                { label: "Sağlayıcı referansı", value: providerReference || "-" },
                { label: "Conversation ID", value: conversationId || "-" },
                { label: "Hata kodu", value: errorCode || "-" },
              ]}
            />
          </OpsSectionCard>

          <OpsJsonCard
            title="Teknik yanıt kaydı"
            value={safeJsonStringify(onboarding)}
            description="Bu bölüm yalnızca ihtiyaç olduğunda teknik inceleme için kullanılır. Ödeme sağlayıcı alanları olduğu gibi korunur."
          />
        </>
      ) : null}
    </OpsPageShell>
  );
}
