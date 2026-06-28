import type { BusinessListingType } from "@/features/discovery/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

export function getBusinessListingTypeLabel(type?: BusinessListingType | string | null, fallbackLabel?: string | null) {
  if (type === "CONTRACTED") {
    return "Anlaşmalı";
  }

  if (type === "VOLUNTEER") {
    return "Gönüllü";
  }

  return repairPotentialMojibake(fallbackLabel) || "İşletme";
}

export function isDemoBusinessCopy(value: string | null | undefined) {
  const text = repairPotentialMojibake(value).toLocaleLowerCase("tr-TR");

  return (
    text.includes("other businesses ve kategori listeleri") ||
    text.includes("ikinci görünür işletme") ||
    text.includes("boş kalmasın") ||
    text.includes("smoke test") ||
    text.includes("demo") ||
    text.includes("ürün omurgası") ||
    text.includes("backend") ||
    text.includes("endpoint")
  );
}

export function getBusinessIntroText(input: { businessName: string; shortDescription?: string | null; introText?: string | null }) {
  const businessName = repairPotentialMojibake(input.businessName) || "Bu işletme";
  const shortDescription = repairPotentialMojibake(input.shortDescription);
  const introText = repairPotentialMojibake(input.introText);

  if (shortDescription && !isDemoBusinessCopy(shortDescription)) {
    return shortDescription;
  }

  if (introText && !isDemoBusinessCopy(introText)) {
    return introText;
  }

  return `${businessName}, HalkYemek kullanıcıları için menülerini daha kolay inceleyebileceğiniz ve uygun seçeneklere hızlıca ulaşabileceğiniz işletmelerden biridir.`;
}
