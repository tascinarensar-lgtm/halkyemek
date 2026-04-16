export const discoveryQueryKeys = {
  home: (district: string, mode: "public" | "authenticated") => ["discovery", "home", district, mode] as const,
  categories: (district: string) => ["discovery", "categories", district] as const,
  categoryBusinesses: (params: Record<string, string>) => ["discovery", "category-businesses", params] as const,
  businesses: (district: string) => ["catalog", "businesses", district] as const,
  businessDetail: (businessId: number) => ["catalog", "business-detail", businessId] as const,
  businessMenu: (businessId: number) => ["catalog", "business-menu", businessId] as const,
};
