"use client";

import { useQuery } from "@tanstack/react-query";
import { BellOff, ShieldCheck } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { getBrowserPushState } from "@/features/notifications/api";
import { getBrowserGuidance, getBrowserPermissionPresentation } from "@/features/notifications/presentation";
import type { NotificationReadiness } from "@/features/notifications/types";

export function NotificationReadinessSummaryCard({ readiness }: { readiness: NotificationReadiness | null | undefined }) {
  const browserStateQuery = useQuery({
    queryKey: ["notifications", "browser-state"],
    queryFn: getBrowserPushState,
    staleTime: 15_000,
  });

  const ready = readiness?.notification_ready === true;
  const activeDeviceCount = readiness?.active_device_count ?? 0;
  const permittedDeviceCount = readiness?.active_permitted_device_count ?? 0;
  const deniedDeviceCount = readiness?.denied_permission_device_count ?? 0;
  const browserPresentation = getBrowserPermissionPresentation(browserStateQuery.data);
  const browserGuidance = getBrowserGuidance(browserStateQuery.data);

  return (
    <Card className="border-stone-200 shadow-sm">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <div
            className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl ${
              ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
            }`}
          >
            {ready ? <ShieldCheck className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-zinc-950">Bildirim durumu</h2>
              <StatusChip label={browserPresentation.label} tone={browserPresentation.tone} />
            </div>
            <p className="text-sm leading-6 text-zinc-600">
              Bildirim hazırlığı açık olduğunda checkout ve QR akışı daha güvenli ilerler.
            </p>
          </div>
        </div>

        <div className={`rounded-2xl p-4 text-sm leading-6 ${ready ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          <div className="font-medium">
            {ready ? "Bu cihaz bildirim almak için hazır görünüyor." : "Bildirim akışında tamamlanması gereken bir adım var."}
          </div>
          <p className="mt-2">{readiness?.message || browserPresentation.description}</p>
        </div>

        {browserGuidance ? (
          <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">
            <div className="font-medium text-zinc-950">{browserGuidance.title}</div>
            <p className="mt-2">{browserGuidance.description}</p>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Tarayıcı izni</div>
            <div className="mt-2 text-base font-semibold text-zinc-950">{browserPresentation.label}</div>
          </div>
          <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Aktif cihaz</div>
            <div className="mt-2 text-base font-semibold text-zinc-950">{activeDeviceCount}</div>
          </div>
          <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İzinli cihaz</div>
            <div className="mt-2 text-base font-semibold text-zinc-950">{permittedDeviceCount}</div>
          </div>
          <div className="rounded-2xl bg-zinc-50 p-4 text-sm text-zinc-700">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İzni kapalı cihaz</div>
            <div className="mt-2 text-base font-semibold text-zinc-950">{deniedDeviceCount}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
