"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles, UtensilsCrossed, X } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { listBusinessMenuItems } from "@/features/business-operations/api";
import type { BusinessMenuItem } from "@/features/business-operations/types";
import { getApiErrorMessage, getApiRequestId } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";

export type BusinessManagedContentKind = "menu";

type ManagedContentData = {
  menu?: BusinessMenuItem[];
};

const CONTENT_CONFIG = {
  menu: {
    title: "Menüler",
    eyebrow: "İşletme menüleri",
    managedText: "Menü adı, fiyat, görsel ve yayın durumu HalkYemek operasyon ekibi tarafından yönetilir.",
    icon: UtensilsCrossed,
  },
} satisfies Record<BusinessManagedContentKind, { title: string; eyebrow: string; managedText: string; icon: typeof UtensilsCrossed }>;

async function loadManagedContent(businessId: number): Promise<ManagedContentData> {
  return { menu: await listBusinessMenuItems(businessId) };
}

function getCount(data: ManagedContentData) {
  return data.menu?.length ?? 0;
}

function Thumb({ url, label }: { url?: string | null; label: string }) {
  return (
    <div
      className={cn(
        "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-zinc-100 bg-zinc-100 bg-cover bg-center text-xs font-bold text-zinc-400",
        url ? "text-transparent" : "",
      )}
      style={url ? { backgroundImage: `url(${url})` } : undefined}
      aria-label={label}
    >
      HY
    </div>
  );
}

function MenuList({ items }: { items: BusinessMenuItem[] }) {
  if (!items.length) return <EmptyState title="Menü bulunmuyor" description="Bu işletme için henüz yayınlanmış menü kaydı görünmüyor." />;

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <article key={item.id} className="group flex gap-3 rounded-[24px] border border-zinc-100 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-[#f50555]/20 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)] sm:p-4">
          <Thumb url={item.primary_image_url || item.image_url} label={item.name} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="truncate font-semibold text-zinc-950">{item.name}</h3>
                {item.description ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-zinc-500">{item.description}</p> : null}
              </div>
              <div className="shrink-0 text-sm font-semibold text-[#f50555]"><AmountText amount={item.price_amount} /></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="rounded-full bg-zinc-100 px-3 py-1 text-zinc-600">{item.category_name || "Kategori yok"}</span>
              <span className={cn("rounded-full px-3 py-1", item.is_available ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")}>{item.is_available ? "Aktif" : "Kontrol gerekli"}</span>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

function ContentBody({ data }: { data: ManagedContentData }) {
  return <MenuList items={data.menu ?? []} />;
}

export function BusinessManagedContentModal({
  businessId,
  kind,
  onClose,
}: {
  businessId: number;
  kind: BusinessManagedContentKind;
  onClose: () => void;
}) {
  const config = CONTENT_CONFIG[kind];
  const Icon = config.icon;
  const query = useQuery({
    queryKey: ["business-managed-content", businessId, kind],
    queryFn: () => loadManagedContent(businessId),
    enabled: Number.isFinite(businessId) && businessId > 0,
  });
  const count = query.data ? getCount(query.data) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-950/55 p-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6" onClick={onClose}>
      <section
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[32px] bg-white shadow-[0_34px_110px_rgba(15,23,42,0.35)] ring-1 ring-white/40 sm:max-h-[88vh] sm:rounded-[32px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative overflow-hidden bg-zinc-950 p-5 pb-6 text-white sm:p-7">
          <div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-[#f50555]/35 blur-2xl" />
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-zinc-950 shadow-lg transition hover:scale-105 hover:bg-rose-50 active:scale-95 sm:right-4 sm:top-4"
            aria-label="Menü kartını kapat"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="relative z-10 flex flex-col gap-4 pr-12 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-white/80 ring-1 ring-white/10">
                <Icon className="h-3.5 w-3.5 text-[#ff78a2]" />
                {config.eyebrow}
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-[-0.055em] sm:text-4xl">{config.title}</h2>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 text-zinc-950">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Kayıt</p>
              <p className="mt-1 text-2xl font-semibold">{query.isPending ? "-" : count}</p>
            </div>
          </div>
        </div>

        <div className="border-b border-zinc-100 bg-[#fff7fa] px-5 py-4 sm:px-7">
          <div className="flex items-start gap-3 rounded-2xl bg-white p-4 text-sm leading-6 text-zinc-700 shadow-sm ring-1 ring-rose-100">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#f50555]" />
            <p>{config.managedText}</p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-zinc-50/70 p-5 sm:p-7">
          {query.isPending ? <LoadingSkeleton /> : null}
          {query.isError ? (
            <ErrorState
              title={`${config.title} yüklenemedi`}
              description={`${getApiErrorMessage(query.error)}${getApiRequestId(query.error) ? ` · request_id: ${getApiRequestId(query.error)}` : ""}`}
            />
          ) : null}
          {query.data ? <ContentBody data={query.data} /> : null}
        </div>
      </section>
    </div>
  );
}
