"use client";

import { useEffect } from "react";

import { PageContainer } from "@/components/ui/page-container";
import { ErrorState } from "@/components/ui/error-state";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error(error);
    }
  }, [error]);

  return (
    <PageContainer className="py-10">
      <div className="space-y-4">
        <ErrorState title="Beklenmeyen bir hata oluştu" description={error.message || "Sayfa render edilirken beklenmeyen bir hata oluştu."} />
        <button type="button" onClick={reset} className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          Tekrar dene
        </button>
      </div>
    </PageContainer>
  );
}
