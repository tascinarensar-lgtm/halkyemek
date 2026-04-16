"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRightLeft, CreditCard, ShieldCheck, Wallet } from "lucide-react";

import { NotificationReadinessBanner } from "@/components/notifications/readiness-banner";
import { NotificationReadinessSummaryCard } from "@/components/notifications/readiness-summary-card";
import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { getNotificationReadiness } from "@/features/notifications/api";
import { createTopupIntent, getTopupIntentDetail, mapPaymentIntent } from "@/features/payments/api";
import { resolvePositiveIntegerParam } from "@/features/discovery/params";
import { isNotificationReadinessError } from "@/lib/api/errors";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";

const schema = z.object({
  amount: z.coerce.number().int().min(1, "Tutar en az 1 TL olmalı."),
});

type FormValues = z.infer<typeof schema>;

const QUICK_AMOUNTS = [100, 250, 500, 1000];

function formatProvider(provider: string) {
  const normalized = String(provider || "").trim().toUpperCase();
  if (!normalized) return "Belirlenmedi";
  if (normalized === "IYZICO") return "iyzico";
  return provider;
}

export default function TopupPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const intentParam = searchParams.get("intent");
  const resolvedIntentId = resolvePositiveIntegerParam(intentParam, 0);
  const hasInvalidIntentParam = intentParam !== null && resolvedIntentId === 0;
  const intentId = hasInvalidIntentParam || resolvedIntentId === 0 ? null : resolvedIntentId;

  const readinessQuery = useQuery({
    queryKey: ["notifications", "readiness"],
    queryFn: getNotificationReadiness,
    retry: 0,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { amount: 100 },
  });

  const selectedAmount = Number(form.watch("amount") || 0);

  const createMutation = useMutation({
    mutationFn: createTopupIntent,
    onSuccess: async (intent) => {
      queryClient.setQueryData(["topup", "intent", intent.id], intent);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["topup"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet"] }),
      ]);
      if (intent.provider_page_url) {
        window.location.assign(intent.provider_page_url);
        return;
      }
      toast.success("Bakiye yükleme bağlantısı hazırlandı.");
      router.replace(`/cuzdan/yukle?intent=${intent.id}`);
    },
    onError: (error) => toast.error(describeApiError(error, "Bakiye yükleme adımı başlatılamadı.")),
  });

  const detailQuery = useQuery({
    queryKey: ["topup", "intent", intentId],
    queryFn: () => getTopupIntentDetail(String(intentId)),
    enabled: typeof intentId === "number" && intentId > 0,
    retry: 0,
  });

  const readinessBlocked =
    readinessQuery.data?.notification_ready === false ||
    (createMutation.isError && isNotificationReadinessError(createMutation.error));
  const detail = useMemo(() => (detailQuery.data ? mapPaymentIntent(detailQuery.data) : null), [detailQuery.data]);

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Cüzdana bakiye yükle"
        description="Bakiye yükleme adımını başlatabilir, son yükleme kaydını takip edebilir ve ödeme bağlantına bu ekrandan güvenle geçebilirsin."
        actions={
          <Link href="/cuzdan" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Cüzdana dön
          </Link>
        }
      />

      <NotificationReadinessBanner readiness={readinessQuery.data} />

      <div className="grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
        <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_36%),linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(250,250,249,0.95))]">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-900">
                  <Wallet className="h-3.5 w-3.5" /> Bakiye yükleme alanı
                </div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Cüzdanını birkaç adımda güçlendir</h2>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
                    Bakiye yükledikten sonra cüzdanını siparişlerde kullanabilir, yeni yükleme kayıtlarını bu sayfadan takip edebilir ve ödeme bağlantına doğrudan geçebilirsin.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Seçili yükleme tutarı</div>
                  <div className="mt-2 text-2xl font-semibold text-zinc-950">
                    <AmountText amount={selectedAmount} />
                  </div>
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm">
                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Yükleme adımı</div>
                  <div className="mt-2 text-sm font-semibold text-zinc-950">
                    {readinessBlocked ? "Ön hazırlık gerekiyor" : "Yükleme başlatılabilir"}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-zinc-900">Hazır tutarlar</div>
                <div className="text-xs text-zinc-500">Bir tutara dokunduğunda yükleme alanı otomatik güncellenir.</div>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                {QUICK_AMOUNTS.map((amount) => {
                  const isSelected = selectedAmount === amount;

                  return (
                    <button
                      key={amount}
                      type="button"
                      onClick={() =>
                        form.setValue("amount", amount, {
                          shouldValidate: true,
                          shouldDirty: true,
                          shouldTouch: true,
                        })
                      }
                      className={`rounded-2xl border px-4 py-3 text-sm font-medium shadow-sm transition ${
                        isSelected
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-white/80 bg-white/90 text-zinc-900 hover:bg-white"
                      }`}
                    >
                      <AmountText amount={amount} />
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-sky-100 bg-[linear-gradient(180deg,_rgba(248,250,252,0.96),_rgba(239,246,255,0.92))]">
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-zinc-700">
              <ShieldCheck className="h-4 w-4" /> Yükleme süreci
            </div>
            <div className="space-y-4 text-sm text-zinc-700">
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">1</span>
                <p>Tutarı belirler ve yükleme bağlantını bu sayfadan oluşturursun.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">2</span>
                <p>Güvenli ödeme ekranında işlemi tamamlayarak yüklemeyi onaylarsın.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">3</span>
                <p>Ödeme onaylandıktan sonra tutar cüzdanına yansır ve son durum bu ekranda görünür.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-zinc-950">Bakiye yükleme formu</h2>
              <p className="text-sm leading-6 text-zinc-600">
                Yüklemek istediğin tutarı gir, istersen hazır tutarlardan birini seç ve ardından ödeme bağlantını oluştur.
              </p>
            </div>

            <form onSubmit={form.handleSubmit((values) => createMutation.mutate(values))} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-zinc-900">Yükleme tutarı</label>
                <input
                  type="number"
                  inputMode="numeric"
                  value={Number.isFinite(selectedAmount) && selectedAmount > 0 ? String(selectedAmount) : ""}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    form.setValue("amount", Number(nextValue || 0), {
                      shouldValidate: true,
                      shouldDirty: true,
                      shouldTouch: true,
                    });
                  }}
                  disabled={createMutation.isPending || readinessBlocked}
                  className="w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm disabled:bg-zinc-100"
                />
                {form.formState.errors.amount ? (
                  <p className="mt-1 text-sm text-red-600">{form.formState.errors.amount.message}</p>
                ) : null}
              </div>

              {createMutation.isError && !readinessBlocked ? (
                <ErrorState
                  title="Yükleme başlatılamadı"
                  description={describeApiError(createMutation.error, "Bakiye yükleme adımı şu anda oluşturulamadı.")}
                />
              ) : null}

              <button
                type="submit"
                disabled={createMutation.isPending || readinessBlocked}
                className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {createMutation.isPending ? "Bakiye yükleme hazırlanıyor..." : "Bakiye Yükle"}
              </button>

              {readinessBlocked ? (
                <p className="text-xs text-amber-700">
                  Bakiye yükleme adımına geçmeden önce bildirim hazırlığının tamamlanması gerekiyor.
                </p>
              ) : null}
            </form>

            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Güvenli işlem anahtarı yükleme isteğinde otomatik olarak eklenir. Böylece aynı yükleme adımı yanlışlıkla tekrar başlatılsa bile süreç daha kontrollü ilerler.
            </div>
          </CardContent>
        </Card>

        <NotificationReadinessSummaryCard readiness={readinessQuery.data} />
      </div>

      {hasInvalidIntentParam ? (
        <ErrorState
          title="Geçersiz yükleme bağlantısı"
          description="Bağlantıdaki yükleme numarası okunamadı. Güvenli biçimde yeni bir yükleme adımı başlatabilirsin."
        />
      ) : null}
      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? (
        <ErrorState
          title="Yükleme bilgisi getirilemedi"
          description={describeApiError(detailQuery.error, "Son yükleme kaydı şu anda getirilemedi.")}
        />
      ) : null}

      {detail ? (
        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Son yükleme kaydın</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Başlattığın son bakiye yükleme adımını burada takip edebilir, gerekirse ödeme bağlantısına yeniden geçebilirsin.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip label={detail.statusLabel} tone={detail.statusTone} />
                <button
                  type="button"
                  onClick={() => detailQuery.refetch()}
                  className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                >
                  Yenile
                </button>
              </div>
            </div>

            <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-3">
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Yükleme tutarı</div>
                <div className="mt-2 font-medium text-zinc-900">
                  <AmountText amount={detail.amount} />
                </div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Ödeme sağlayıcısı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatProvider(detail.provider)}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Durum</div>
                <div className="mt-2 font-medium text-zinc-900">{detail.statusLabel}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Oluşturulma zamanı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatDateTime(detail.createdAt)}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">İşleme alınma zamanı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatDateTime(detail.processedAt)}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Cüzdana yansıma zamanı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatDateTime(detail.settledAt)}</div>
              </div>
            </div>

            {detail.providerPaymentUrl ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={detail.providerPaymentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  Ödeme bağlantısına git
                </a>
                <Link href={`/cuzdan/yukle?intent=${detail.id}`} className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                  Bu yükleme kaydını aç
                </Link>
              </div>
            ) : (
              <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
                Ödeme bağlantısı henüz görünmüyor. Bu paneli yenileyerek yükleme adımının son durumunu takip edebilirsin.
              </div>
            )}
          </CardContent>
        </Card>
      ) : hasInvalidIntentParam || detailQuery.isPending || detailQuery.isError || !intentParam ? null : (
        <ErrorState
          title="Yükleme bilgisi alınamadı"
          description="İstek tamamlandı ancak gösterilebilir bir yükleme kaydı dönmedi."
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <ArrowRightLeft className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Yükleme nasıl ilerler?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Bakiye yükleme sürecinin hangi adımlardan oluştuğunu bu kısa özetten hızlıca görebilirsin.
                </p>
              </div>
            </div>

            <div className="space-y-4 text-sm text-zinc-700">
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">1</span>
                <p>Önce tutarı seçer ve yükleme bağlantını oluşturursun.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">2</span>
                <p>Ödeme sağlayıcısının güvenli ekranında işlemi tamamlarsın.</p>
              </div>
              <div className="flex gap-3">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">3</span>
                <p>Onay sonrası yükleme tutarı cüzdanına yansır ve bu sayfada güncel durum görünür.</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Hızlı geçişler</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Cüzdan yönetiminde en sık ihtiyaç duyacağın sayfalara buradan doğrudan geçebilirsin.
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Link href="/cuzdan" className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Cüzdan özetine dön
              </Link>
              <Link href="/cuzdan/hareketler" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Hareket geçmişini aç
              </Link>
              <Link href="/cuzdan/bekleyen-islemler" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Bekleyen işlemleri incele
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
