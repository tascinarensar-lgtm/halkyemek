"use client";

import { useQuery } from "@tanstack/react-query";

import { getCart } from "@/features/cart/api";
import {
  getCategoryBusinesses,
  getDiscoveryCategories,
  getDiscoveryHome,
  getPublicBusinessDetail,
  getPublicBusinessMenu,
  getPublicBusinesses,
} from "@/features/discovery/api";
import { discoveryQueryKeys } from "@/features/discovery/query-keys";

export function useDiscoveryHome(district: string, authenticated: boolean, enabled = true) {
  return useQuery({
    queryKey: discoveryQueryKeys.home(district, authenticated ? "authenticated" : "public"),
    queryFn: () => getDiscoveryHome(district, authenticated),
    enabled,
  });
}

export function useDiscoveryCategories(district: string) {
  return useQuery({
    queryKey: discoveryQueryKeys.categories(district),
    queryFn: () => getDiscoveryCategories(district),
  });
}

export function useCategoryBusinesses(params: {
  slug: string;
  district: string;
  listingType?: string;
  featuredFirst?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const keyParams = {
    slug: params.slug,
    district: params.district,
    listingType: params.listingType ?? "",
    featuredFirst: String(params.featuredFirst ?? true),
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 12),
  };

  return useQuery({
    queryKey: discoveryQueryKeys.categoryBusinesses(keyParams),
    queryFn: () => getCategoryBusinesses(params),
    enabled: Boolean(params.slug),
  });
}

export function usePublicBusinesses(district: string) {
  return useQuery({
    queryKey: discoveryQueryKeys.businesses(district),
    queryFn: () => getPublicBusinesses(district),
  });
}

export function usePublicBusinessDetail(businessId: number) {
  return useQuery({
    queryKey: discoveryQueryKeys.businessDetail(businessId),
    queryFn: () => getPublicBusinessDetail(businessId),
    enabled: Number.isFinite(businessId) && businessId > 0,
  });
}

export function usePublicBusinessMenu(businessId: number) {
  return useQuery({
    queryKey: discoveryQueryKeys.businessMenu(businessId),
    queryFn: () => getPublicBusinessMenu(businessId),
    enabled: Number.isFinite(businessId) && businessId > 0,
  });
}

export function useCartSummary(enabled: boolean) {
  return useQuery({
    queryKey: ["cart", "detail"],
    queryFn: getCart,
    enabled,
  });
}
