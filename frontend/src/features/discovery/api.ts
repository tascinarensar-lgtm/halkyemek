import { authenticatedApiFetch } from "@/lib/api/authenticated-client";
import { publicApiFetch } from "@/lib/api/public-client";

import type {
  DiscoveryCategoryListResponse,
  DiscoveryHomeResponse,
  PaginatedResponse,
  DiscoveryBusinessCard,
  PublicBusinessDetailResponse,
  PublicBusinessListResponse,
  PublicBusinessMenuResponse,
} from "@/features/discovery/types";
import { toQueryString } from "@/features/discovery/params";

export function getDiscoveryHome(district: string, authenticated = false) {
  const path = `/api/v1/discovery/home/${toQueryString({ district })}`;
  return authenticated ? authenticatedApiFetch<DiscoveryHomeResponse>(path) : publicApiFetch<DiscoveryHomeResponse>(path);
}

export function getDiscoveryCategories(district: string) {
  return publicApiFetch<DiscoveryCategoryListResponse>(`/api/v1/discovery/categories/${toQueryString({ district })}`);
}

export function getCategoryBusinesses(params: {
  slug: string;
  district: string;
  listingType?: string;
  featuredFirst?: boolean;
  page?: number;
  pageSize?: number;
}) {
  const { slug, district, listingType, featuredFirst = true, page = 1, pageSize = 12 } = params;
  return publicApiFetch<PaginatedResponse<DiscoveryBusinessCard>>(
    `/api/v1/discovery/categories/${slug}/businesses/${toQueryString({ district, listing_type: listingType, featured_first: featuredFirst, page, page_size: pageSize })}`,
  );
}

export function getPublicBusinesses(district: string) {
  return publicApiFetch<PublicBusinessListResponse>(`/api/v1/catalog/businesses/${toQueryString({ district })}`);
}

export function getPublicBusinessDetail(businessId: number) {
  return publicApiFetch<PublicBusinessDetailResponse>(`/api/v1/catalog/businesses/${businessId}/`);
}

export function getPublicBusinessMenu(businessId: number) {
  return publicApiFetch<PublicBusinessMenuResponse>(`/api/v1/catalog/businesses/${businessId}/menu/`);
}
