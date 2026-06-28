"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, RefreshCw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { getBrowserPushState, registerDevice } from "@/features/notifications/api";
import { getBrowserGuidance, getBrowserPermissionPresentation } from "@/features/notifications/presentation";
import type { BrowserNotificationState, NotificationReadiness } from "@/features/notifications/types";
import { getApiErrorMessage } from "@/lib/api/errors";

function shouldShowAction(browserState: BrowserNotificationState | undefined) {
  if (!browserState) {
    return true;
  }

  if (browserState.environment === "in_app_browser" || browserState.environment === "ios_home_screen_required") {
    return false;
  }

  return browserState.configured && browserState.secureContext && browserState.supported;
}

export function NotificationReadinessBanner({ readiness }: { readiness: NotificationReadiness | null | undefined }) {
  const [dismissed, setDismissed] = useState(false);
  const queryClient = useQueryClient();

  const browserStateQuery = useQuery({
    queryKey: ["notifications", "browser-state"],
    queryFn: getBrowserPushState,
    staleTime: 15_000,
  });

  const registerMutation = useMutation({
    mutationFn: () => registerDevice(),
    onSuccess: async (result) => {
      queryClient.setQueryData(["notifications", "readiness"], result.notification_readiness);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["topup"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      toast.success("Bildirim ayarÄ± gÃ¼ncellendi.");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Bildirim ayarÄ± gÃ¼ncellenemedi.")),
  });

  const browserPresentation = getBrowserPermissionPresentation(browserStateQuery.data);
  const browserGuidance = getBrowserGuidance(browserStateQuery.data);

  const helperMessage = useMemo(() => browserPresentation.description, [browserPresentation.description]);

  if (!readiness || readiness.notification_ready || dismissed) {
    return null;
  }

  return (
    <div className="rounded-3xl border border-amber-200 bg-[linear-gradient(180deg,_rgba(255,251,235,0.98),_rgba(255,247,237,0.96))] p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
            {browserPresentation.label === "Ä°zin kapalÄ±" ? <ShieldAlert className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          </div>
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-amber-950">Bildirimleri aÃ§arak gÃ¼ncel kal</h2>
            <p className="max-w-3xl text-sm leading-6 text-amber-900">
              Bildirimleri aÃ§arsanÄ±z sipariÅŸ durumlarÄ±, bakiye hareketleri ve fÄ±rsatlar hakkÄ±nda anlÄ±k bilgi alabilirsiniz.
            </p>
            <p className="text-sm leading-6 text-amber-800">{helperMessage}</p>
            {browserGuidance ? (
              <div className="rounded-2xl bg-white/70 p-4 text-sm leading-6 text-amber-950 ring-1 ring-amber-200">
                <div className="font-medium">{browserGuidance.title}</div>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {browserGuidance.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-amber-700">
              Aktif cihaz: {readiness.active_device_count}
              {typeof readiness.active_permitted_device_count === "number"
                ? ` â€¢ Ä°zinli cihaz: ${readiness.active_permitted_device_count}`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {shouldShowAction(browserStateQuery.data) ? (
            <button
              type="button"
              onClick={() => registerMutation.mutate()}
              disabled={registerMutation.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60"
            >
              {registerMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Bu cihazÄ± hazÄ±rla
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-amber-900 ring-1 ring-amber-200 transition hover:bg-amber-100"
          >
            Åžimdilik kapat
          </button>
        </div>
      </div>
    </div>
  );
}
