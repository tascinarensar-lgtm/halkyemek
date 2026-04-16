"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, ShieldCheck, Wallet, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AmountText } from "@/components/ui/amount-text";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusChip } from "@/components/ui/status-chip";
import { resolvePositiveIntegerParam } from "@/features/discovery/params";
import { getTopupIntentDetail, mapPaymentIntent } from "@/features/payments/api";
import type { TopupIntentViewModel } from "@/features/payments/types";
import { describeApiError } from "@/lib/api/presentation";
import { formatDateTime } from "@/lib/utils/format";

type ResultTone = "default" | "success" | "warning" | "danger";

interface ResultPresentation {
  title: string;
  description: string;
  detail: string;
  badge: string;
  tone: ResultTone;
  icon: LucideIcon;
}

function formatProvider(provider: string) {
  const normalized = String(provider || "").trim().toUpperCase();
  if (!normalized) return "Belirlenmedi";
  if (normalized === "IYZICO") return "iyzico";
  return provider;
}

function buildPresentation(statusCode: string, detail: TopupIntentViewModel | null): ResultPresentation {
  if (detail?.isSettled) {
    return {
      title: "Bakiyen cüzdanına yansıdı",
      description: "Bakiye yükleme işlemin tamamlandı. Kullanılabilir bakiyen artık siparişlerinde hazır.",
      detail: "Cüzdan ekranına dönerek güncel bakiyeni ve son hareketlerini hemen kontrol edebilirsin.",
      badge: "Tamamlandı",
      tone: "success",
      icon: CheckCircle2,
    };
  }

  switch (statusCode) {
    case "paid":
      return {
        title: "Ödemen alındı",
        description: "Ödeme adımın başarıyla tamamlandı. Tutarın önce onay ve yansıtma sürecine geçer.",
        detail: "Bakiyen hazır olduğunda cüzdan ekranında ve hareket geçmişinde güncel durumu görebilirsin.",
        badge: "Ödeme alındı",
        tone: "warning",
        icon: Clock3,
      };
    case "duplicate":
      return {
        title: "Bu yükleme daha önce işlendi",
        description: "Aynı ödeme dönüşü yeniden geldiği için mevcut yükleme kaydın güvenli şekilde yeniden açıldı.",
        detail: "Aşağıdaki bilgilerden son durumu kontrol ederek cüzdanına veya yükleme ekranına devam edebilirsin.",
        badge: "Tekrar açıldı",
        tone: "warning",
        icon: ShieldCheck,
      };
    case "failed":
      return {
        title: "Ödeme tamamlanamadı",
        description: "Bakiye yükleme işlemi bu denemede başarıyla tamamlanmadı.",
        detail: "İstersen aynı tutarla yeniden deneyebilir ya da cüzdan ekranına dönerek farklı bir yükleme başlatabilirsin.",
        badge: "Başarısız",
        tone: "danger",
        icon: XCircle,
      };
    case "cancelled":
      return {
        title: "İşlem iptal edildi",
        description: "Bakiye yükleme süreci kullanıcı ya da ödeme sağlayıcısı tarafında iptal edildi.",
        detail: "Hazır olduğunda yeni bir bakiye yükleme başlatabilir ya da cüzdan özetine geri dönebilirsin.",
        badge: "İptal edildi",
        tone: "danger",
        icon: XCircle,
      };
    case "provider_error":
      return {
        title: "Ödeme sonucu doğrulanıyor",
        description: "Ödeme ekranından dönüş alındı ancak sağlayıcı yanıtı bu anda net olarak doğrulanamadı.",
        detail: "Birazdan tekrar kontrol etmeyi deneyebilir veya cüzdan ekranından son hareketleri takip edebilirsin.",
        badge: "Kontrol ediliyor",
        tone: "warning",
        icon: Clock3,
      };
    case "intent_not_found":
      return {
        title: "Yükleme kaydı bulunamadı",
        description: "Ödeme dönüşü alındı ancak eşleşen bakiye yükleme kaydı bulunamadı.",
        detail: "Yeni bir bakiye yükleme başlatıp güvenli bağlantı ile yeniden devam edebilirsin.",
        badge: "Kayıt bulunamadı",
        tone: "danger",
        icon: XCircle,
      };
    case "invalid_callback":
      return {
        title: "Ödeme dönüş bilgisi eksik",
        description: "Ödeme sağlayıcısından gelen bilgiler eksik olduğu için sonuç ekranı tam olarak oluşturulamadı.",
        detail: "Yeni bir bakiye yükleme başlatabilir ya da cüzdan özetine dönerek mevcut durumunu kontrol edebilirsin.",
        badge: "Eksik bilgi",
        tone: "danger",
        icon: XCircle,
      };
    default:
      return {
        title: "Ödeme sonucu kontrol ediliyor",
        description: "Yükleme adımın tamamlandıktan sonra son durum burada güncellenecek.",
        detail: "Sayfayı yenileyebilir veya cüzdan ekranından bakiye durumunu tekrar kontrol edebilirsin.",
        badge: "Bekleniyor",
        tone: "warning",
        icon: Clock3,
      };
  }
}

