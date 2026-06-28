import type { BrowserNotificationState } from "@/features/notifications/types";

export interface BrowserNotificationPresentation {
  label: string;
  tone: "default" | "warning" | "danger" | "success";
  description: string;
}

export interface BrowserNotificationGuidance {
  title: string;
  description: string;
  steps: string[];
}

export function getBrowserPermissionPresentation(browserState: BrowserNotificationState | undefined): BrowserNotificationPresentation {
  if (!browserState) {
    return {
      label: "Kontrol ediliyor",
      tone: "default",
      description: "Tarayıcı desteği ve izin durumu doğrulanıyor.",
    };
  }

  if (!browserState.configured) {
    return {
      label: "Yapılandırma eksik",
      tone: "warning",
      description: "Firebase web push ayarları tamamlanmadan canlı bildirim alınamaz.",
    };
  }

  if (!browserState.secureContext) {
    return {
      label: "Güvenli bağlantı gerekli",
      tone: "warning",
      description: "Bildirimler için siteyi HTTPS veya localhost üzerinden açman gerekir.",
    };
  }

  if (browserState.environment === "in_app_browser") {
    return {
      label: "Tarayıcıda aç",
      tone: "warning",
      description: `Bu sayfa ${browserState.hostAppLabel || "uygulama içi tarayıcı"} üzerinde açık. Canlı bildirim için bağlantıyı ${browserState.recommendedBrowserLabel || "desteklenen tarayıcı"} ile açman gerekir.`,
    };
  }

  if (browserState.environment === "ios_home_screen_required") {
    return {
      label: "Ana ekrana ekleyin",
      tone: "warning",
      description: "iPhone ve iPad cihazlarda canlı bildirim için HalkYemek'i Safari'de açıp Ana Ekrana Ekle adımını tamamlaman gerekir.",
    };
  }

  if (!browserState.supported) {
    return {
      label: "Tarayıcı desteklemiyor",
      tone: "danger",
      description: "Bu tarayıcı canlı web bildirimi desteği sunmuyor.",
    };
  }

  switch (browserState.permission) {
    case "granted":
      return {
        label: "İzin verildi",
        tone: "success",
        description: "Tarayıcı bildirim izni açık ve canlı bildirim almaya uygun.",
      };
    case "denied":
      return {
        label: "İzin kapalı",
        tone: "danger",
        description: "Tarayıcı ayarlarından HalkYemek için bildirimi yeniden açman gerekir.",
      };
    default:
      return {
        label: "İzin bekleniyor",
        tone: "warning",
        description: "Tarayıcıda henüz bildirim izni verilmedi.",
      };
  }
}

export function getBrowserGuidance(browserState: BrowserNotificationState | undefined): BrowserNotificationGuidance | null {
  if (!browserState) {
    return null;
  }

  if (browserState.environment === "in_app_browser") {
    const targetBrowser = browserState.recommendedBrowserLabel || "desteklenen tarayıcı";
    const hostApp = browserState.hostAppLabel || "uygulama içi tarayıcı";
    const appleSteps = [
      `${hostApp} içindeki paylaş veya menü alanından sayfayı Safari'de aç.`,
      "Safari açıldıktan sonra istersen Paylaş > Ana Ekrana Ekle adımını tamamla.",
      "Ardından Bildirimler sayfasına dönüp bu cihazı hazırla.",
    ];
    const defaultSteps = [
      `${hostApp} içindeki menü alanından sayfayı ${targetBrowser} ile aç.`,
      "Açılan tarayıcıda Bildirimler sayfasına dön.",
      "Bildirim iznini aç diyerek izni ver.",
    ];

    return {
      title: `${hostApp} içinde canlı bildirim açılamaz`,
      description: `HalkYemek bildirimleri için sayfayı ${targetBrowser} gibi desteklenen bir tarayıcıda açman gerekir.`,
      steps: browserState.isAppleMobile ? appleSteps : defaultSteps,
    };
  }

  if (browserState.environment === "ios_home_screen_required") {
    return {
      title: "iPhone ve iPad için Ana Ekrana Ekle gerekli",
      description: "Apple mobil cihazlarda web push bildirimleri en sağlıklı şekilde Ana Ekrana eklenen HalkYemek simgesi üzerinden çalışır.",
      steps: [
        "Sayfayı Safari ile aç.",
        "Paylaş menüsü içinden Ana Ekrana Ekle seçeneğini seç.",
        "Ana ekrana eklenen HalkYemek simgesinden siteyi yeniden aç.",
        "Bildirimler ekranında bildirim iznini aç.",
      ],
    };
  }

  return null;
}
