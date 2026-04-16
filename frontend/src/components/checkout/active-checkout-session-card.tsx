"use client";

import Link from "next/link";
import { Clock3, QrCode, Store } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import type { CheckoutSessionDetail } from "@/features/cart/types";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

export function ActiveCheckoutSessionCard({
  session,
  title = "Hazır QR kodun burada seni bekliyor",
  description = "Siparişin için QR kod oluşturulmuş durumda. Dilersen kaldığın yerden devam edebilir veya bu sipariş özetini burada inceleyebilirsin.",
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
}: {
  session: CheckoutSessionDetail;
  title?: string;
  description?: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
      <CardContent className="space-y-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
              <QrCode className="h-3.5 w-3.5" /> Aktif teslim kodu
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">{title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{description}</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ödenen tutar</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-950">
                <AmountText amount={session.total_payable_amount} currency={session.currency} />
              </div>
            </div>
            <div className="rounded-2xl border border-white/80 bg-white/85 p-4 shadow-sm">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ürün adedi</div>
              <div className="mt-2 text-2xl font-semibold text-zinc-950">{session.item_count}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_0.92fr]">
          <div className="space-y-3">
            {session.items.map((item, index) => (
              <div key={`${item.menu_item_id}-${index}`} className="rounded-2xl bg-white/85 p-4 text-sm shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-zinc-950">
                      {repairPotentialMojibake(item.name || item.menu_item_name || `Ürün ${item.menu_item_id}`)}
                    </p>
                    <p className="mt-1 text-zinc-500">{item.quantity} adet</p>
                  </div>
                  <div className="font-medium text-zinc-900">
                    <AmountText amount={item.line_total_amount} currency={session.currency} />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl bg-zinc-950 p-5 text-white">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-200">
                <Store className="h-4 w-4" /> Teslim noktası
              </div>
              <div className="mt-3 text-xl font-semibold">{repairPotentialMojibake(session.business.name)}</div>
              <div className="mt-4 flex items-start gap-2 text-sm text-zinc-200">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Son geçerlilik zamanı: {formatDateTime(session.expires_at)}</p>
              </div>
            </div>

            {(primaryHref && primaryLabel) || (secondaryHref && secondaryLabel) ? (
              <div className="grid gap-2">
                {primaryHref && primaryLabel ? (
                  <Link href={primaryHref} className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                    {primaryLabel}
                  </Link>
                ) : null}
                {secondaryHref && secondaryLabel ? (
                  <Link href={secondaryHref} className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                    {secondaryLabel}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
