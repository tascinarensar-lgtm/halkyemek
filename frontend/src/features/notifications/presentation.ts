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
      description: "Tarayici destegi ve izin durumu dogrulaniyor.",
    };
  }

  if (!browserState.configured) {
    return {
      label: "Yapilandirma eksik",
      tone: "warning",
      description: "Firebase web push ayarlari tamamlanmadan canli bildirim alinamaz.",
    };
  }

  if (!browserState.secureContext) {
    return {
      label: "Guvenli baglanti gerekli",
      tone: "warning",
      description: "Bildirimler icin siteyi HTTPS veya localhost uzerinden acmaniz gerekir.",
    };
  }

  if (browserState.environment === "in_app_browser") {
    return {
      label: "Tarayicida acin",
      tone: "warning",
      description: `Bu sayfa ${browserState.hostAppLabel || "uygulama ici tarayici"} uzerinde acik. Canli bildirim icin baglantiyi ${browserState.recommendedBrowserLabel || "desteklenen tarayici"} ile acmaniz gerekir.`,
    };
  }

  if (browserState.environment === "ios_home_screen_required") {
    return {
      label: "Ana ekrana ekleyin",
      tone: "warning",
      description: "iPhone ve iPad cihazlarda canli bildirim icin HalkYemek'i Safari'de acip Ana Ekrana Ekle adimini tamamlamaniz gerekir.",
    };
  }

  if (!browserState.supported) {
    return {
      label: "Tarayici desteklemiyor",
      tone: "danger",
      description: "Bu tarayici canli web bildirimi desteği sunmuyor.",
    };
  }

  switch (browserState.permission) {
    case "granted":
      return {
        label: "Izin verildi",
        tone: "success",
        description: "Tarayici bildirim izni acik ve canli bildirim almaya uygun.",
      };
    case "denied":
      return {
        label: "Izin kapali",
        tone: "danger",
        description: "Tarayici ayarlarindan HalkYemek icin bildirimi yeniden acmaniz gerekir.",
      };
    default:
      return {
        label: "Izin bekleniyor",
        tone: "warning",
        description: "Tarayicida henuz bildirim izni verilmedi.",
      };
  }
}

export function getBrowserGuidance(browserState: BrowserNotificationState | undefined): BrowserNotificationGuidance | null {
  if (!browserState) {
    return null;
  }

  if (browserState.environment === "in_app_browser") {
    const targetBrowser = browserState.recommendedBrowserLabel || "desteklenen tarayici";
    const hostApp = browserState.hostAppLabel || "uygulama ici tarayici";
    const appleSteps = [
      `${hostApp} icindeki paylas veya menu alanindan sayfayi Safari'de acin.`,
      "Safari acildiktan sonra isterseniz Paylas > Ana Ekrana Ekle adimini tamamlayin.",
      "Ardindan Bildirimler sayfasina donup bu cihazi hazirlayin.",
    ];
    const defaultSteps = [
      `${hostApp} icindeki menu alanindan sayfayi ${targetBrowser} ile acin.`,
      "Acilan tarayicida Bildirimler sayfasina donun.",
      "Bu cihazi hazirla diyerek izni verin.",
    ];

    return {
      title: `${hostApp} ic tarayicisinda canli bildirim acilamaz`,
      description: `HalkYemek bildirimleri icin sayfayi ${targetBrowser} gibi desteklenen tarayicida acmaniz gerekir.`,
      steps: browserState.isAppleMobile ? appleSteps : defaultSteps,
    };
  }

  if (browserState.environment === "ios_home_screen_required") {
    return {
      title: "iPhone ve iPad icin Ana Ekrana Ekle gerekli",
      description: "Apple mobil cihazlarda web push bildirimleri en saglikli sekilde Ana Ekrana eklenen HalkYemek simgesi uzerinden calisir.",
      steps: [
        "Sayfayi Safari ile acin.",
        "Paylas menusu icinden Ana Ekrana Ekle secenegini secin.",
        "Ana ekrana eklenen HalkYemek simgesinden siteyi yeniden acin.",
        "Bildirimler ekraninda bu cihazi hazirlayin ve izni verin.",
      ],
    };
  }

  return null;
}
