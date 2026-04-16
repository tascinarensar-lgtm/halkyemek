"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Camera, Keyboard, QrCode, ScanLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { lookupBusinessCheckoutSession } from "@/features/business-operations/api";
import { getApiErrorMessage } from "@/lib/api/errors";

type Html5QrCodeModule = typeof import("html5-qrcode");
type Html5QrCodeInstance = InstanceType<Html5QrCodeModule["Html5Qrcode"]>;

function normalizeIdentifier(input: string) {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function getCameraSupportState() {
  if (typeof window === "undefined") {
    return {
      canUseCamera: false,
      reason: "Bu tarayıcı ortamı kamera açmak için hazır değil.",
    };
  }

  if (!window.isSecureContext) {
    return {
      canUseCamera: false,
      reason: "Kamera erişimi için güvenli bağlantı gerekir. Localhost dışında HTTPS kullanmalısın.",
    };
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      canUseCamera: false,
      reason: "Bu cihaz veya tarayıcı kamera erişimini desteklemiyor.",
    };
  }

  return {
    canUseCamera: true,
    reason: "",
  };
}

export function CheckoutSessionScanner({ businessId }: { businessId: number }) {
  const router = useRouter();
  const readerId = `checkout-session-scanner-${useId().replace(/:/g, "-")}`;
  const scannerRef = useRef<Html5QrCodeInstance | null>(null);
  const startingRef = useRef(false);
  const navigatedRef = useRef(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("QR okutma alanı kapalı.");
  const [manualValue, setManualValue] = useState("");

  const cameraSupport = useMemo(() => getCameraSupportState(), []);

  const lookupMutation = useMutation({
    mutationFn: async (query: string) => lookupBusinessCheckoutSession(businessId, query),
    onSuccess: (preview) => {
      toast.success("Checkout bilgisi bulundu. Doğrulama ekranı açılıyor.");
      router.push(`/isletme/${businessId}/tuket/${encodeURIComponent(preview.token)}`);
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Kasa kodu veya QR bilgisi bulunamadı."));
    },
  });

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;

    if (!scanner) {
      return;
    }

    try {
      await scanner.stop();
    } catch {
      // Tarayıcı duruma göre stop çağrısını reddedebilir; temizleme yine de sürsün.
    }

    try {
      await scanner.clear();
    } catch {
      // DOM temizliği ikinci aşamada da sessizce geçilebilir.
    }
  };

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, []);

  const startCamera = async () => {
    if (!cameraSupport.canUseCamera) {
      setCameraMessage(cameraSupport.reason || "Bu cihazda kamera kullanılamıyor. Aşağıdan kasa kodu girerek devam edebilirsin.");
      return;
    }

    if (startingRef.current) {
      return;
    }

    startingRef.current = true;
    navigatedRef.current = false;
    setCameraMessage("Kamera hazırlanıyor. QR kodu kare alan içinde tut.");

    try {
      await stopScanner();

      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(readerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 240, height: 240 },
          aspectRatio: 1,
        },
        (decodedText) => {
          if (navigatedRef.current) {
            return;
          }

          const token = normalizeIdentifier(decodedText);
          if (!token) {
            return;
          }

          navigatedRef.current = true;
          setCameraMessage("QR kod okundu. Doğrulama ekranı açılıyor.");
          toast.success("QR kod okundu. Doğrulama ekranı açılıyor.");
          void stopScanner();
          setCameraOpen(false);
          router.push(`/isletme/${businessId}/tuket/${encodeURIComponent(token)}`);
        },
        () => {
          // Sürekli okuma döngüsünde sessiz kal.
        },
      );

      setCameraOpen(true);
      setCameraMessage("Kameranı QR koda yönelt. Kod okununca doğrulama ekranı otomatik açılır.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      const denied = /permission|denied|notallowed/i.test(reason);
      const noDevice = /notfound|nodevice|overconstrained|nosuitable/i.test(reason);

      if (denied) {
        setCameraMessage("Kamera izni verilmedi. Tarayıcı izinlerini açıp tekrar deneyebilir veya aşağıdan kasa kodu girebilirsin.");
      } else if (noDevice) {
        setCameraMessage("Bu cihazda kullanılabilir bir kamera bulunamadı. Telefon ya da kameralı cihazda okutabilir, istersen aşağıdan kasa koduyla devam edebilirsin.");
      } else {
        setCameraMessage("Kamera başlatılamadı. Tarayıcı desteğini kontrol et veya aşağıdan kasa kodunu yazarak devam et.");
      }
      setCameraOpen(false);
      await stopScanner();
    } finally {
      startingRef.current = false;
    }
  };

  const closeCamera = async () => {
    await stopScanner();
    setCameraOpen(false);
    setCameraMessage("QR okutma alanı kapatıldı. İstersen yeniden açabilir veya kasa kodu girebilirsin.");
  };

  const handleLookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeIdentifier(manualValue);
    if (!normalized) {
      toast.error("Lütfen kasa kodunu, QR bilgisini veya bağlantıyı gir.");
      return;
    }

    try {
      await lookupMutation.mutateAsync(normalized);
    } catch {
      // Hata mesajı mutation seviyesinde gösteriliyor.
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-zinc-950 p-2.5 text-white">
          <ScanLine className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-950">QR okut veya kasa kodu gir</h3>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              Kasiyer için hızlı doğrulama
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-zinc-600">
            Müşteri QR kodunu gösterdiğinde kamerayla okutabilir veya QR açılamıyorsa müşterinin söylediği kısa kasa kodunu yazarak devam edebilirsin.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={startCamera}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-950 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
          >
            <Camera className="h-4 w-4" />
            Kamerayla QR okut
          </button>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
            {cameraSupport.canUseCamera
              ? "Tarayıcı ve cihaz izin verirse kamera üzerinden QR okutma hazır."
              : cameraSupport.reason || "Bu cihazda doğrudan kamera okutma desteklenmiyor."}
          </div>
        </div>

        {cameraOpen ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950">
            <div id={readerId} className="min-h-[320px] bg-zinc-950" />
            <div className="border-t border-white/10 p-3">
              <button
                type="button"
                onClick={() => void closeCamera()}
                className="inline-flex rounded-xl bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
              >
                Kamerayı kapat
              </button>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-700">
          {cameraMessage}
        </div>

        <form onSubmit={handleLookup} className="space-y-3 rounded-2xl border border-dashed border-zinc-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
            <Keyboard className="h-4 w-4" />
            Yedek doğrulama
          </div>
          <p className="text-sm leading-6 text-zinc-600">
            Müşteri QR kodunu açamıyorsa ya da kamera erişimi çalışmıyorsa aşağıya kısa kasa kodunu, QR bağlantısını veya ham token bilgisini yazabilirsin.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder="Örn: 8G5K2M veya QR bağlantısı"
              className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-4 py-3 text-sm text-zinc-900 outline-none ring-0 transition focus:border-zinc-950"
            />
            <button
              type="submit"
              disabled={lookupMutation.isPending}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-medium text-zinc-900 hover:bg-zinc-200 disabled:cursor-not-allowed disabled:text-zinc-400"
            >
              <QrCode className="h-4 w-4" />
              {lookupMutation.isPending ? "Doğrulanıyor..." : "Kodla aç"}
            </button>
          </div>
        </form>

        <div className="rounded-2xl bg-sky-50 p-4 text-sm leading-6 text-sky-900">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Doğrulama ekranı açıldıktan sonra önce ürünleri ve toplamı kontrol edip ardından tek tuşla teslim onayı verebilirsin. Böylece yanlış işletmede veya hatalı oturumda işlem yapma riski azalır.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
