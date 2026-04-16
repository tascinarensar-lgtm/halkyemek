import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils/cn";

type PendingButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  pending?: boolean;
  pendingText?: string;
  idleText?: ReactNode;
};

export function PendingButton({
  pending = false,
  pendingText = "İşleniyor...",
  idleText,
  className,
  disabled,
  children,
  ...props
}: PendingButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending}
      className={cn("disabled:cursor-not-allowed disabled:opacity-60", className)}
    >
      {pending ? pendingText : (idleText ?? children)}
    </button>
  );
}
