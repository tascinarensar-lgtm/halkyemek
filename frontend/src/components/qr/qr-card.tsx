"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export function QrCard({ value }: { value: string }) {
  const [src, setSrc] = useState<string>("");

  useEffect(() => {
    QRCode.toDataURL(value, { margin: 1, width: 280 }).then(setSrc).catch(() => setSrc(""));
  }, [value]);

  return (
    <div className="inline-flex w-full max-w-[22rem] flex-col items-center rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-4 w-full text-center">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Kasada göster</p>
        <h3 className="mt-1 text-lg font-semibold tracking-tight text-zinc-950">QR doğrulama kodu</h3>
      </div>

      {src ? (
        <Image
          alt="Teslim QR kodu"
          src={src}
          width={256}
          height={256}
          unoptimized
          className="h-64 w-64 rounded-2xl border border-zinc-100 bg-white p-1"
        />
      ) : (
        <div className="flex h-64 w-64 items-center justify-center rounded-2xl bg-zinc-100 text-sm text-zinc-500">
          QR hazırlanıyor...
        </div>
      )}

      <div className="mt-4 w-full space-y-2 rounded-2xl bg-zinc-50 px-4 py-3 text-xs leading-5 text-zinc-600">
        <p>Kasada bu ekranı personele göster.</p>
        <p>QR kodu yalnızca işletme personeli tarafından okutulur.</p>
        <p>Doğrulama sonrası kullanım adımı sisteme kaydedilir.</p>
      </div>

      <p className="mt-4 text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Alternatif doğrulama kodu</p>
      <p className="mt-2 w-full break-all rounded-2xl bg-zinc-50 px-3 py-2 text-center text-xs text-zinc-600">{value}</p>
    </div>
  );
}
