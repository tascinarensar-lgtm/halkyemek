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

export function getBusinessIntroText(input: { businessName: string; shortDescription?: string | null; introText?: string | null }) {
  const businessName = repairPotentialMojibake(input.businessName) || "Bu işletme";
  const shortDescription = repairPotentialMojibake(input.shortDescription);
  const introText = repairPotentialMojibake(input.introText);

  const looksTechnical = (value: string) =>
    /other businesses|smoke test|demo|ürün omurgası|backend|endpoint|boş kalmasın/i.test(value);

  if (shortDescription && !looksTechnical(shortDescription)) {
    return shortDescription;
  }

  if (introText && !looksTechnical(introText)) {
    return introText;
  }

  return `${businessName}, HalkYemek kullanıcıları için menülerini daha kolay inceleyebileceğiniz ve uygun seçeneklere hızlıca ulaşabileceğiniz işletmelerden biridir.`;
}
