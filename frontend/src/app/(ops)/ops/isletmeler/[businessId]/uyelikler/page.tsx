"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { OpsActionResult, OpsCell, OpsEmpty, OpsLinkRow, OpsPageShell, OpsStatus, OpsTable } from "@/components/ops-console/shared";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { deactivateOpsBusinessMembership, getOpsBusinessDetail, listOpsBusinessMemberships, upsertOpsBusinessMembership } from "@/features/ops-console/api";
import { invalidateOpsQueries, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

export default function OpsBusinessMembershipPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("MANAGER");
  const [lastResult, setLastResult] = useState<{ tone: "success" | "warning" | "danger"; title: string; description?: string } | null>(null);

  const detailQuery = useQuery({ queryKey: ["ops", "business", businessId], queryFn: () => getOpsBusinessDetail(businessId as number), enabled: businessId !== null });
  const membershipsQuery = useQuery({
    queryKey: ["ops", "business-memberships", businessId],
    queryFn: () => listOpsBusinessMemberships(businessId as number),
    enabled: businessId !== null,
  });

  const refresh = async () => {
    await invalidateOpsQueries(queryClient, [["ops", "business-memberships", businessId], ["ops", "business", businessId], ["ops", "businesses"]]);
    await Promise.all([membershipsQuery.refetch(), detailQuery.refetch()]);
  };

  const upsertMutation = useMutation({
    mutationFn: () => {
      const parsedUserId = Number(userId);
      if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) {
        throw new Error("Geçerli bir user id girin.");
      }
      return upsertOpsBusinessMembership(businessId as number, { user_id: parsedUserId, role, is_active: true });
    },
    onSuccess: async () => {
      toast.success("Üyelik kaydedildi");
      setLastResult({ tone: "success", title: "Üyelik işlemi tamamlandı", description: `user_id=${userId} için ${role} rolü kaydedildi veya güncellendi.` });
      setUserId("");
      await refresh();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "Üyelik işlemi başarısız", description: message });
      toast.error(message);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (uid: number) => deactivateOpsBusinessMembership(businessId as number, uid),
    onSuccess: async (_data, uid) => {
      toast.success("Üyelik pasifleştirildi");
      setLastResult({ tone: "warning", title: "Üyelik pasifleştirildi", description: `user_id=${uid} artık aktif membership listesinde görünmeyecek.` });
      await refresh();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "Pasifleştirme başarısız", description: message });
      toast.error(message);
    },
  });

  return (
    <OpsPageShell title="Üyelik yönetimi" description="Create, role update ve deactivate akışlarını business bazında yönet.">
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki businessId değeri okunamadı." /> : null}
      <OpsLinkRow links={businessId ? [
        { href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" },
        { href: `/ops/isletmeler/${businessId}/durum`, label: "Durum" },
        { href: `/ops/isletmeler/${businessId}/iyzico`, label: "Iyzico" },
      ] : []} />
      {lastResult ? <OpsActionResult tone={lastResult.tone} title={lastResult.title} description={lastResult.description} /> : null}
      <Card>
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="space-y-1">
            <p className="text-sm font-medium">User ID</p>
            <input value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Role</p>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm">
              <option value="OWNER">OWNER</option>
              <option value="MANAGER">MANAGER</option>
              <option value="CASHIER">CASHIER</option>
            </select>
          </div>
          <button disabled={!userId.trim() || upsertMutation.isPending || deactivateMutation.isPending} onClick={() => upsertMutation.mutate()} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:bg-zinc-300">
            {upsertMutation.isPending ? "Kaydediliyor..." : "Kaydet / güncelle"}
          </button>
        </CardContent>
      </Card>
      {membershipsQuery.isPending || detailQuery.isPending ? <LoadingSkeleton /> : null}
      {membershipsQuery.isError ? <ErrorState title="Üyelikler yüklenemedi" description={getApiErrorMessage(membershipsQuery.error)} /> : null}
      {membershipsQuery.data ? (
        membershipsQuery.data.length > 0 ? (
          <OpsTable columns={["Kullanıcı", "Role", "Active", "Grant", "Aksiyon"]}>
            {membershipsQuery.data.map((membership) => {
              const isDeactivating = deactivateMutation.isPending && deactivateMutation.variables === membership.user_id;
              return (
                <tr key={membership.id}>
                  <OpsCell>
                    <p className="font-medium">{membership.username || membership.user_id}</p>
                    <p className="text-xs text-zinc-500">{membership.email || "email yok"}</p>
                  </OpsCell>
                  <OpsCell>{membership.role}</OpsCell>
                  <OpsCell><OpsStatus label={membership.is_active ? "ACTIVE" : "INACTIVE"} /></OpsCell>
                  <OpsCell>
                    <p>{membership.granted_by_username || membership.granted_by_id || "-"}</p>
                    <p className="text-xs text-zinc-500">id: {membership.user_id}</p>
                  </OpsCell>
                  <OpsCell>
                    <button
                      disabled={!membership.is_active || upsertMutation.isPending || deactivateMutation.isPending}
                      onClick={() => deactivateMutation.mutate(membership.user_id)}
                      className="rounded-xl bg-zinc-100 px-3 py-2 text-xs font-medium disabled:bg-zinc-200"
                    >
                      {isDeactivating ? "Pasifleştiriliyor..." : "Pasifleştir"}
                    </button>
                  </OpsCell>
                </tr>
              );
            })}
          </OpsTable>
        ) : (
          <OpsEmpty title="Aktif membership yok" description="İlk user_id değerini girerek role atayabilirsiniz." />
        )
      ) : null}
    </OpsPageShell>
  );
}
