"use client";

import Link from "next/link";
import { ArrowRight, Clock3, QrCode, Store } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import type { CheckoutSessionDetail } from "@/features/cart/types";
import { formatDateTime } from "@/lib/utils/format";
import { repairPotentialMojibake } from "@/lib/utils/text";

export function ActiveCheckoutSessionCard({
  session,
  title = "Hazır QR kodun burada seni bekliyor",
  description = "Siparişin için QR kod oluşturuldu. Dilersen kaldığın yerden devam edebilirsin.",
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
    <Card className="overflow-hidden border-rose-100 bg-[radial-gradient(circle_at_top_left,_rgba(245,5,85,0.13),_transparent_32%),linear-gradient(135deg,_#fff,_#fff7fb_58%,_#fff)] shadow-[0_24px_80px_rgba(245,5,85,0.10)]">
      <CardContent className="p-0">
        <div className="grid gap-0 lg:grid-cols-[1.04fr_0.96fr]">
          <div className="space-y-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#f50555] text-white shadow-[0_16px_34px_rgba(245,5,85,0.24)]">
                <QrCode className="h-5 w-5" />
              </span>
              <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#f50555] shadow-sm ring-1 ring-rose-100">
                Aktif QR
              </span>
            </div>

            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.045em] text-zinc-950 sm:text-3xl">{title}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{description}</p>
            </div>

            <div className="rounded-[26px] bg-[#f50555] p-5 text-white shadow-[0_18px_44px_rgba(245,5,85,0.24)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">Ödenen toplam</p>
              <div className="mt-2 text-4xl font-semibold tracking-[-0.06em]">
                <AmountText amount={session.total_payable_amount} currency={session.currency} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-rose-100 bg-white px-4 py-3 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Ürün</div>
                <div className="mt-1 text-xl font-semibold text-zinc-950">{session.item_count}</div>
              </div>
              <div className="rounded-2xl border border-rose-100 bg-white px-4 py-3 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Son geçerlilik</div>
                <div className="mt-1 text-sm font-semibold text-zinc-950">{formatDateTime(session.expires_at)}</div>
              </div>
            </div>

            <div className="space-y-2">
            {session.items.map((item, index) => (
              <div key={`${item.menu_item_id}-${index}`} className="rounded-2xl border border-zinc-100 bg-white px-4 py-3 text-sm shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-zinc-950">
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
          </div>

          <div className="flex flex-col justify-between bg-zinc-950 p-5 text-white sm:p-6">
            <div className="space-y-5">
              <div className="rounded-[26px] bg-white/8 p-5 ring-1 ring-white/10">
                <div className="flex items-center gap-2 text-sm font-medium text-white/75">
                  <Store className="h-4 w-4 text-[#ff5a8f]" /> Teslim noktası
                </div>
                <div className="mt-3 text-2xl font-semibold tracking-[-0.04em]">{repairPotentialMojibake(session.business.name)}</div>
                <div className="mt-4 flex items-start gap-2 text-sm leading-6 text-white/70">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-[#ff5a8f]" />
                  <p>Kasada QR veya kasa kodu ile doğrulanır.</p>
                </div>
              </div>

              <div className="rounded-[26px] bg-white p-5 text-zinc-950 shadow-[0_24px_70px_rgba(0,0,0,0.22)]">
                <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-[24px] bg-[radial-gradient(circle_at_top_left,_rgba(245,5,85,0.16),_transparent_34%),#fafafa] text-[#f50555] ring-1 ring-zinc-100">
                  <QrCode className="h-20 w-20" />
                </div>
                <p className="mt-4 text-center text-sm font-medium text-zinc-600">QR ekranında gerçek kod ve kasa kodu birlikte görünür.</p>
              </div>
            </div>

            {(primaryHref && primaryLabel) || (secondaryHref && secondaryLabel) ? (
              <div className="mt-5 grid gap-2">
                {primaryHref && primaryLabel ? (
                  <Link href={primaryHref} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(245,5,85,0.30)] transition hover:-translate-y-0.5 hover:bg-[#dc004c]">
                    {primaryLabel}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                ) : null}
                {secondaryHref && secondaryLabel ? (
                  <Link href={secondaryHref} className="inline-flex items-center justify-center rounded-2xl bg-white/10 px-5 py-3 text-sm font-semibold text-white ring-1 ring-white/15 transition hover:bg-white/15">
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
