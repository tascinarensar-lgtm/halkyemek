import { Clock3, Tag } from "lucide-react";

import Image from "next/image";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import type { OfferSummary } from "@/features/discovery/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

function formatWindow(start: string, end: string) {
  const starts = new Date(start);
  const ends = new Date(end);

  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
    return "Süre bilgisi mevcut değil";
  }

  return `${starts.toLocaleDateString("tr-TR")} - ${ends.toLocaleDateString("tr-TR")}`;
}

export function OfferCard({ offer }: { offer: OfferSummary }) {
  const title = repairPotentialMojibake(offer.title);
  const description = repairPotentialMojibake(offer.short_description) || repairPotentialMojibake(offer.description);
  const label = repairPotentialMojibake(offer.label);
  const tag = repairPotentialMojibake(offer.tag);

  return (
    <Card className="overflow-hidden border-stone-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="relative aspect-[16/9] bg-zinc-100">
        {offer.image ? (
          <Image
            src={offer.image}
            alt={title}
            fill
            unoptimized
            sizes="(max-width: 768px) 100vw, 33vw"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">Kampanya görseli yok</div>
        )}
      </div>
      <CardContent className="space-y-3.5 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-zinc-950">{title}</h3>
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600">{description}</p>
          </div>
          {label ? <span className="shrink-0 rounded-full bg-zinc-950 px-2.5 py-1 text-xs text-white">{label}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          {tag ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-1">
              <Tag className="h-3.5 w-3.5" /> {tag}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" /> {formatWindow(offer.starts_at, offer.ends_at)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3 py-2.5 text-sm">
          <span className="font-semibold text-zinc-950">
            <AmountText amount={offer.offer_price_amount} />
          </span>
          <span className="inline-flex items-center gap-1 text-zinc-500">
            {offer.is_live ? "Yayında fırsat" : "Yakında aktif olacak"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
