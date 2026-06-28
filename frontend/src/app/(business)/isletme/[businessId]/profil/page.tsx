"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Eye, Store, UserRound } from "lucide-react";

import { BusinessPanelShell } from "@/components/business/business-panel-shell";
import { getRoleLabel } from "@/components/business/business-role";
import { CustomerBottomSection } from "@/components/layout/customer-bottom-section";
import { Card, CardContent } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page-container";
import { QueryState } from "@/components/ui/query-state";
import { StatusChip } from "@/components/ui/status-chip";
import { getBusinessProfileOperations } from "@/features/business-operations/api";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { repairPotentialMojibake } from "@/lib/utils/text";

function getListingTypeLabel(listingType: string) {
  if (listingType === "CONTRACTED") return "Anlaşmalı işletme";
  if (listingType === "VOLUNTEER") return "Gönüllü işletme";
  return listingType || "İşletme";
}

export default function BusinessProfilePage() {
  const params = useParams<{ businessId: string }>();
  const businessId = Number(params.businessId);

  const profileQuery = useQuery({
    queryKey: ["business-operations", businessId, "profile"],
    queryFn: () => getBusinessProfileOperations(businessId),
    enabled: Number.isFinite(businessId),
  });

  return (
    <PageContainer className="bg-white">
      <BusinessPanelShell businessId={businessId}>
        <div className="space-y-6">
          <QueryState
            isPending={profileQuery.isPending}
            isError={profileQuery.isError}
            error={profileQuery.error}
            data={profileQuery.data}
            errorTitle="Profil yüklenemedi"
            errorDescription={`${getApiErrorMessage(profileQuery.error)}${
              getApiRequestId(profileQuery.error) ? ` · request_id: ${getApiRequestId(profileQuery.error)}` : ""
            }`}
            emptyTitle="Profil verisi bulunamadı"
            emptyDescription="Bu işletme için gösterilebilir profil bilgisi dönmedi."
          >
            {(profile) => (
              <section className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-[0_14px_45px_rgba(15,23,42,0.05)] sm:rounded-[26px] sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-[#f50555]">
                      <Store className="h-3.5 w-3.5" /> İşletme profili
                    </div>
                    <h1 className="mt-4 text-2xl font-semibold tracking-[-0.05em] text-zinc-950 sm:text-3xl">
                      {repairPotentialMojibake(profile.business_name)}
                    </h1>
                    <p className="mt-2 text-sm text-zinc-500">Panelde görünen temel işletme bilgileri.</p>
                  </div>

                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <StatusChip label={getRoleLabel(profile.member_role)} tone="default" />
                    <StatusChip label={profile.marketplace_is_visible ? "Yayında" : "Kapalı"} tone={profile.marketplace_is_visible ? "success" : "default"} />
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Card className="border-zinc-100 bg-zinc-50 shadow-none">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        <UserRound className="h-3.5 w-3.5" /> Rol
                      </div>
                      <p className="mt-2 text-base font-semibold text-zinc-950">{getRoleLabel(profile.member_role)}</p>
                    </CardContent>
                  </Card>

                  <Card className="border-zinc-100 bg-zinc-50 shadow-none">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        <Eye className="h-3.5 w-3.5" /> Görünürlük
                      </div>
                      <p className="mt-2 text-base font-semibold text-zinc-950">{profile.marketplace_is_visible ? "Pazaryerinde açık" : "Pazaryerinde kapalı"}</p>
                    </CardContent>
                  </Card>

                  <Card className="border-zinc-100 bg-zinc-50 shadow-none">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        <Store className="h-3.5 w-3.5" /> Tür
                      </div>
                      <p className="mt-2 text-base font-semibold text-zinc-950">{getListingTypeLabel(profile.listing_type)}</p>
                    </CardContent>
                  </Card>
                </div>
              </section>
            )}
          </QueryState>

          <CustomerBottomSection />
        </div>
      </BusinessPanelShell>
    </PageContainer>
  );
}
