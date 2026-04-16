"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { PageContainer } from "@/components/ui/page-container";
import { SectionHeader } from "@/components/ui/section-header";
import { getApiErrorMessage, parseJsonResponse } from "@/lib/api/errors";
import { SESSION_QUERY_KEY } from "@/lib/query/keys";

type CallbackPhase =
  | "verifying_identity"
  | "creating_session"
  | "redirecting"
  | "missing_token"
  | "error";

function getSafeNextPath(candidate: string | null) {
  if (!candidate || !candidate.startsWith("/")) {
    return "/";
  }

  return candidate.startsWith("//") ? "/" : candidate;
}

function getPhasePresentation(phase: CallbackPhase, message: string) {
  switch (phase) {
    case "creating_session":
      return {
        title: "Oturumunuz hazirlaniyor",
        description: message,
        icon: ShieldCheck,
        tone: "sky" as const,
      };
    case "redirecting":
      return {
        title: "Yonlendiriliyorsunuz",
        description: message,
        icon: ArrowRight,
        tone: "emerald" as const,
      };
    case "missing_token":
      return {
        title: "Giris bilgisi bulunamadi",
        description: message,
        icon: AlertTriangle,
        tone: "amber" as const,
      };
    case "error":
      return {
        title: "Giris islemi tamamlanamadi",
        description: message,
        icon: AlertTriangle,
        tone: "rose" as const,
      };
    case "verifying_identity":
    default:
      return {
        title: "Kimlik dogrulaniyor",
        description: message,
        icon: LoaderCircle,
        tone: "zinc" as const,
      };
  }
}

