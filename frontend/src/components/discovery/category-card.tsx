import Link from "next/link";
import { ArrowRight, UtensilsCrossed } from "lucide-react";

import { getCategoryDisplayDescription, getCategoryDisplayName } from "@/features/discovery/category-copy";
import type { MarketplaceCategorySummary } from "@/features/discovery/types";
import { Card, CardContent } from "@/components/ui/card";

export function CategoryCard({ category, district }: { category: MarketplaceCategorySummary; district?: string }) {
  const href = district ? `/kategoriler/${category.slug}?district=${district}` : `/kategoriler/${category.slug}`;
  const categoryName = getCategoryDisplayName(category.slug, category.name);
  const categoryDescription = getCategoryDisplayDescription(category.slug, category.description);

  return (
    <Link href={href} className="group block h-full">
      <Card className="h-full overflow-hidden border-stone-200 bg-white transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
        <div className="relative h-40 overflow-hidden border-b border-stone-100 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.35),_transparent_35%),linear-gradient(135deg,_rgba(255,251,235,1),_rgba(255,255,255,1))]">
          <div className="absolute inset-0 bg-[linear-gradient(145deg,_rgba(255,255,255,0.18),_transparent_60%)]" />
          <div className="absolute -left-4 top-4 h-24 w-24 rounded-full bg-white/55 blur-2xl" />
          <div className="absolute bottom-4 left-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-amber-700 shadow-sm ring-1 ring-black/5">
            <UtensilsCrossed className="h-6 w-6" />
          </div>
          <div className="absolute bottom-4 right-4 rounded-full bg-zinc-950 px-3 py-1 text-xs font-medium text-white">
            HalkYemek
          </div>
        </div>
        <CardContent className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-semibold text-zinc-950">{categoryName}</h3>
          </div>
          <p className="text-sm leading-6 text-zinc-600">{categoryDescription}</p>
          <div className="flex items-center gap-2 pt-1 text-sm font-medium text-zinc-900 transition group-hover:text-zinc-700">
            Kategoriyi incele
            <ArrowRight className="h-4 w-4" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
