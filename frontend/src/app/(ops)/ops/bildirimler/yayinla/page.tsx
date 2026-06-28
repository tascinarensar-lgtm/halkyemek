"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { OpsActionResult, OpsPageShell } from "@/components/ops-console/shared";
import { Button } from "@/components/ui/Button";
import { Card, CardContent } from "@/components/ui/card";
import { queueBroadcast, queueEmailBroadcast } from "@/features/ops-console/api";
import type { EmailBroadcastAudience, EmailBroadcastPreviewResponse } from "@/features/ops-console/types";
import { asNumber, hasNonEmptyText } from "@/features/ops-console/utils";
import { getBrowserPushState, getNotificationReadiness, registerDevice, showBrowserTestNotification } from "@/features/notifications/api";
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils/cn";

const AUDIENCE_OPTIONS: Array<{ value: EmailBroadcastAudience; label: string; hint: string }> = [
  { value: "ALL", label: "Tüm kullanıcılar", hint: "Tüm uygun hesaplar" },
  { value: "CUSTOMERS", label: "Müşteriler", hint: "Müşteri hesapları" },
  { value: "BUSINESS_MEMBERS", label: "İşletme yetkilileri", hint: "İşletme üyeleri" },
];

type ResultState = {
  tone: "success" | "warning" | "danger";
  title: string;
  description: string;
};

function getAudienceOption(value: string) {
  return AUDIENCE_OPTIONS.find((option) => option.value === value) || AUDIENCE_OPTIONS[0];
}

const fieldClassName =
  "w-full rounded-[18px] border border-[var(--hy-color-neutral-200)] bg-white/90 px-4 py-3 text-sm text-[var(--hy-color-neutral-900)] outline-none transition placeholder:text-[var(--hy-color-neutral-400)] focus:border-[#f50555] focus:bg-white focus:ring-4 focus:ring-[#f50555]/10";

const summaryClassName =
  "rounded-[18px] border border-[var(--hy-color-neutral-200)] bg-white/72 px-4 py-3 text-sm font-semibold text-[var(--hy-color-neutral-700)] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]";

function FieldLabel({ children, optional = false }: { children: string; optional?: boolean }) {
  return (
    <span className="flex items-center justify-between gap-3 text-sm font-semibold text-[var(--hy-color-neutral-800)]">
      {children}
      {optional ? <span className="text-xs font-medium text-[var(--hy-color-neutral-400)]">Opsiyonel</span> : null}
    </span>
  );
}

