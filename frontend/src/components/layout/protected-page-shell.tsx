"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import { useSession } from "@/hooks/use-session";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { ErrorState } from "@/components/ui/error-state";

function buildLoginHref(pathname: string | null, search: string) {
  const target = pathname && pathname !== "/" ? `${pathname}${search}` : "";
  return target ? `/giris?next=${encodeURIComponent(target)}` : "/giris";
}

export function ProtectedPageShell({
  children,
  requireBusiness = false,
  requireAdmin = false,
}: {
  children: ReactNode;
  requireBusiness?: boolean;
  requireAdmin?: boolean;
}) {
  const session = useSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();

  if (session.isPending && !session.data) {
    return <LoadingSkeleton />;
  }

  if (session.isError || !session.data?.isAuthenticated) {
    return (
      <div className="space-y-4">
        <ErrorState title="Oturum gerekli" description="Bu alan için giriş yapılmış bir oturum gerekiyor." />
        <Link href={buildLoginHref(pathname, search ? `?${search}` : "")} className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          Giriş sayfasına git
        </Link>
      </div>
    );
  }

  if (requireAdmin && session.data.user?.role !== "ADMIN") {
    return (
      <div className="space-y-4">
        <ErrorState title="Ops erişimi yok" description="Bu alan yalnızca admin kullanıcılar içindir. Backend yine nihai otorite olarak kalır." />
        <Link href="/hesabim" className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          Hesabıma dön
        </Link>
      </div>
    );
  }

  if (requireBusiness && !session.data.hasBusinessMembership) {
    return (
      <div className="space-y-4">
        <ErrorState title="İşletme üyeliği gerekli" description="Bu alan işletme üyeliği olan kullanıcılar içindir." />
        <Link href="/hesabim" className="inline-flex rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white">
          Hesabıma dön
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
