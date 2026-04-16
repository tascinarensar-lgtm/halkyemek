import { repairPotentialMojibake } from "@/lib/utils/text";

const categoryContentBySlug: Record<string, { name: string; description: string }> = {
  "tavuk-doner": {
    name: "Tavuk Döner",
    description: "Uygun fiyatlı tavuk döner ve pratik menü seçenekleri.",
  },
  "et-doner": {
    name: "Et Döner",
    description: "Et döner sevenler için doyurucu ve avantajlı menüler.",
  },
  burger: {
    name: "Burger",
    description: "Klasik ve özel burger menülerini bir araya getiren kategori.",
  },
  pizza: {
    name: "Pizza",
    description: "Farklı boy ve içeriklerde pizza seçenekleri.",
  },
  "pilav-tencere-yemekleri": {
    name: "Pilav & Tencere Yemekleri",
    description: "Pilav, tencere yemekleri ve doyurucu tabaklar.",
  },
  "ev-yemekleri": {
    name: "Ev Yemekleri",
    description: "Esnaf usulü günlük menüler ve ev yemeği seçenekleri.",
  },
  kebap: {
    name: "Kebap",
    description: "Kebap ve ızgara çeşitlerini bir araya getiren kategori.",
  },
  diger: {
    name: "Diğer",
    description: "Diğer tüm özel veya ayrı sınıflanan işletmeler.",
  },
};

function prettifyFallbackSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();

      if (normalized === "doner") return "Döner";
      if (normalized === "diger") return "Diğer";

      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

export function getCategoryDisplayName(slug: string, fallbackName?: string | null) {
  return categoryContentBySlug[slug]?.name || repairPotentialMojibake(fallbackName) || prettifyFallbackSlug(slug) || "Kategori";
}

export function getCategoryDisplayDescription(slug: string, fallbackDescription?: string | null) {
  return (
    categoryContentBySlug[slug]?.description ||
    repairPotentialMojibake(fallbackDescription) ||
    "Bu kategorideki anlaşmalı işletmeleri görüntüleyin."
  );
}
