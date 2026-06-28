type BusinessLocationLike = {
  google_maps_url?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  address_line?: string | null;
};

export function getMapsDirectionsUrl(business: BusinessLocationLike) {
  if (business.google_maps_url) {
    return business.google_maps_url;
  }

  if (business.latitude != null && business.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${business.latitude},${business.longitude}`;
  }

  if (business.address_line) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(business.address_line)}`;
  }

  return null;
}
