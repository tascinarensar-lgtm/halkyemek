"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
  }, [error]);

  return (
    <html lang="tr">
      <body className="min-h-screen bg-stone-50 px-4 py-10 text-zinc-950 antialiased">
        <div className="mx-auto max-w-2xl space-y-4 rounded-2xl border bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-xl font-semibold">Uygulama kritik hata verdi</h1>
            <p className="mt-2 text-sm text-zinc-600">{error.message || "Beklenmeyen bir uygulama hatası oluştu."}</p>
          </div>
          <button type="button" onClick={reset} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
