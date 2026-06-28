"use client";

import { FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Keyboard, QrCode, ScanLine } from "lucide-react";
import { toast } from "sonner";

import { consumeBusinessCheckoutSession, lookupBusinessCheckoutSession } from "@/features/business-operations/api";
import { getApiErrorCode, getApiErrorDetails, getApiErrorMessage } from "@/lib/api/errors";

type Html5QrCodeModule = typeof import("html5-qrcode");
type Html5QrCodeInstance = InstanceType<Html5QrCodeModule["Html5Qrcode"]>;

function normalizeIdentifier(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? trimmed;
  } catch {
    return trimmed;
  }
}

function getCameraSupportState() {
  if (typeof window === "undefined") return { canUseCamera: false, reason: "Kamera hazır değil." };
  if (!window.isSecureContext) return { canUseCamera: false, reason: "Kamera için HTTPS veya localhost gerekir." };
  if (!navigator.mediaDevices?.getUserMedia) return { canUseCamera: false, reason: "Bu cihaz kamera okutmayı desteklemiyor." };
  return { canUseCamera: true, reason: "" };
}

export function CheckoutSessionScanner({ businessId }: { businessId: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const readerId = `checkout-session-scanner-${useId().replace(/:/g, "-")}`;
  const scannerRef = useRef<Html5QrCodeInstance | null>(null);
  const startingRef = useRef(false);
  const navigatedRef = useRef(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMessage, setCameraMessage] = useState("");
  const [manualValue, setManualValue] = useState("");
  const [lastOrderPath, setLastOrderPath] = useState("");
  const cameraSupport = useMemo(() => getCameraSupportState(), []);

  const syncAfterConsume = async (token?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["business-operations", businessId, "consume-history"] }),
      queryClient.invalidateQueries({ queryKey: ["checkout-session", "latest"] }),
      token ? queryClient.invalidateQueries({ queryKey: ["checkout-session", token] }) : Promise.resolve(),
    ]);
  };

  const openOrderPage = (orderId: number, message: string) => {
    const target = `/isletme/${businessId}/siparisler/${orderId}`;
    setLastOrderPath(target);
    toast.success(message, { description: "Sipariş teslim edildi olarak kaydedildi." });
    if (pathname !== target) {
      router.push(target);
      return;
    }
    router.refresh();
  };

  const completeMutation = useMutation({
    mutationFn: async (identifier: string) => {
      const preview = await lookupBusinessCheckoutSession(businessId, identifier);

      if (preview.existing_order_id) {
        return {
          orderId: preview.existing_order_id,
          token: preview.token,
          alreadyCompleted: true,
        };
      }

      if (!preview.can_consume) {
        throw new Error("Bu QR veya kasa kodu teslim için uygun değil.");
      }

      const result = await consumeBusinessCheckoutSession(businessId, preview.token);
      return {
        orderId: result.order_id,
        token: preview.token,
        alreadyCompleted: false,
      };
    },
    onSuccess: async (result) => {
      setManualValue("");
      await syncAfterConsume(result.token);
      openOrderPage(result.orderId, result.alreadyCompleted ? "Sipariş daha önce tamamlanmış." : "Teslim onaylandı.");
    },
    onError: async (error) => {
      const details = getApiErrorDetails(error);
      const orderId = details?.order_id;
      const normalizedOrderId = typeof orderId === "number" ? orderId : typeof orderId === "string" ? Number(orderId) : null;

      if (getApiErrorCode(error) === "checkout_session_already_consumed" && normalizedOrderId) {
        await syncAfterConsume();
        openOrderPage(normalizedOrderId, "Sipariş daha önce tamamlanmış.");
        return;
      }

      navigatedRef.current = false;
      toast.error(getApiErrorMessage(error, "Kasa kodu veya QR bilgisi tamamlanamadı."));
    },
  });

  const stopScanner = async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    startingRef.current = false;
    if (!scanner) return;

    try {
      await scanner.stop();
    } catch {}

    try {
      await scanner.clear();
    } catch {}
  };

  useEffect(() => {
    return () => {
      void stopScanner();
    };
  }, []);

  const startCamera = async () => {
    if (!cameraSupport.canUseCamera) {
      setCameraMessage(cameraSupport.reason || "Kamera kullanılamıyor. Kasa koduyla devam edebilirsin.");
      return;
    }

    if (startingRef.current) return;

    startingRef.current = true;
    navigatedRef.current = false;
    setCameraMessage("Kamera hazırlanıyor.");

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
        { fps: 10, qrbox: { width: 240, height: 240 }, aspectRatio: 1 },
        (decodedText) => {
          if (navigatedRef.current) return;
          const token = normalizeIdentifier(decodedText);
          if (!token) return;
          navigatedRef.current = true;
          void stopScanner();
          setCameraOpen(false);
          setCameraMessage("QR okundu. Teslim onayı tamamlanıyor.");
          completeMutation.mutate(token);
        },
        () => {},
      );

      setCameraOpen(true);
      setCameraMessage("QR kodu kameraya göster.");
    } catch {
      setCameraMessage("Kamera başlatılamadı. Kasa koduyla devam edebilirsin.");
      setCameraOpen(false);
      await stopScanner();
    } finally {
      startingRef.current = false;
    }
  };

  const closeCamera = async () => {
    await stopScanner();
    setCameraOpen(false);
    setCameraMessage("");
  };

  const handleLookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = normalizeIdentifier(manualValue);
    if (!normalized) {
      toast.error("Kasa kodu gerekli.");
      return;
    }

    try {
      await completeMutation.mutateAsync(normalized);
    } catch {}
  };

  return (
    <div className="rounded-[24px] border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-950 text-white">
            <ScanLine className="h-5 w-5" />
        </span>
        <div>
          <h3 className="text-base font-semibold text-zinc-950">QR veya kasa kodu</h3>
          <p className="mt-0.5 text-xs text-zinc-500">Okutunca teslim otomatik tamamlanır.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          onClick={startCamera}
          disabled={completeMutation.isPending}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          <Camera className="h-4 w-4" />
          {completeMutation.isPending ? "Teslim onaylanıyor" : "Kamerayla okut ve tamamla"}
        </button>

        {cameraOpen ? (
          <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-950">
            <div id={readerId} className="min-h-[240px] bg-zinc-950 sm:min-h-[300px]" />
            <div className="border-t border-white/10 p-3">
              <button type="button" onClick={() => void closeCamera()} className="inline-flex w-full items-center justify-center rounded-xl bg-white/10 px-4 py-2.5 text-sm font-medium text-white hover:bg-white/20 sm:w-auto">
                Kamerayı kapat
              </button>
            </div>
          </div>
        ) : null}

        {cameraMessage ? <p className="rounded-2xl bg-zinc-50 px-4 py-3 text-sm text-zinc-600">{cameraMessage}</p> : null}

        <form onSubmit={handleLookup} className="flex flex-col gap-2">
          <div className="relative min-w-0 flex-1">
            <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              placeholder="Kasa kodu veya QR bağlantısı"
              className="w-full rounded-2xl border border-zinc-200 bg-white py-3 pl-10 pr-4 text-sm text-zinc-900 outline-none transition focus:border-zinc-950"
            />
          </div>
          <button
            type="submit"
            disabled={completeMutation.isPending}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#f50555] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#dc004c] disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {completeMutation.isPending ? <CheckCircle2 className="h-4 w-4" /> : <QrCode className="h-4 w-4" />}
            {completeMutation.isPending ? "Teslim onaylanıyor" : "Kodu gir ve tamamla"}
          </button>
        </form>

        {lastOrderPath ? (
          <Link
            href={lastOrderPath}
            className="inline-flex items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-[#f50555] transition hover:bg-rose-100"
          >
            Tamamlanan siparişi aç
          </Link>
        ) : null}
      </div>
    </div>
  );
}
