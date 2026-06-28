"use client";

import { useParams } from "next/navigation";

import { SurpriseDealManager } from "@/components/business/surprise-deal-manager";
import { OpsPageShell } from "@/components/ops-console/shared";

export default function OpsBusinessSurpriseDealsPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);

  return (
    <OpsPageShell
      title="HalkTasarruf Paketlerini Yönet"
      description="İşletme adına sürpriz paketleri oluştur, düzenle, yayına al veya güvenli şekilde kapat."
      compact
      hideHero
    >
      <SurpriseDealManager businessId={businessId} variant="ops" />
    </OpsPageShell>
  );
}
