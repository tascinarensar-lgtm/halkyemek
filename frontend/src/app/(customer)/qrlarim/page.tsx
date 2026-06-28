"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Hash, QrCode, ReceiptText, ShieldCheck, Store, TimerOff, X, XCircle } from "lucide-react";
import { toast } from "sonner";

import { AmountText } from "@/components/ui/amount-text";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PendingButton } from "@/components/ui/pending-button";
import { PageContainer } from "@/components/ui/page-container";
import { cancelCheckoutSession, listCheckoutSessions } from "@/features/cart/api";
import type { CheckoutSessionDetail } from "@/features/cart/types";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

const TEXT = {
  qrlarim: "QRlar\u0131m",
  qrHistory: "QR ge\u00e7mi\u015fin",
  newOrder: "Yeni sipari\u015f olu\u015ftur",
  active: "Aktif",
  used: "Kullan\u0131ld\u0131",
  cancelled: "\u0130ptal",
  expired: "S\u00fcresi doldu",
  amount: "Tutar",
  total: "\u00d6denecek tutar",
  order: "Sipari\u015f",
  business: "\u0130\u015fletme",
  cashierCode: "Kasa kodu",
  validity: "Son ge\u00e7erlilik",
  created: "Olu\u015fturuldu",
  activeQr: "Aktif QR",
  pastQr: "Ge\u00e7mi\u015f QR",
  showAtCashier: "Kasada bu kart\u0131 g\u00f6ster",
  notUsable: "Bu QR art\u0131k kullan\u0131lamaz",
  close: "QR kart\u0131n\u0131 kapat",
  cancelQr: "QR kodunu iptal et",
  cancelling: "\u0130ptal ediliyor...",
  qrCancelled: "QR iptal edildi.",
  qrCancelledDesc: "Sepet ak\u0131\u015f\u0131 yenilendi.",
  cancelFailed: "QR iptal edilemedi.",
  loadingFailed: "QRlar y\u00fcklenemedi",
  loadingFailedDesc: "QR kay\u0131tlar\u0131n \u015fu anda getirilemedi.",
  emptyTitle: "Hen\u00fcz QR kayd\u0131n yok",
  emptyDesc: "Sipari\u015fini olu\u015fturdu\u011funda aktif ve ge\u00e7mi\u015f QR kartlar\u0131n burada g\u00f6r\u00fcn\u00fcr.",
  openQr: "QR kart\u0131n\u0131 a\u00e7",
  scanReady: "Okutmaya haz\u0131r",
  unavailable: "Pasif",
  fallbackItem: "\u00dcr\u00fcn",
  multiItemOrder: "\u00fcr\u00fcnl\u00fck sipari\u015f",
};

function isExpired(session: CheckoutSessionDetail) {
  return session.status === "EXPIRED" || (session.expires_at ? new Date(session.expires_at).getTime() <= Date.now() : false);
}

function isActive(session: CheckoutSessionDetail) {
  return ["PENDING", "CONFIRMED"].includes(session.status) && !isExpired(session);
}

function getStatusMeta(session: CheckoutSessionDetail) {
  if (isActive(session)) {
    return {
      label: TEXT.active,
      shortLabel: TEXT.scanReady,
      icon: QrCode,
      chipClassName: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      cardClassName: "border-emerald-200 bg-[linear-gradient(145deg,#ffffff,#f6fffb)]",
      iconClassName: "bg-emerald-600 text-white shadow-[0_14px_34px_rgba(5,150,105,0.25)]",
    };
  }
  if (session.status === "CONSUMED") {
    return {
      label: TEXT.used,
      shortLabel: TEXT.pastQr,
      icon: CheckCircle2,
      chipClassName: "bg-blue-50 text-blue-700 ring-blue-100",
      cardClassName: "border-blue-100 bg-white",
      iconClassName: "bg-blue-50 text-blue-700",
    };
  }
  if (session.status === "CANCELLED") {
    return {
      label: TEXT.cancelled,
      shortLabel: TEXT.unavailable,
      icon: XCircle,
      chipClassName: "bg-red-50 text-red-700 ring-red-100",
      cardClassName: "border-red-100 bg-white",
      iconClassName: "bg-red-50 text-red-700",
    };
  }
  return {
    label: TEXT.expired,
    shortLabel: TEXT.unavailable,
    icon: TimerOff,
    chipClassName: "bg-zinc-100 text-zinc-600 ring-zinc-200",
    cardClassName: "border-zinc-200 bg-white",
    iconClassName: "bg-zinc-100 text-zinc-600",
  };
}

