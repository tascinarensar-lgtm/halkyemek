import { repairPotentialMojibake } from "@/lib/utils/text";

const categoryContentBySlug: Record<string, { name: string; description: string }> = {
  burger: {
    name: "Burger",
    description: "Burger menülerini tek katalogda keşfet.",
  },
  pizza: {
    name: "Pizza",
    description: "Pizza menülerini tek katalogda keşfet.",
  },
  doner: {
    name: "Döner",
    description: "Döner menülerini tek katalogda keşfet.",
  },
  kebap: {
    name: "Kebap",
    description: "Kebap menülerini tek katalogda keşfet.",
  },
};

const halkTasarrufLegacySlugMap: Record<string, string> = {
  "firin-pastane": "burger",
  "kafe-kahve-zincirleri": "burger",
  marketler: "burger",
  "fast-food-restoranlari": "burger",
  "doner-kebap-isletmeleri": "doner",
};

function prettifyFallbackSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();
      if (normalized === "doner") return "Döner";
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

export function getCategoryDisplayName(slug: string, fallbackName?: string | null) {
  const resolvedSlug = halkTasarrufLegacySlugMap[slug] ?? slug;
  return categoryContentBySlug[resolvedSlug]?.name || repairPotentialMojibake(fallbackName) || prettifyFallbackSlug(slug) || "Kategori";
}

export function getCategoryDisplayDescription(slug: string, fallbackDescription?: string | null) {
  const resolvedSlug = halkTasarrufLegacySlugMap[slug] ?? slug;
  return (
    categoryContentBySlug[resolvedSlug]?.description ||
    repairPotentialMojibake(fallbackDescription) ||
    "Bu kategorideki anlaşmalı işletmeleri görüntüleyin."
  );
}