function getStepState(currentPhase: CallbackPhase, index: number) {
  const order: Record<CallbackPhase, number> = {
    verifying_identity: 0,
    creating_session: 1,
    redirecting: 2,
    missing_token: 0,
    error: 0,
  };

  if (currentPhase === "missing_token" || currentPhase === "error") {
    return index === 0 ? "warning" : "idle";
  }

  const currentIndex = order[currentPhase];
  if (index < currentIndex) {
    return "done";
  }
  if (index === currentIndex) {
    return "active";
  }
  return "idle";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const handledRef = useRef(false);
  const redirectTimerRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<CallbackPhase>("verifying_identity");
  const [phaseMessage, setPhaseMessage] = useState(
    "Google hesabiniz dogrulaniyor. Oturumunuz hazirlandiktan sonra sizi kaldiginiz akisa yonlendirecegiz.",
  );

  useEffect(() => {
    if (handledRef.current) {
      return;
    }

    const idToken = searchParams.get("id_token");
    const nextPath = getSafeNextPath(searchParams.get("next"));
    handledRef.current = true;

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/auth/callback");
    }

    const scheduleRedirect = (target: string, delayMs: number) => {
      if (typeof window === "undefined") {
        router.replace(target);
        return;
      }

      redirectTimerRef.current = window.setTimeout(() => {
        router.replace(target);
      }, delayMs);
    };

    if (!idToken) {
      setPhase("missing_token");
      setPhaseMessage("Giris bilgisi tamamlanmadi. Sizi giris ekranina yonlendirip islemi guvenli sekilde yeniden baslatacagiz.");
      scheduleRedirect(`/giris?next=${encodeURIComponent(nextPath)}`, 900);
      return;
    }

    let isActive = true;

    void (async () => {
      try {
        setPhase("verifying_identity");
        setPhaseMessage("Google hesabi dogrulaniyor. Kimlik bilgileriniz guvenli sekilde kontrol ediliyor.");

        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        });

        setPhase("creating_session");
        setPhaseMessage("Oturumunuz olusturuluyor. Hesap bilgileriniz ve yetkileriniz guvenli sekilde hazirlaniyor.");

        const payload = await parseJsonResponse(response);
        if (!response.ok) {
          if (isActive) {
            const errorMessage = getApiErrorMessage(payload ?? undefined, "Giris islemi tamamlanamadi.");
            setPhase("error");
            setPhaseMessage(`${errorMessage} Sizi giris ekranina yonlendirip yeniden denemenizi saglayacagiz.`);
            toast.error(errorMessage);
            scheduleRedirect(`/giris?next=${encodeURIComponent(nextPath)}`, 1200);
          }
          return;
        }

        if (!isActive) {
          return;
        }

        queryClient.setQueryData(SESSION_QUERY_KEY, payload);
        void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY, refetchType: "none" });

        setPhase("redirecting");
        setPhaseMessage("Giris islemi tamamlandi. Sizi uygun ekrana yonlendiriyoruz.");
        toast.success("Giris tamamlandi.");
        router.replace(nextPath);
        router.refresh();
      } catch (error) {
        if (!isActive) {
          return;
        }

        const errorMessage = getApiErrorMessage(error, "Giris islemi tamamlanamadi.");
        setPhase("error");
        setPhaseMessage(`${errorMessage} Kisa bir yonlendirme ile sizi yeniden giris ekranina alacagiz.`);
        toast.error(errorMessage);
        scheduleRedirect(`/giris?next=${encodeURIComponent(nextPath)}`, 1200);
      }
    })();

    return () => {
      isActive = false;
      if (redirectTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, [queryClient, router, searchParams]);

  const phasePresentation = getPhasePresentation(phase, phaseMessage);
  const PhaseIcon = phasePresentation.icon;

  const steps = useMemo(
    () => [
      {
        title: "Kimlik dogrulama",
        description: "Google hesabi ve giris bilgileri guvenli sekilde kontrol edilir.",
      },
      {
        title: "Oturum hazirlama",
        description: "Hesap verileri ve erisim bilgileri sisteme tanimlanir.",
      },
      {
        title: "Akisa donus",
        description: "Islem tamamlandiginda uygun sayfaya otomatik yonlendirme yapilir.",
      },
    ],
    [],
  );

  return (
    <PageContainer className="max-w-4xl space-y-6">
      <SectionHeader
        title="Giris islemi tamamlaniyor"
        description="Hesabiniz dogrulaniyor, guvenli oturumunuz hazirlaniyor ve sizi HalkYemek icindeki uygun ekrana yonlendiriyoruz."
      />

      <Card className="overflow-hidden border-stone-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] shadow-sm">
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-900">
                <ShieldCheck className="h-3.5 w-3.5" />
                Guvenli giris akisi
              </div>
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">{phasePresentation.title}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{phasePresentation.description}</p>
              </div>
            </div>

            <div
              className={`rounded-2xl border p-4 shadow-sm lg:max-w-sm ${
                phasePresentation.tone === "emerald"
                  ? "border-emerald-200 bg-emerald-50/80"
                  : phasePresentation.tone === "amber"
                    ? "border-amber-200 bg-amber-50/80"
                    : phasePresentation.tone === "rose"
                      ? "border-rose-200 bg-rose-50/80"
                      : phasePresentation.tone === "sky"
                        ? "border-sky-200 bg-sky-50/80"
                        : "border-zinc-200 bg-zinc-50/80"
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${
                    phasePresentation.tone === "emerald"
                      ? "bg-emerald-100 text-emerald-700"
                      : phasePresentation.tone === "amber"
                        ? "bg-amber-100 text-amber-700"
                        : phasePresentation.tone === "rose"
                          ? "bg-rose-100 text-rose-700"
                          : phasePresentation.tone === "sky"
                            ? "bg-sky-100 text-sky-700"
                            : "bg-zinc-100 text-zinc-700"
                  }`}
                >
                  <PhaseIcon className={`h-5 w-5 ${phase === "verifying_identity" ? "animate-spin" : ""}`} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-950">Anlik durum</h3>
                  <p className="mt-1 text-sm leading-6 text-zinc-600">
                    Bu ekran giris akisi boyunca kisa sure gorunebilir. Islem tamamlandiginda yonlendirme otomatik olarak yapilir.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {steps.map((step, index) => {
              const state = getStepState(phase, index);
              const stateStyles =
                state === "done"
                  ? "border-emerald-200 bg-emerald-50"
                  : state === "active"
                    ? "border-sky-200 bg-sky-50"
                    : state === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-zinc-200 bg-white";

              return (
                <div key={step.title} className={`rounded-2xl border p-4 shadow-sm ${stateStyles}`}>
                  <div className="text-xs font-medium uppercase tracking-[0.14em] text-zinc-500">Adim {index + 1}</div>
                  <div className="mt-2 text-base font-semibold text-zinc-950">{step.title}</div>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{step.description}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Bu ekranda ne oluyor?</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Google ile giris adiminin hemen ardindan hesabinizin kimlik bilgileri dogrulanir, oturumunuz olusturulur ve sizi kaldiginiz sayfaya guvenli sekilde geri dondururuz.
              </p>
            </div>
            <div className="rounded-2xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-600">
              Islem normalde kisa surer. Ag gecikmesi veya oturum dogrulama suresi nedeniyle bu gecis ekranini birkac saniye gormeniz beklenir.
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="space-y-4 p-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Bir sorun olursa</h2>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Giris akisi tamamlanamazsa sizi yeniden giris ekranina yonlendiririz. Isterseniz beklemeden ilgili alanlara elle de gecis yapabilirsiniz.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/giris" className="rounded-xl bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
                Giris ekranina don
              </Link>
              <Link href="/" className="rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-200">
                Ana sayfaya git
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
