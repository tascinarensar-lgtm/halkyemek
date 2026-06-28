import type { ButtonHTMLAttributes, ReactNode } from "react";

import { buttonClassName, type ButtonVariant } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

type PendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingText?: string;
  idleText?: ReactNode;
  variant?: ButtonVariant;
  fullWidth?: boolean;
};

export function PendingButton({
  pending = false,
  pendingText = "İşleniyor...",
  idleText,
  variant = "primary",
  fullWidth = false,
  className,
  disabled,
  children,
  ...props
}: PendingButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(buttonClassName({ variant, fullWidth }), className)}
    >
      {pending ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          {pendingText}
        </>
      ) : (
        idleText ?? children
      )}
    </button>
  );
}
