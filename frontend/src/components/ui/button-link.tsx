import Link from "next/link";
import { ReactNode } from "react";

import { buttonClassName, type ButtonVariant } from "@/components/ui/Button";

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: Exclude<ButtonVariant, "danger">;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={buttonClassName({ variant, className })}
    >
      {children}
    </Link>
  );
}
