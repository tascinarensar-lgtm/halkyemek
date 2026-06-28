"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ProtectedPageShell } from "@/components/layout/protected-page-shell";
import { Badge } from "@/components/ui/Badge";
import { buttonClassName } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Section, SectionTitle } from "@/components/ui/Section";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils/cn";

const OPS_NAV_ITEMS: Array<{ href: string; label: string; description: string }> = [
  { href: "/ops/isletmeler", label: "HalkYemek İşletmeleri", description: "QR, menü ve yetki" },
  { href: "/ops/surpriz-paketler", label: "HalkTasarruf İşletmeleri", description: "Fırsat paketi işletmeleri" },
  { href: "/ops/halktasarruf-firsatlari", label: "HalkTasarruf Fırsatları", description: "Fırsat ve rezervasyon" },
  { href: "/ops/bildirimler/yayinla", label: "Bildirimleri yönet", description: "Toplu duyuru gönder" },
  { href: "/ops/payoutlar", label: "Hakedişler", description: "Ödeme kaydı ve onay süreci" },
  { href: "/ops/settlement/kayitlar", label: "Kayıtlar", description: "Mutabakat kayıtları" },
];

const STATUS_LABELS: Record<string, string> = {
  ACKNOWLEDGED: "İşleme alındı",
  ACTIVE: "Aktif",
  APPLIED: "Uygulandı",
  APPROVED: "Onaylı",
  CANCELLED: "İptal edildi",
  CANCELED: "İptal edildi",
  CONFIRMED: "Onaylandı",
  DISPATCHING: "Gönderime hazırlanıyor",
  ELIGIBLE: "Ödemeye uygun",
  FAILED: "Başarısız",
  FEATURED: "Öne çıkarılmış",
  HIDDEN: "Gizli",
  INACTIVE: "Pasif",
  LISTED: "Listede",
  MATCHED: "Eşleşti",
  MANUAL_REVIEW: "Manuel inceleme",
  OPEN: "Açık",
  PAID: "Ödendi",
  PARSED: "Okundu",
  PENDING: "Beklemede",
  PROCESSED: "İşlendi",
  REJECTED: "Reddedildi",
  RESOLVED: "Çözüldü",
  RETRY: "Yeniden denenecek",
  RETRY_SCHEDULED: "Yeniden deneme planlandı",
  SENT: "Gönderildi",
  STANDARD: "Standart",
  STALE_MANUAL_REVIEW: "Gecikmiş manuel inceleme",
  SUCCESS: "Başarılı",
  UNAPPROVED: "Onay bekliyor",
  UNLISTED: "Listede değil",
  UNMATCHED: "Eşleşmedi",
  VISIBLE: "Görünür",
  WAITING: "Bekliyor",
};

const ROLE_LABELS: Record<string, string> = {
  CASHIER: "Kasa görevlisi",
  MANAGER: "Yönetici",
  OWNER: "İşletme sahibi",
};

const FIELD_LABELS: Record<string, string> = {
  confirmed_total: "Onaylanmış hakediş",
  due_to_dispatch: "Gönderim bekleyen hakediş",
  eligible: "Ödemeye uygun kazanç",
  failed_total: "Sorunlu hakediş",
  paid: "Ödenmiş kazanç",
  pending: "Bekleyen kazanç",
  pending_wallet_transactions: "Bekleyen cüzdan işlemi",
  sent_waiting_confirm: "Onay bekleyen gönderim",
};

const DANGER_STATUSES = new Set(["FAILED", "REJECTED", "CANCELLED", "CANCELED", "INACTIVE", "UNMATCHED"]);
const WARNING_STATUSES = new Set([
  "DISPATCHING",
  "HIDDEN",
  "MANUAL_REVIEW",
  "OPEN",
  "PENDING",
  "RETRY",
  "RETRY_SCHEDULED",
  "STALE_MANUAL_REVIEW",
  "UNAPPROVED",
  "UNLISTED",
  "WAITING",
]);
const SUCCESS_STATUSES = new Set([
  "ACKNOWLEDGED",
  "ACTIVE",
  "APPLIED",
  "APPROVED",
  "CONFIRMED",
  "ELIGIBLE",
  "FEATURED",
  "LISTED",
  "MATCHED",
  "PAID",
  "PARSED",
  "PROCESSED",
  "RESOLVED",
  "SENT",
  "SUCCESS",
  "VISIBLE",
]);

