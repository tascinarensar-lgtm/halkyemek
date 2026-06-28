import type { MenuItemSummary } from "@/features/discovery/types";
import { repairPotentialMojibake } from "@/lib/utils/text";

const menuDescriptionBySlug: Record<string, string> = {
  "mercimek-corbasi": "Sıcak ve pratik bir başlangıç arayanlar için öne çıkan çorba seçeneklerinden biri.",
  "kuru-fasulye-menu": "Doyurucu ana yemek arayanlar için öne çıkan klasik menülerden biri.",
  "tavuklu-pilav": "Pratik ve doyurucu öğün arayanlar için öne çıkan uygun fiyatlı seçeneklerden biri.",
  ayran: "Menünün yanına eşlik eden ferahlatıcı içecek seçeneklerinden biri.",
};

export function getMenuItemDisplayName(item: Pick<MenuItemSummary, "name">) {
  return repairPotentialMojibake(item.name) || "Ürün";
}

export function getMenuItemDisplayDescription(item: Pick<MenuItemSummary, "slug" | "name" | "description">) {
  if (item.slug === "nohutlu-pilav") {
    return "";
  }

  const mappedDescription = menuDescriptionBySlug[item.slug];
  if (mappedDescription) {
    return mappedDescription;
  }

  const description = repairPotentialMojibake(item.description);
  if (!description || /demo menü kaydı/i.test(description)) {
    return `${getMenuItemDisplayName(item)}, HalkYemek kullanıcıları için menüde öne çıkan seçeneklerden biridir.`;
  }

  return description;
}

export function getMenuItemDisplayImage(item: Pick<MenuItemSummary, "image" | "image_url">) {
  return item.image || item.image_url || "";
}

export function getMenuCategoryDisplayName(category: { name: string }) {
  return repairPotentialMojibake(category.name) || "Kategori";
}

export function getMenuCategoryDisplayDescription(category: { name: string; description?: string | null }) {
  const categoryName = getMenuCategoryDisplayName(category);
  const description = repairPotentialMojibake(category.description);

  if (!description || /demo kategorisi/i.test(description)) {
    return `${categoryName} kategorisi`;
  }

  return description;
}
