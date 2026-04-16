"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getRoleLabel } from "@/components/business/business-role";
import { getApiErrorMessage, parseJsonResponse } from "@/lib/api/errors";
import { SESSION_QUERY_KEY } from "@/lib/query/keys";
import type { BusinessMembershipSummary, SessionState } from "@/types/auth";

export function BusinessSwitcher({
  businesses,
  activeBusinessId,
  redirectBase = "/isletme",
  compact = false,
}: {
  businesses: BusinessMembershipSummary[];
  activeBusinessId: number | null;
  redirectBase?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();

  async function handleChange(nextBusinessId: string) {
    if (!nextBusinessId) return;

    const nextId = Number(nextBusinessId);
    if (!Number.isFinite(nextId) || nextId === activeBusinessId) {
      return;
    }

    const matchedBusiness = businesses.find((item) => item.id === nextId);
    if (!matchedBusiness) {
      toast.error("Seçilen işletme bu oturumda görünmüyor. Oturumu yenileyip tekrar deneyin.");
      return;
    }

    try {
      const response = await fetch("/api/auth/session/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: nextId }),
      });
      const payload = await parseJsonResponse<SessionState | { ok?: boolean; error?: unknown }>(response);

      if (!response.ok || !payload) {
        throw payload ?? new Error("Aktif işletme güncellenemedi.");
      }

      queryClient.setQueryData(SESSION_QUERY_KEY, payload as SessionState);
      await queryClient.invalidateQueries({ queryKey: ["business-operations"] });
      await queryClient.invalidateQueries({ queryKey: ["business-management"] });

      startTransition(() => {
        router.push(`${redirectBase}/${nextId}`);
        router.refresh();
      });
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Aktif işletme değiştirilemedi."));
    }
  }

  return (
    <div className="space-y-2">
      {!compact ? <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Aktif işletme</p> : null}
      <select
        className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm disabled:bg-zinc-50 disabled:text-zinc-500"
        value={activeBusinessId ?? businesses[0]?.id ?? ""}
        onChange={(event) => void handleChange(event.target.value)}
        disabled={isPending || businesses.length <= 1}
      >
        {businesses.map((business) => (
          <option key={business.id} value={business.id}>
            {business.name} · {getRoleLabel(business.member_role)}
          </option>
        ))}
      </select>
      {businesses.length === 1 ? (
        <p className="text-xs text-zinc-500">Bu hesap için tek işletme erişimi açık. Panel bu işletme üzerinden devam eder.</p>
      ) : (
        <p className="text-xs text-zinc-500">Seçimi değiştirdiğinde işletme paneli yeni işletme üzerinden açılır.</p>
      )}
    </div>
  );
}
