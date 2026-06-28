import type { BusinessMemberRole } from "@/features/business-operations/types";

export const managementRoles: BusinessMemberRole[] = ["MANAGER", "OWNER", "ADMIN"];

export function isManagementRole(role: BusinessMemberRole | null | undefined) {
  return Boolean(role && managementRoles.includes(role));
}

export function getRoleLabel(role: BusinessMemberRole | null | undefined) {
  switch (role) {
    case "CASHIER":
      return "Kasiyer";
    case "MANAGER":
      return "Yönetici";
    case "OWNER":
      return "Sahip";
    case "ADMIN":
      return "Admin";
    default:
      return role || "-";
  }
}

export function getRoleSummary(role: BusinessMemberRole | null | undefined) {
  switch (role) {
    case "CASHIER":
      return "Kasadaki QR işlemleri, sipariş akışı ve günlük operasyon takibi için sadeleştirilmiş kullanım sunar.";
    case "MANAGER":
      return "Operasyon takibiyle birlikte menü, teklifler ve içerik alanlarında günlük yönetim yetkisi sağlar.";
    case "OWNER":
      return "İşletmenin operasyon, ekip koordinasyonu ve yönetim yüzeylerini en geniş kapsamda kullanabilen roldür.";
    case "ADMIN":
      return "Platform genelinde üst düzey yetki taşır; işletme panelinde tüm yönetim alanlarına erişebilir.";
    default:
      return "Bu işletmedeki yetkin, panel içinde görebileceğin alanları ve yapabileceğin işlemleri belirler.";
  }
}

export function getRoleSurfaceLabel(role: BusinessMemberRole | null | undefined) {
  switch (role) {
    case "CASHIER":
      return "Operasyon odaklı erişim";
    case "MANAGER":
      return "Yönetim ve operasyon erişimi";
    case "OWNER":
      return "Tam işletme yönetimi";
    case "ADMIN":
      return "Tam yetkili görünüm";
    default:
      return "Standart işletme görünümü";
  }
}