function getPrimaryItemName(session: CheckoutSessionDetail) {
  const first = session.items[0];
  if (!first) return `${session.item_count} ${TEXT.multiItemOrder}`;
  return repairPotentialMojibake(first.menu_item_name || first.name || `${TEXT.fallbackItem} ${first.menu_item_id}`);
}

function getSessionTitle(session: CheckoutSessionDetail) {
  return session.items.length === 1 ? getPrimaryItemName(session) : `${session.item_count} ${TEXT.multiItemOrder}`;
}

function getDisplayDate(session: CheckoutSessionDetail) {
  if (isActive(session)) return formatDateTime(session.expires_at);
  return formatDateTime(session.consumed_at || session.cancelled_at || session.created_at);
}

function QrImage({ value }: { value: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 360 })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [value]);

  if (!src) {
    return <div className="flex aspect-square w-full items-center justify-center rounded-[28px] bg-zinc-100 text-sm font-semibold text-zinc-500">QR hazırlanıyor...</div>;
  }

  // QR is generated as a local data URL, so next/image optimization is not useful here.
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="Teslim QR kodu" src={src} className="aspect-square w-full rounded-[28px] border border-zinc-100 bg-white p-2" />;
}

function SummaryTile({ label, value, tone = "zinc" }: { label: string; value: string | number; tone?: "zinc" | "rose" | "emerald" }) {
  const toneClassName =
    tone === "rose"
      ? "bg-rose-50 text-[#f50555]"
      : tone === "emerald"
        ? "bg-emerald-50 text-emerald-700"
        : "bg-zinc-50 text-zinc-950";

  return (
    <div className={`rounded-[24px] px-5 py-4 ${toneClassName}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-70">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.04em]">{value}</p>
    </div>
  );
}

function SessionCard({ session, onOpen }: { session: CheckoutSessionDetail; onOpen: (session: CheckoutSessionDetail) => void }) {
  const meta = getStatusMeta(session);
  const Icon = meta.icon;
  const businessName = repairPotentialMojibake(session.business.name);

  return (
    <article className={`group rounded-[28px] border p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.10)] ${meta.cardClassName}`}>
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => onOpen(session)}
          className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl transition group-hover:scale-[1.03] ${meta.iconClassName}`}
          aria-label={TEXT.openQr}
        >
          <QrCode className="h-6 w-6" />
        </button>

        <button type="button" onClick={() => onOpen(session)} className="min-w-0 flex-1 text-left" aria-label={TEXT.openQr}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${meta.chipClassName}`}>
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
            </span>
            <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold text-zinc-500 ring-1 ring-zinc-100">{meta.shortLabel}</span>
          </div>
          <h2 className="mt-3 truncate text-lg font-semibold tracking-[-0.04em] text-zinc-950">{getSessionTitle(session)}</h2>
          <p className="mt-1 truncate text-sm font-medium text-zinc-500">{businessName}</p>
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl bg-white/82 px-4 py-3 ring-1 ring-zinc-100">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{TEXT.amount}</p>
          <p className="mt-1 text-base font-semibold text-zinc-950">
            <AmountText amount={session.total_payable_amount} currency={session.currency} />
          </p>
        </div>
        <div className="rounded-2xl bg-white/82 px-4 py-3 ring-1 ring-zinc-100">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{session.cashier_code ? TEXT.cashierCode : TEXT.created}</p>
          <p className="mt-1 truncate text-base font-semibold tracking-[0.12em] text-zinc-950">{session.cashier_code || formatDateTime(session.created_at)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-xs font-medium text-zinc-500">
        <Clock3 className="h-3.5 w-3.5" />
        <span>{isActive(session) ? TEXT.validity : TEXT.created}: {getDisplayDate(session)}</span>
      </div>
    </article>
  );
}

function QrSessionModal({ session, onClose }: { session: CheckoutSessionDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const active = isActive(session);
  const meta = getStatusMeta(session);
  const Icon = meta.icon;
  const businessName = repairPotentialMojibake(session.business.name);
  const cancelMutation = useMutation({
    mutationFn: () => cancelCheckoutSession(session.token),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["checkout-session"] }),
        queryClient.invalidateQueries({ queryKey: ["checkout-sessions", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
      ]);
      toast.success(TEXT.qrCancelled, { description: TEXT.qrCancelledDesc });
      onClose();
    },
    onError: (error) => toast.error(describeApiError(error, TEXT.cancelFailed)),
  });

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-zinc-950/58 px-3 py-4 backdrop-blur-[3px] sm:px-5 sm:py-8"
      role="dialog"
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button type="button" aria-label={TEXT.close} className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative z-10 grid max-h-[calc(100vh-2rem)] w-full max-w-[820px] overflow-hidden rounded-[32px] bg-white shadow-[0_30px_110px_rgba(0,0,0,0.30)] lg:grid-cols-[0.92fr_1.08fr]">
        <button
          type="button"
          aria-label={TEXT.close}
          onClick={onClose}
          className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/96 text-zinc-700 shadow-[0_10px_30px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:text-[#f50555]"
        >
          <X className="h-5 w-5" />
        </button>

        <div className={`flex items-center justify-center p-5 sm:p-7 ${active ? "bg-[radial-gradient(circle_at_50%_0%,#ffe2eb,#ffffff_58%)]" : "bg-zinc-50"}`}>
          <div className="w-full max-w-[360px] rounded-[34px] border border-white bg-white/88 p-4 shadow-[0_20px_70px_rgba(15,23,42,0.10)]">
            {active ? (
              <QrImage value={session.token} />
            ) : (
              <div className="flex aspect-square w-full flex-col items-center justify-center rounded-[28px] border border-dashed border-zinc-200 bg-zinc-50 text-center">
                <Icon className="h-12 w-12 text-zinc-400" />
                <p className="mt-4 text-lg font-semibold tracking-[-0.03em] text-zinc-950">{TEXT.notUsable}</p>
                <p className="mt-1 text-sm text-zinc-500">{meta.label}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex max-h-[calc(100vh-2rem)] flex-col overflow-y-auto p-5 sm:p-7">
          <div className="pr-12">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${meta.chipClassName}`}>
              <Icon className="h-3.5 w-3.5" />
              {active ? TEXT.activeQr : meta.label}
            </span>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.055em] text-zinc-950">{active ? TEXT.showAtCashier : getSessionTitle(session)}</h2>
            <p className="mt-2 text-sm font-medium text-zinc-500">{businessName}</p>
          </div>

          <div className="mt-6 rounded-[28px] bg-[#f50555] p-5 text-white shadow-[0_18px_46px_rgba(245,5,85,0.24)]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/65">{TEXT.total}</p>
            <div className="mt-2 text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
              <AmountText amount={session.total_payable_amount} currency={session.currency} />
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{TEXT.order}</p>
              <p className="mt-1 truncate text-base font-semibold text-zinc-950">{getSessionTitle(session)}</p>
            </div>
            <div className="rounded-2xl bg-zinc-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">{TEXT.business}</p>
              <p className="mt-1 truncate text-base font-semibold text-zinc-950">{businessName}</p>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-zinc-50 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                <Hash className="h-3.5 w-3.5" /> {TEXT.cashierCode}
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-[0.18em] text-zinc-950">{session.cashier_code || "-"}</p>
            </div>
            <div className="rounded-2xl bg-zinc-50 px-4 py-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                <Clock3 className="h-3.5 w-3.5" /> {active ? TEXT.validity : TEXT.created}
              </p>
              <p className="mt-2 text-sm font-semibold text-zinc-950">{getDisplayDate(session)}</p>
            </div>
          </div>

          {active ? (
            <div className="mt-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-medium leading-6 text-emerald-800 ring-1 ring-emerald-100">
              <ShieldCheck className="mr-2 inline h-4 w-4" />
              {TEXT.scanReady}. {TEXT.cashierCode.toLocaleLowerCase("tr-TR")} QR okunamazsa kullanılabilir.
            </div>
          ) : null}

          {active ? (
            <div className="mt-5 border-t border-zinc-100 pt-4">
              <PendingButton
                type="button"
                onClick={() => cancelMutation.mutate()}
                pending={cancelMutation.isPending}
                pendingText={TEXT.cancelling}
                className="inline-flex w-full items-center justify-center rounded-2xl bg-zinc-100 px-5 py-3 text-sm font-semibold text-zinc-900 transition hover:-translate-y-0.5 hover:bg-zinc-200"
              >
                {TEXT.cancelQr}
              </PendingButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function MyQrCodesPage() {
  const [selectedSession, setSelectedSession] = useState<CheckoutSessionDetail | null>(null);
  const sessionsQuery = useQuery({
    queryKey: ["checkout-sessions", "list", "all"],
    queryFn: () => listCheckoutSessions({ status: "all", page_size: 50 }),
    retry: 0,
  });

  const sessions = sessionsQuery.data?.results ?? [];
  const activeSessions = sessions.filter(isActive);
  const historySessions = sessions.filter((session) => !isActive(session));
  const usedCount = sessions.filter((session) => session.status === "CONSUMED").length;
  const expiredCount = sessions.filter((session) => isExpired(session)).length;

  return (
    <PageContainer className="space-y-6 bg-[linear-gradient(180deg,#fff7fa_0%,#ffffff_220px)]">
      <section className="overflow-hidden rounded-[32px] border border-rose-100 bg-white p-5 shadow-[0_24px_80px_rgba(245,5,85,0.08)] sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#f50555] ring-1 ring-rose-100">
              <QrCode className="h-3.5 w-3.5" /> {TEXT.qrlarim}
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.055em] text-zinc-950 sm:text-4xl">{TEXT.qrHistory}</h1>
          </div>
          <Link href="/" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(245,5,85,0.20)] transition hover:-translate-y-0.5 hover:bg-[#dc004c]">
            {TEXT.newOrder}
            <ReceiptText className="h-4 w-4" />
          </Link>
        </div>

        {sessions.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <SummaryTile label={TEXT.active} value={activeSessions.length} tone="emerald" />
            <SummaryTile label={TEXT.used} value={usedCount} tone="rose" />
            <SummaryTile label={TEXT.expired} value={expiredCount} />
          </div>
        ) : null}
      </section>

      {sessionsQuery.isPending ? <LoadingSkeleton /> : null}
      {sessionsQuery.isError ? <ErrorState title={TEXT.loadingFailed} description={describeApiError(sessionsQuery.error, TEXT.loadingFailedDesc)} /> : null}

      {!sessionsQuery.isPending && !sessionsQuery.isError && sessions.length === 0 ? (
        <EmptyState title={TEXT.emptyTitle} description={TEXT.emptyDesc} />
      ) : null}

      {activeSessions.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <QrCode className="h-4 w-4 text-emerald-700" /> {TEXT.activeQr}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {activeSessions.map((session) => <SessionCard key={session.id} session={session} onOpen={setSelectedSession} />)}
          </div>
        </section>
      ) : null}

      {historySessions.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <Store className="h-4 w-4" /> {TEXT.pastQr}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {historySessions.map((session) => <SessionCard key={session.id} session={session} onOpen={setSelectedSession} />)}
          </div>
        </section>
      ) : null}

      {selectedSession ? <QrSessionModal session={selectedSession} onClose={() => setSelectedSession(null)} /> : null}
    </PageContainer>
  );
}
