"use client";

import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { PendingButton } from "@/components/ui/pending-button";

type CartCtaSectionProps = {
  checkoutHref: string;
  clearPending: boolean;
  onClear: () => void;
};

export function CartCtaSection({ checkoutHref, clearPending, onClear }: CartCtaSectionProps) {
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-zinc-500">Cüzdanla ödeme sonrası QR ile işletmede tüketim tamamlanır.</p>
      <Link href={checkoutHref} className="inline-flex w-full">
        <Button fullWidth>Sepeti onayla</Button>
      </Link>
      <PendingButton
        type="button"
        onClick={onClear}
        pending={clearPending}
        pendingText="Sepet temizleniyor..."
        className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
      >
        Sepeti temizle
      </PendingButton>
    </div>
  );
}