function ChannelCard({
  eyebrow,
  title,
  children,
  accent = "primary",
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  accent?: "primary" | "dark";
}) {
  return (
    <Card
      className={cn(
        "relative overflow-hidden rounded-[24px] border shadow-[0_12px_36px_rgba(15,23,42,0.055)]",
        accent === "primary"
          ? "border-[#ffd5e1] bg-[linear-gradient(180deg,#fff_0%,#fff8fb_100%)]"
          : "border-[var(--hy-color-neutral-200)] bg-[linear-gradient(180deg,#fff_0%,#fafafa_100%)]",
      )}
    >
      <span className={cn("absolute inset-x-0 top-0 h-1", accent === "primary" ? "bg-[#f50555]" : "bg-[var(--hy-color-neutral-950)]")} />
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.18em]",
                accent === "primary" ? "text-[var(--hy-color-primary-600)]" : "text-[var(--hy-color-neutral-500)]",
              )}
            >
              {eyebrow}
            </p>
            <h2 className="mt-1 text-2xl font-bold tracking-[-0.045em] text-[var(--hy-color-neutral-950)]">{title}</h2>
          </div>
          <span
            className={cn(
              "hidden h-3 w-14 shrink-0 rounded-full sm:block",
              accent === "primary" ? "bg-[#f50555]" : "bg-[var(--hy-color-neutral-950)]",
            )}
          />
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export default function OpsBroadcastPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<EmailBroadcastAudience>("ALL");
  const [district, setDistrict] = useState("");
  const [lastResult, setLastResult] = useState<ResultState | null>(null);

  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailAudience, setEmailAudience] = useState<EmailBroadcastAudience>("ALL");
  const [emailDistrict, setEmailDistrict] = useState("");
  const [emailPreview, setEmailPreview] = useState<EmailBroadcastPreviewResponse | null>(null);
  const [emailLastResult, setEmailLastResult] = useState<ResultState | null>(null);

  const selectedAudience = getAudienceOption(audience);
  const selectedEmailAudience = getAudienceOption(emailAudience);
  const normalizedDistrict = district.trim();
  const normalizedEmailDistrict = emailDistrict.trim();

  const readinessQuery = useQuery({ queryKey: ["notifications", "readiness"], queryFn: getNotificationReadiness, retry: 0 });
  const browserStateQuery = useQuery({
    queryKey: ["notifications", "browser-state"],
    queryFn: getBrowserPushState,
    staleTime: 15_000,
  });

  const deviceReady = readinessQuery.data?.notification_ready === true;
  const permissionGranted = browserStateQuery.data?.permission === "granted" || deviceReady;
  const browserCanPrepare =
    browserStateQuery.data?.configured !== false
    && browserStateQuery.data?.secureContext !== false
    && browserStateQuery.data?.supported !== false
    && browserStateQuery.data?.environment !== "in_app_browser"
    && browserStateQuery.data?.environment !== "ios_home_screen_required";

  const targetSummary = normalizedDistrict ? `${selectedAudience.label} / ${normalizedDistrict}` : selectedAudience.hint;
  const emailTargetSummary = normalizedEmailDistrict ? `${selectedEmailAudience.label} / ${normalizedEmailDistrict}` : selectedEmailAudience.hint;

  const formIssues = useMemo(() => {
    const issues: string[] = [];
    if (!hasNonEmptyText(title)) issues.push("Başlık gerekli.");
    if (!hasNonEmptyText(body)) issues.push("Mesaj gerekli.");
    return issues;
  }, [body, title]);

  const emailFormIssues = useMemo(() => {
    const issues: string[] = [];
    if (!hasNonEmptyText(emailSubject)) issues.push("Email konusu gerekli.");
    if (emailSubject.trim().length > 160) issues.push("Email konusu 160 karakteri geçemez.");
    if (!hasNonEmptyText(emailMessage)) issues.push("Email mesajı gerekli.");
    if (emailMessage.trim().length > 2000) issues.push("Email mesajı 2000 karakteri geçemez.");
    return issues;
  }, [emailMessage, emailSubject]);

  const resetEmailPreview = () => {
    setEmailPreview(null);
    setEmailLastResult(null);
  };

  const registerDeviceMutation = useMutation({
    mutationFn: registerDevice,
    onSuccess: async (result) => {
      queryClient.setQueryData(["notifications", "readiness"], result.notification_readiness);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications"] }),
        queryClient.invalidateQueries({ queryKey: ["cart"] }),
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      toast.success("Bu cihaz bildirim için hazırlandı.");
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Bu cihaz bildirime hazırlanamadı.")),
  });

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      if (!deviceReady) {
        const result = await registerDevice();
        queryClient.setQueryData(["notifications", "readiness"], result.notification_readiness);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["notifications"] }),
          queryClient.invalidateQueries({ queryKey: ["cart"] }),
          queryClient.invalidateQueries({ queryKey: ["orders"] }),
        ]);
      }
      await showBrowserTestNotification();
    },
    onSuccess: () => toast.success("Bu cihaz hazır ve test bildirimi gönderildi.", { description: "Artık yayınlanan push bildirimleri bu PC'yi de hedefler." }),
    onError: (error) => toast.error(getApiErrorMessage(error, "Test bildirimi gösterilemedi.")),
  });

  const pushMutation = useMutation({
    mutationFn: () =>
      queueBroadcast({
        title: title.trim(),
        body: body.trim(),
        audience,
        district: normalizedDistrict || undefined,
        payload: {},
      }),
    onSuccess: (data) => {
      const queued = asNumber((data as { queued?: number }).queued, 0);
      setLastResult({
        tone: queued > 0 ? "success" : "warning",
        title: queued > 0 ? "Push bildirimi kuyruğa alındı" : "Uygun cihaz bulunamadı",
        description: queued > 0 ? `${queued} hedef kuyruğa alındı.` : "Hedef kitleyi veya ilçe filtresini kontrol edin.",
      });
      toast.success(queued > 0 ? `Push kuyruğa alındı: ${queued}` : "Uygun cihaz bulunamadı");
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setLastResult({ tone: "danger", title: "Push gönderilemedi", description: message });
      toast.error(message);
    },
  });

  const emailPreviewMutation = useMutation({
    mutationFn: () =>
      queueEmailBroadcast({
        subject: emailSubject.trim(),
        message: emailMessage.trim(),
        audience: emailAudience,
        district: normalizedEmailDistrict || undefined,
        dry_run: true,
      }),
    onSuccess: (data) => {
      const estimated = asNumber(data.estimated_count, 0);
      setEmailPreview({ ...data, dry_run: true, estimated_count: estimated });
      setEmailLastResult({
        tone: estimated > 0 ? "success" : "warning",
        title: estimated > 0 ? "Alıcı sayısı hesaplandı" : "Uygun alıcı bulunamadı",
        description: estimated > 0 ? `${estimated} kullanıcıya email gönderilebilir.` : "Doğrulanmış Google emaili olan uygun kullanıcı yok.",
      });
      toast.success(estimated > 0 ? `Email alıcısı: ${estimated}` : "Uygun email alıcısı bulunamadı");
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setEmailPreview(null);
      setEmailLastResult({ tone: "danger", title: "Alıcı sayısı hesaplanamadı", description: message });
      toast.error(message);
    },
  });

  const emailQueueMutation = useMutation({
    mutationFn: () =>
      queueEmailBroadcast({
        subject: emailSubject.trim(),
        message: emailMessage.trim(),
        audience: emailAudience,
        district: normalizedEmailDistrict || undefined,
        dry_run: false,
      }),
    onSuccess: (data) => {
      const broadcastId = String(data.broadcast_id || "");
      const estimated = asNumber(data.estimated_count, 0);
      setEmailLastResult({
        tone: "success",
        title: "Email bildirimi kuyruğa alındı",
        description: `Broadcast ID: ${broadcastId}. Hedef: ${estimated} kullanıcı.`,
      });
      setEmailPreview(null);
      toast.success("Email bildirimi kuyruğa alındı");
    },
    onError: (error) => {
      const message = getApiErrorMessage(error);
      setEmailLastResult({ tone: "danger", title: "Email gönderilemedi", description: message });
      toast.error(message);
    },
  });

  const emailPreviewCount = emailPreview?.estimated_count ?? 0;
  const isPushDisabled = pushMutation.isPending || formIssues.length > 0;
  const isEmailPreviewDisabled = emailPreviewMutation.isPending || emailQueueMutation.isPending || emailFormIssues.length > 0;
  const isEmailQueueDisabled = emailQueueMutation.isPending || emailPreviewMutation.isPending || emailFormIssues.length > 0 || !emailPreview || emailPreviewCount <= 0;

  return (
    <OpsPageShell title="Bildirimleri yönet" description="Duyuru kanalını seç, hedefi belirle, güvenli şekilde kuyruğa al." compact hideHero>
      <Card className="mb-5 rounded-[24px] border border-[#ffd5e1] bg-[linear-gradient(180deg,#fff_0%,#fff8fb_100%)] shadow-[0_12px_36px_rgba(15,23,42,0.055)]">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--hy-color-primary-600)]">Cihaz kontrolü</p>
            <h2 className="mt-1 text-xl font-bold tracking-[-0.04em] text-[var(--hy-color-neutral-950)]">
              {deviceReady ? "Bu PC bildirim için hazır" : "Bu PC henüz hedef cihaz değil"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--hy-color-neutral-600)]">
              {deviceReady
                ? "Yayınladığın push bildirimleri bu tarayıcıda da test edebilirsin."
                : "Ops hesabınla bu PC'de bildirim almak için önce cihazı hazırla. Aksi halde yayın hedefe alınsa bile bu PC'ye düşmez."}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {!deviceReady && browserCanPrepare ? (
              <Button
                onClick={() => registerDeviceMutation.mutate()}
                disabled={registerDeviceMutation.isPending}
                loading={registerDeviceMutation.isPending}
                loadingText="Hazırlanıyor"
                className="h-12 rounded-[18px] px-5"
              >
                <ShieldCheck className="h-4 w-4" />
                Bu cihazı hazırla
              </Button>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => testNotificationMutation.mutate()}
              disabled={(!permissionGranted && !browserCanPrepare) || testNotificationMutation.isPending}
              className="h-12 rounded-[18px] px-5"
            >
                    {testNotificationMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                    {deviceReady ? "Bu cihazda test et" : "Hazırla ve test et"}
                  </Button>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-5 xl:grid-cols-2">
        <ChannelCard eyebrow="Push" title="Cihaz bildirimi" accent="primary">
          {lastResult ? <OpsActionResult tone={lastResult.tone} title={lastResult.title} description={lastResult.description} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <FieldLabel>Başlık</FieldLabel>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Bugünün fırsatları hazır"
                className={fieldClassName}
              />
            </label>

            <label className="space-y-2">
              <FieldLabel>Hedef</FieldLabel>
              <select
                value={audience}
                onChange={(event) => setAudience(event.target.value as EmailBroadcastAudience)}
                className={fieldClassName}
              >
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-2">
            <FieldLabel>Mesaj</FieldLabel>
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Kısa, açık ve kullanıcıya fayda anlatan bir mesaj yaz."
              className={cn(fieldClassName, "min-h-32 resize-none")}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-2">
              <FieldLabel optional>İlçe filtresi</FieldLabel>
              <input
                value={district}
                onChange={(event) => setDistrict(event.target.value)}
                placeholder="BEYLIKDUZU"
                className={fieldClassName}
              />
            </label>

            <Button disabled={isPushDisabled} onClick={() => pushMutation.mutate()} loading={pushMutation.isPending} loadingText="Kuyruğa alınıyor" className="h-12 w-full rounded-[18px] px-6 sm:w-auto">
              Push gönder
            </Button>
          </div>

          <div className={summaryClassName}>
            Hedef: {targetSummary}
          </div>
        </ChannelCard>

        <ChannelCard eyebrow="Email" title="Email bildirimi" accent="dark">
          {emailLastResult ? <OpsActionResult tone={emailLastResult.tone} title={emailLastResult.title} description={emailLastResult.description} /> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2">
              <FieldLabel>Konu</FieldLabel>
              <input
                value={emailSubject}
                onChange={(event) => {
                  setEmailSubject(event.target.value);
                  resetEmailPreview();
                }}
                placeholder="HalkYemek menüleri hazır"
                maxLength={160}
                className={fieldClassName}
              />
            </label>

            <label className="space-y-2">
              <FieldLabel>Hedef</FieldLabel>
              <select
                value={emailAudience}
                onChange={(event) => {
                  setEmailAudience(event.target.value as EmailBroadcastAudience);
                  resetEmailPreview();
                }}
                className={fieldClassName}
              >
                {AUDIENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-2">
            <FieldLabel>Mesaj</FieldLabel>
            <textarea
              value={emailMessage}
              onChange={(event) => {
                setEmailMessage(event.target.value);
                resetEmailPreview();
              }}
              placeholder="Düz metin email mesajını buraya yaz."
              maxLength={2000}
              className={cn(fieldClassName, "min-h-32 resize-none")}
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="space-y-2">
              <FieldLabel optional>İlçe filtresi</FieldLabel>
              <input
                value={emailDistrict}
                onChange={(event) => {
                  setEmailDistrict(event.target.value);
                  resetEmailPreview();
                }}
                placeholder="BEYLIKDUZU"
                className={fieldClassName}
              />
            </label>

            <Button
              variant="secondary"
              disabled={isEmailPreviewDisabled}
              onClick={() => emailPreviewMutation.mutate()}
              loading={emailPreviewMutation.isPending}
              loadingText="Hesaplanıyor"
              className="h-12 w-full rounded-[18px] px-6 sm:w-auto"
            >
              Alıcıyı hesapla
            </Button>
          </div>

          <div className={cn(summaryClassName, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
            <span className="font-semibold text-[var(--hy-color-neutral-700)]">Hedef: {emailTargetSummary}</span>
            <span className="font-bold text-[var(--hy-color-neutral-950)]">{emailPreview ? `${emailPreviewCount} alıcı` : "Önce hesapla"}</span>
          </div>

          <Button
            disabled={isEmailQueueDisabled}
            onClick={() => emailQueueMutation.mutate()}
            loading={emailQueueMutation.isPending}
            loadingText="Kuyruğa alınıyor"
            className="h-12 w-full rounded-[18px]"
          >
            Emaili kuyruğa al
          </Button>
        </ChannelCard>
      </div>
    </OpsPageShell>
  );
}
