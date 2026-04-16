"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ProtectedPageShell } from "@/components/layout/protected-page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils/cn";

const NAV = [
  { href: "/ops", label: "Dashboard" },
  { href: "/ops/isletmeler", label: "İşletmeler" },
  { href: "/ops/payoutlar", label: "Payoutlar" },
  { href: "/ops/settlement", label: "Settlement" },
  { href: "/ops/bildirimler/yayinla", label: "Broadcast" },
];

export function OpsPageShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const pathname = usePathname();
  const session = useSession();

  return (
    <ProtectedPageShell requireAdmin>
      <PageContainer className="max-w-[1500px] space-y-6">
        <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Card>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ops console</p>
                  <h2 className="mt-1 text-lg font-semibold">Admin yönetim yüzeyi</h2>
                  <p className="mt-1 text-sm text-zinc-600">Customer ve business panellerinden ayrı, desktop-first operasyon konsolu.</p>
                </div>
                <div className="rounded-2xl bg-zinc-50 p-3 text-sm text-zinc-700">
                  <p className="font-medium text-zinc-950">{session.data?.user?.google_email || "Oturum okunamadı"}</p>
                  <p className="mt-1">Yetki doğrulaması backend admin endpoint cevapları üzerinden yapılır.</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="space-y-2">
                {NAV.map((item) => {
                  const isRoot = item.href === "/ops";
                  const isActive = isRoot ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn("block rounded-xl px-3 py-2 text-sm font-medium", isActive ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200")}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          </aside>
          <div className="min-w-0 space-y-6">
            <SectionHeader title={title} description={description} />
            {children}
          </div>
        </div>
      </PageContainer>
    </ProtectedPageShell>
  );
}

export function OpsMetricCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-zinc-500">{label}</p>
        <div className="mt-2 text-2xl font-semibold">{value}</div>
        {hint ? <p className="mt-2 text-xs text-zinc-500">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function OpsKeyValueGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="space-y-1">
            <p className="text-sm text-zinc-500">{item.label}</p>
            <div className="break-all text-sm font-medium">{item.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function OpsTable({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-50 text-zinc-600">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-4 py-3 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function OpsCell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("align-top border-t border-zinc-200 px-4 py-3", className)}>{children}</td>;
}

export function OpsStatus({ label }: { label: string | null | undefined }) {
  const normalized = String(label || "").toUpperCase();
  const tone = normalized.includes("FAIL") || normalized.includes("REJECT") || normalized.includes("CANCEL")
    ? "danger"
    : normalized.includes("PENDING") || normalized.includes("OPEN") || normalized.includes("RETRY") || normalized.includes("WAIT")
      ? "warning"
      : normalized.includes("APPROVED") || normalized.includes("CONFIRM") || normalized.includes("SUCCESS") || normalized.includes("ACTIVE") || normalized.includes("PROCESSED") || normalized.includes("PAID") || normalized.includes("VISIBLE") || normalized.includes("ACKNOWLEDGED") || normalized.includes("RESOLVED")
        ? "success"
        : "default";
  return <StatusChip label={label || "-"} tone={tone as "default" | "success" | "warning" | "danger"} />;
}

export function OpsEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent>
        <EmptyState title={title} description={description} />
      </CardContent>
    </Card>
  );
}

export function OpsErrorCard({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardContent>
        <ErrorState title={title} description={description} />
      </CardContent>
    </Card>
  );
}

export function OpsJsonCard({ title, value, description }: { title: string; value: string; description?: string }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
        </div>
        <pre className="overflow-x-auto rounded-xl bg-zinc-950 p-4 text-xs text-zinc-100">{value}</pre>
      </CardContent>
    </Card>
  );
}

export function OpsSectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {description ? <p className="mt-1 text-sm text-zinc-600">{description}</p> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function OpsActionResult({ tone = "success", title, description }: { tone?: "success" | "warning" | "danger" | "default"; title: string; description?: string }) {
  const styles = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    default: "border-zinc-200 bg-zinc-50 text-zinc-900",
  } as const;

  return (
    <div className={cn("rounded-2xl border p-4 text-sm", styles[tone])}>
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 opacity-90">{description}</p> : null}
    </div>
  );
}

export function OpsLinkRow({ links }: { links: Array<{ href: string; label: string; primary?: boolean }> }) {
  if (!links.length) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={`${link.href}-${link.label}`}
          href={link.href}
          className={cn(
            "rounded-xl px-3 py-2 text-sm font-medium",
            link.primary ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-900 hover:bg-zinc-200",
          )}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
