"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { toast } from "sonner";

import type { SurpriseDealPublic } from "@/features/surprise-deals/types";
import { buildPendingSurpriseDealSelection, savePendingSurpriseDealSelection } from "@/features/surprise-deals/pending-selection";
import { openLoginDrawer } from "@/lib/auth/login-drawer";

type SurpriseDealCheckoutButtonProps = {
  deal: SurpriseDealPublic;
  returnHref: string;
  isAuthenticated: boolean;
  className: string;
  disabled?: boolean;
  authenticatedLabel: ReactNode;
  unauthenticatedLabel?: ReactNode;
  onSuccess?: () => void;
  onUnauthenticatedClick?: () => void;
};

export function SurpriseDealCheckoutButton({
  deal,
  returnHref,
  isAuthenticated,
  className,
  disabled = false,
  authenticatedLabel,
  unauthenticatedLabel,
  onSuccess,
  onUnauthenticatedClick,
}: SurpriseDealCheckoutButtonProps) {
  const router = useRouter();

  function handleAddToBasket() {
    savePendingSurpriseDealSelection(buildPendingSurpriseDealSelection(deal));
    toast.success("Sepetine eklendi.", {
      description: "Fırsatını sipariş ekranında kontrol edip QR kodunu orada hazırlayabilirsin.",
    });
    onSuccess?.();
    router.push("/checkout?source=surprise_deal");
  }

  if (isAuthenticated) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          handleAddToBasket();
        }}
        className={className}
      >
        {authenticatedLabel}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onUnauthenticatedClick?.();
        openLoginDrawer(returnHref);
      }}
      className={className}
    >
      {unauthenticatedLabel ?? authenticatedLabel}
    </button>
  );
}
