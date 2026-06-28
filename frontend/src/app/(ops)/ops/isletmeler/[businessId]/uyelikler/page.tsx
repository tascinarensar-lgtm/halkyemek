"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  formatOpsRoleLabel,
  OpsActionResult,
  OpsCell,
  OpsEmpty,
  OpsLinkRow,
  OpsPageShell,
  OpsStatus,
  OpsTable,
} from "@/components/ops-console/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { deactivateOpsBusinessMembership, getOpsBusinessDetail, listOpsBusinessMemberships, upsertOpsBusinessMembership } from "@/features/ops-console/api";
import { invalidateOpsQueries, normalizeOpsId } from "@/features/ops-console/utils";
import { getApiErrorMessage } from "@/lib/api/errors";

const ROLE_OPTIONS = [
  { value: "OWNER", label: "İşletme sahibi" },
  { value: "MANAGER", label: "Yönetici" },
  { value: "CASHIER", label: "Kasa görevlisi" },
];

export default function OpsBusinessMembershipPage() {
  const params = useParams<{ businessId: string }>();
  const businessId = normalizeOpsId(params.businessId);
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("MANAGER");
  const [accessHalkYemek, setAccessHalkYemek] = useState(true);
  const [accessHalkTasarruf, setAccessHalkTasarruf] = useState(false);
  const [lastResult, setLastResult] = useState<{ tone: "success" | "warning" | "danger"; title: string; description?: string } | null>(null);

  const detailQuery = useQuery({
    queryKey: ["ops", "business", businessId],
    queryFn: () => getOpsBusinessDetail(businessId as number),
    enabled: businessId !== null,
  });
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
      const identifier = userId.trim();
      if (!identifier) {
        throw new Error("Geçerli bir kullanıcı numarası veya e-posta girin.");
      }
      if (!accessHalkYemek && !accessHalkTasarruf) {
        throw new Error("En az bir ürün erişimi seçin.");
      }
      if (identifier.includes("@")) {
        return upsertOpsBusinessMembership(businessId as number, {
          email: identifier,
          role,
          is_active: true,
          access_halkyemek: accessHalkYemek,
          access_halktasarruf: accessHalkTasarruf,
        });
      }
      const parsedUserId = Number(identifier);
      if (!Number.isFinite(parsedUserId) || parsedUserId <= 0) {
        throw new Error("Geçerli bir kullanıcı numarası veya e-posta girin.");
      }
      return upsertOpsBusinessMembership(businessId as number, {
        user_id: parsedUserId,
        role,
        is_active: true,
        access_halkyemek: accessHalkYemek,
        access_halktasarruf: accessHalkTasarruf,
      });
    },
    onSuccess: async () => {
      toast.success("Yetki kaydedildi");
      setLastResult({
        tone: "success",
        title: "İşletme yetkisi kaydedildi",
        description: `${userId} için ${formatOpsRoleLabel(role)} rolü aktif hale getirildi veya güncellendi.`,
      });
      setUserId("");
      setAccessHalkYemek(true);
      setAccessHalkTasarruf(false);
      await refresh();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "Yetki işlemi tamamlanamadı", description: message });
      toast.error(message);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (uid: number) => deactivateOpsBusinessMembership(businessId as number, uid),
    onSuccess: async (_data, uid) => {
      toast.success("Yetki pasifleştirildi");
      setLastResult({
        tone: "warning",
        title: "Kullanıcı yetkisi pasifleştirildi",
        description: `Kullanıcı #${uid} artık bu işletmenin aktif yetkilileri arasında görünmeyecek.`,
      });
      await refresh();
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "Pasifleştirme tamamlanamadı", description: message });
      toast.error(message);
    },
  });

  return (
    <OpsPageShell
      title="İşletme yetkilileri"
      description="İşletmeye erişebilen kullanıcıları, rollerini ve ürün bazlı erişimlerini yönet."
    >
      {businessId === null ? <ErrorState title="Geçersiz işletme" description="URL içindeki işletme numarası okunamadı." /> : null}
      <OpsLinkRow
        links={
          businessId
            ? [
                { href: `/ops/isletmeler/${businessId}`, label: "İşletme detayı" },
                { href: `/ops/isletmeler/${businessId}/durum`, label: "Durum yönetimi" },
                { href: `/ops/isletmeler/${businessId}/iyzico`, label: "Ödeme hesabı" },
              ]
            : []
        }
      />
      {lastResult ? <OpsActionResult tone={lastResult.tone} title={lastResult.title} description={lastResult.description} /> : null}

      <Card variant="surface">
        <CardContent className="space-y-5" padding="lg">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            <p className="font-semibold">Rol atamadan önce kontrol edin</p>
            <p className="mt-1">
              İşletme sahibi geniş yetkilere, yönetici operasyon alanlarına, kasa görevlisi teslim ve QR doğrulamaya erişir.
            </p>
          </div>
          <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,240px)_auto] lg:items-end">
            <label className="space-y-1">
              <span className="text-sm font-medium">Kullanıcı numarası veya e-posta</span>
              <input
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                placeholder="Örn. 42 veya yetkili@ornek.com"
                className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
              />
              <span className="block text-xs text-zinc-500">Kullanıcı ID ya da kayıtlı e-posta adresi kabul edilir.</span>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Verilecek rol</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value)}
                className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-950"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={!userId.trim() || upsertMutation.isPending || deactivateMutation.isPending}
              onClick={() => upsertMutation.mutate()}
              loading={upsertMutation.isPending}
              loadingText="Kaydediliyor..."
              className="w-full lg:w-auto"
            >
              Yetkiyi kaydet
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800">
              <span>HalkYemek erişimi</span>
              <input type="checkbox" checked={accessHalkYemek} onChange={(event) => setAccessHalkYemek(event.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-zinc-950" />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-semibold text-zinc-800">
              <span>HalkTasarruf erişimi</span>
              <input type="checkbox" checked={accessHalkTasarruf} onChange={(event) => setAccessHalkTasarruf(event.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-zinc-950" />
            </label>
          </div>
        </CardContent>
      </Card>

      {membershipsQuery.isPending || detailQuery.isPending ? <LoadingSkeleton /> : null}
      {membershipsQuery.isError ? <ErrorState title="Yetkililer yüklenemedi" description={getApiErrorMessage(membershipsQuery.error)} /> : null}
      {membershipsQuery.data ? (
        membershipsQuery.data.length > 0 ? (
          <OpsTable columns={["Kullanıcı", "Rol", "Ürün erişimi", "Durum", "Yetki veren", "İşlem"]}>
            {membershipsQuery.data.map((membership) => {
              const isDeactivating = deactivateMutation.isPending && deactivateMutation.variables === membership.user_id;
              return (
                <tr key={membership.id}>
                  <OpsCell>
                    <p className="font-semibold text-zinc-950">{membership.username || `Kullanıcı #${membership.user_id}`}</p>
                    <p className="text-xs text-zinc-500">{membership.email || "E-posta bilgisi yok"}</p>
                  </OpsCell>
                  <OpsCell>{formatOpsRoleLabel(membership.role)}</OpsCell>
                  <OpsCell>
                    <div className="flex flex-wrap gap-2">
                      {membership.access_halkyemek ? <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-[#f50555]">HalkYemek</span> : null}
                      {membership.access_halktasarruf ? <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700">HalkTasarruf</span> : null}
                      {!membership.access_halkyemek && !membership.access_halktasarruf ? <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-500">Kapalı</span> : null}
                    </div>
                  </OpsCell>
                  <OpsCell>
                    <OpsStatus label={membership.is_active ? "ACTIVE" : "INACTIVE"} />
                  </OpsCell>
                  <OpsCell>
                    <p>{membership.granted_by_username || membership.granted_by_id || "-"}</p>
                    <p className="text-xs text-zinc-500">Kullanıcı no: {membership.user_id}</p>
                  </OpsCell>
                  <OpsCell>
                    <Button
                      disabled={!membership.is_active || upsertMutation.isPending || deactivateMutation.isPending}
                      onClick={() => deactivateMutation.mutate(membership.user_id)}
                      variant="secondary"
                      size="sm"
                      loading={isDeactivating}
                      className="w-full sm:w-auto"
                      loadingText="Pasifleştiriliyor..."
                    >
                      Yetkiyi pasifleştir
                    </Button>
                  </OpsCell>
                </tr>
              );
            })}
          </OpsTable>
        ) : (
          <OpsEmpty
            title="Henüz aktif yetkili yok"
            description="İlk kullanıcı numarasını girip uygun rol ve ürün erişimini seçerek işletmeye güvenli erişim tanımlayabilirsiniz."
          />
        )
      ) : null}
    </OpsPageShell>
  );
}