function normalizeKey(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

function prettifyUnknownLabel(value: string | null | undefined) {
  const text = String(value || "-").trim();
  if (!text) return "-";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("tr-TR")
    .replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase("tr-TR"));
}

export function formatOpsStatusLabel(label: string | null | undefined) {
  const normalized = normalizeKey(label);
  return STATUS_LABELS[normalized] || prettifyUnknownLabel(label);
}

export function formatOpsRoleLabel(role: string | null | undefined) {
  const normalized = normalizeKey(role);
  return ROLE_LABELS[normalized] || prettifyUnknownLabel(role);
}

export function formatOpsFieldLabel(label: string | null | undefined) {
  const key = String(label || "").trim();
  return FIELD_LABELS[key] || prettifyUnknownLabel(key);
}

export function OpsPageShell({
  title,
  description,
  children,
  compact = false,
  hideHero = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  compact?: boolean;
  hideHero?: boolean;
}) {
  const pathname = usePathname();
  const session = useSession();
  const userLabel = session.data?.user?.username?.trim() || session.data?.user?.google_email || "Oturum bilgisi okunamadı";

  return (
    <ProtectedPageShell requireAdmin>
      <Section spacing="lg" className="bg-white pb-10">
        <Container size="wide">
          <div className="space-y-6">
            {!hideHero ? <Card className="overflow-hidden border-zinc-200 bg-zinc-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
              <CardContent className={cn(compact ? "space-y-4 p-4 sm:p-5" : "space-y-6 p-5 sm:p-7")}>
                <div className={cn("flex flex-col lg:flex-row lg:items-end lg:justify-between", compact ? "gap-4" : "gap-5")}>
                  <div className="max-w-3xl">
                    <Badge tone="secondary" className="bg-white/12 text-white ring-white/15">
                      Operasyon alanı
                    </Badge>
                    <h1 className={cn("font-semibold tracking-[-0.05em] text-white", compact ? "mt-3 text-2xl sm:text-3xl lg:text-4xl" : "mt-4 text-2xl sm:text-4xl lg:text-5xl")}>
                      {title}
                    </h1>
                    <p className={cn("mt-3 text-sm text-white/72", compact ? "max-w-2xl leading-6" : "leading-7")}>{description}</p>
                  </div>
                  <div className={cn("w-full border border-white/10 bg-white/8 text-sm lg:w-auto", compact ? "rounded-[18px] px-3.5 py-2.5" : "rounded-[24px] px-4 py-3")}>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/55">Aktif ops</p>
                    <p className="mt-1 break-words font-semibold text-white">{userLabel}</p>
                  </div>
                </div>

                <div className="hy-scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-5">
                  {OPS_NAV_ITEMS.map((item) => {
                    const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn(
                          cn("min-w-[170px] rounded-[20px] border transition hover:-translate-y-0.5 sm:min-w-0", compact ? "px-3.5 py-2.5" : "px-4 py-3"),
                          isActive
                            ? "border-white bg-white text-zinc-950 shadow-[0_18px_45px_rgba(255,255,255,0.16)]"
                            : "border-white/10 bg-white/8 text-white hover:bg-white/14",
                        )}
                      >
                        <p className="text-sm font-semibold">{item.label}</p>
                        <p className={cn("mt-1 text-xs leading-5", isActive ? "text-zinc-500" : "text-white/58")}>{item.description}</p>
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card> : null}

            <div className="space-y-6">{children}</div>
          </div>
        </Container>
      </Section>
    </ProtectedPageShell>
  );
}

export function OpsMetricCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card variant="surface" className="h-full">
      <CardContent className="space-y-3" padding="lg">
        <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">{label}</p>
        <div className="break-words text-2xl font-bold tracking-tight text-[var(--hy-color-neutral-950)] sm:text-3xl">{value}</div>
        {hint ? <p className="text-sm leading-6 text-[var(--hy-color-neutral-600)]">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function OpsKeyValueGrid({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <Card key={item.label} variant="surface">
          <CardContent className="space-y-2" padding="md">
            <p className="text-sm font-semibold text-[var(--hy-color-neutral-500)]">{item.label}</p>
            <div className="break-words text-sm font-semibold leading-6 text-[var(--hy-color-neutral-950)]">{item.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function OpsTable({ columns, children }: { columns: string[]; children: ReactNode }) {
  return (
    <div className="hy-scrollbar-none -mx-1 overflow-x-auto rounded-[var(--hy-radius-md)] border border-[var(--hy-color-neutral-200)] bg-white shadow-[var(--hy-shadow-soft)] [scrollbar-gutter:stable] sm:mx-0">
      <table className="min-w-[760px] text-left text-sm sm:min-w-full">
        <thead className="bg-[var(--hy-color-neutral-50)] text-[var(--hy-color-neutral-600)]">
          <tr>
            {columns.map((column) => (
              <th key={column} className="whitespace-nowrap px-4 py-3.5 text-xs font-bold uppercase tracking-[0.12em]">
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
  return <td className={cn("align-top border-t border-[var(--hy-color-neutral-200)] px-4 py-4 text-[var(--hy-color-neutral-700)]", className)}>{children}</td>;
}

export function OpsStatus({ label }: { label: string | null | undefined }) {
  const normalized = normalizeKey(label);
  const tone = DANGER_STATUSES.has(normalized)
    ? "error"
    : WARNING_STATUSES.has(normalized)
      ? "warning"
      : SUCCESS_STATUSES.has(normalized)
        ? "success"
        : "neutral";

  return <Badge tone={tone}>{formatOpsStatusLabel(label)}</Badge>;
}

export function OpsEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Card variant="surface">
      <CardContent padding="lg">
        <EmptyState title={title} description={description} />
      </CardContent>
    </Card>
  );
}

export function OpsErrorCard({ title, description }: { title: string; description: string }) {
  return (
    <Card variant="surface">
      <CardContent padding="lg">
        <ErrorState title={title} description={description} />
      </CardContent>
    </Card>
  );
}

export function OpsJsonCard({ title, value, description }: { title: string; value: string; description?: string }) {
  return (
    <Card variant="surface">
      <CardContent className="space-y-4" padding="lg">
        <div>
          <h3 className="text-lg font-semibold text-[var(--hy-color-neutral-950)]">{title}</h3>
          {description ? <p className="mt-2 text-sm leading-6 text-[var(--hy-color-neutral-600)]">{description}</p> : null}
        </div>
        <pre className="hy-scrollbar-none max-w-full overflow-x-auto rounded-[var(--hy-radius-sm)] border border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] p-4 text-xs leading-6 text-[var(--hy-color-neutral-700)]">
          {value}
        </pre>
      </CardContent>
    </Card>
  );
}

export function OpsSectionCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card variant="surface">
      <CardContent padding="lg">
        <SectionTitle title={title} description={description} className="mb-5" />
        {children}
      </CardContent>
    </Card>
  );
}

export function OpsActionResult({
  tone = "success",
  title,
  description,
}: {
  tone?: "success" | "warning" | "danger" | "default";
  title: string;
  description?: string;
}) {
  const styles = {
    success: "border-[var(--hy-color-success-100)] bg-[var(--hy-color-success-50)] text-[var(--hy-color-success-700)]",
    warning: "border-[var(--hy-color-warning-100)] bg-[var(--hy-color-warning-50)] text-[var(--hy-color-warning-700)]",
    danger: "border-[var(--hy-color-danger-100)] bg-[var(--hy-color-danger-50)] text-[var(--hy-color-danger-700)]",
    default: "border-[var(--hy-color-neutral-200)] bg-[var(--hy-color-neutral-50)] text-[var(--hy-color-neutral-700)]",
  } as const;

  return (
    <div className={cn("break-words rounded-[var(--hy-radius-md)] border p-4 shadow-sm", styles[tone])}>
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="mt-2 text-sm leading-6 opacity-95">{description}</p> : null}
    </div>
  );
}

export function OpsLinkRow({ links }: { links: Array<{ href: string; label: string; primary?: boolean }> }) {
  if (!links.length) return null;

  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap">
      {links.map((link) => (
        <Link
          key={`${link.href}-${link.label}`}
          href={link.href}
          className={buttonClassName({
            variant: link.primary ? "primary" : "secondary",
            size: "sm",
            className: "w-full no-underline sm:w-auto",
          })}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
