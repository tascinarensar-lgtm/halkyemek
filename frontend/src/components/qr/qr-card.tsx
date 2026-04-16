"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCard({ value }: { value: string }) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 280 }).then(setSrc).catch(() => setSrc(""));
  }, [value]);

  return (
    <div className="inline-flex flex-col items-center rounded-2xl border bg-white p-4 shadow-sm">
      {src ? (
        <img alt="Teslim QR kodu" src={src} className="h-64 w-64" />
      ) : (
        <div className="flex h-64 w-64 items-center justify-center rounded-xl bg-zinc-100 text-sm text-zinc-500">
          QR hazırlanıyor...
        </div>
      )}
      <p className="mt-3 max-w-64 break-all text-center text-xs text-zinc-500">{value}</p>
    </div>
  );
}