export default function TopupResultPage() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const intentParam = searchParams.get("intent");
  const statusCode = String(searchParams.get("status") || "").trim().toLowerCase();
  const resolvedIntentId = resolvePositiveIntegerParam(intentParam, 0);
  const hasInvalidIntentParam = intentParam !== null && resolvedIntentId === 0;
  const intentId = hasInvalidIntentParam || resolvedIntentId === 0 ? null : resolvedIntentId;

  useEffect(() => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["wallet"] }),
      queryClient.invalidateQueries({ queryKey: ["topup"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet", "transactions"] }),
      queryClient.invalidateQueries({ queryKey: ["wallet", "pending-transactions"] }),
    ]);
  }, [queryClient, intentId, statusCode]);

  const detailQuery = useQuery({
    queryKey: ["topup", "intent", intentId],
    queryFn: () => getTopupIntentDetail(String(intentId)),
    enabled: typeof intentId === "number" && intentId > 0,
    retry: 0,
  });

  const detail = useMemo(() => (detailQuery.data ? mapPaymentIntent(detailQuery.data) : null), [detailQuery.data]);
  const presentation = buildPresentation(statusCode, detail);
  const Icon = presentation.icon;

  return (
    <PageContainer className="space-y-6">
      <SectionHeader
        title="Bakiye yükleme sonucu"
        description="Ödeme adımından sonra oluşan son durumu bu ekranda takip edebilir, cüzdanına veya yeni yükleme adımına güvenle devam edebilirsin."
        actions={
          <Link href="/cuzdan" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
            Cüzdana dön
          </Link>
        }
      />

      <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.08),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))]">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4">
              <div
                className={`inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${
                  presentation.tone === "success"
                    ? "bg-emerald-100 text-emerald-700"
                    : presentation.tone === "danger"
                      ? "bg-red-100 text-red-700"
                      : "bg-amber-100 text-amber-700"
                }`}
              >
                <Icon className="h-6 w-6" />
              </div>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip label={presentation.badge} tone={presentation.tone} />
                  {detail ? <StatusChip label={detail.statusLabel} tone={detail.statusTone} /> : null}
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-zinc-950">{presentation.title}</h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{presentation.description}</p>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-500">{presentation.detail}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm lg:max-w-sm">
              <div className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                <Wallet className="h-4 w-4" /> Sonraki adım
              </div>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {detail?.isSettled
                  ? "Bakiyen artık kullanılabilir durumda. Sipariş akışına dönüp menülerden seçim yapabilirsin."
                  : "Ödeme sağlayıcısından döndükten sonra bakiye yükleme durumunu burada ve cüzdan özetinde takip edebilirsin."}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl bg-zinc-50 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Sonuç durumu</div>
              <div className="mt-2 text-sm font-semibold text-zinc-950">{presentation.badge}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Yükleme kaydı</div>
              <div className="mt-2 text-sm font-semibold text-zinc-950">{detail ? `#${detail.id}` : "Henüz okunamadı"}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Ödeme kanalı</div>
              <div className="mt-2 text-sm font-semibold text-zinc-950">{detail ? formatProvider(detail.provider) : "iyzico"}</div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4">
              <div className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Cüzdan durumu</div>
              <div className="mt-2 text-sm font-semibold text-zinc-950">{detail?.isSettled ? "Kullanılabilir bakiye" : "Kontrol ve yansıtma sürecinde"}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {hasInvalidIntentParam ? (
        <ErrorState
          title="Geçersiz sonuç bağlantısı"
          description="Bağlantıdaki yükleme numarası okunamadı. Cüzdan ekranına dönüp güvenli şekilde yeni bir bakiye yükleme başlatabilirsin."
        />
      ) : null}

      {detailQuery.isPending ? <LoadingSkeleton /> : null}
      {detailQuery.isError ? (
        <ErrorState
          title="Yükleme detayı alınamadı"
          description={describeApiError(detailQuery.error, "Ödeme sonucu alındı ancak yükleme detayını şu anda gösteremiyoruz.")}
        />
      ) : null}

      {detail ? (
        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Yükleme detayın</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Son ödeme adımına ait temel bilgileri, zaman damgalarını ve cüzdana yansıma durumunu burada görebilirsin.
                </p>
              </div>
              <StatusChip label={detail.statusLabel} tone={detail.statusTone} />
            </div>

            <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Yükleme tutarı</div>
                <div className="mt-2 font-medium text-zinc-900">
                  <AmountText amount={detail.amount} />
                </div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Durum</div>
                <div className="mt-2 font-medium text-zinc-900">{detail.statusLabel}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Ödeme kanalı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatProvider(detail.provider)}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Oluşturulma zamanı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatDateTime(detail.createdAt)}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Ödemenin işlenme zamanı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatDateTime(detail.processedAt)}</div>
              </div>
              <div className="rounded-2xl bg-zinc-50 p-4">
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Cüzdana yansıma zamanı</div>
                <div className="mt-2 font-medium text-zinc-900">{formatDateTime(detail.settledAt)}</div>
              </div>
            </div>

            {detail.processingError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                Son işlem notu: {detail.processingError}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Bakiye ne zaman kullanıma açılır?</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Ödeme alındıktan sonra bakiye önce sistem kontrolünden ve sağlayıcı yansıtma sürecinden geçer. Tamamlandığında cüzdan ekranında kullanılabilir bakiye olarak görünür.
                </p>
              </div>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              {detail?.isSettled
                ? "Bu yükleme için yansıtma tamamlandı. Artık sipariş akışına dönüp bakiyeni doğrudan kullanabilirsin."
                : "Bu aşamada para çekimi ödeme adımında alınmış olabilir; ancak cüzdanda kullanılabilir duruma gelmesi için yansıtma sürecinin tamamlanması gerekir."}
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200">
          <CardContent className="space-y-5 p-6">
            <div className="flex items-start gap-3">
              <ArrowLeft className="mt-0.5 h-5 w-5 text-zinc-700" />
              <div>
                <h2 className="text-lg font-semibold text-zinc-950">Hızlı geçişler</h2>
                <p className="mt-1 text-sm leading-6 text-zinc-600">
                  Bakiye yükleme sonucundan sonra en sık ihtiyaç duyacağın ekranlara buradan doğrudan geçebilirsin.
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Link href="/cuzdan" className="inline-flex items-center justify-center rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Cüzdan özetine dön
              </Link>
              <Link href="/cuzdan/yukle" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Yeni bakiye yükleme başlat
              </Link>
              <Link href="/cuzdan/hareketler" className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Cüzdan hareketlerini aç
              </Link>
              {detail?.providerPaymentUrl && !detail.isProcessed ? (
                <a
                  href={detail.providerPaymentUrl}
                  target="_self"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200"
                >
                  Ödeme sayfasını yeniden aç
                </a>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
