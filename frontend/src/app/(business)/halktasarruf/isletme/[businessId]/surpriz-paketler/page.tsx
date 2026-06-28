"use client";

import { useParams } from "next/navigation";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { SurpriseDealManager } from "@/components/business/surprise-deal-manager";
import { PageContainer } from "@/components/ui/page-container";

export default function HalkTasarrufBusinessSurpriseDealsPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);

  return (
    <PageContainer className="bg-white">
      <BusinessPanelShell businessId={businessId}>
        <SurpriseDealManager businessId={businessId} variant="business" />
      </BusinessPanelShell>
    </PageContainer>
  );
}
