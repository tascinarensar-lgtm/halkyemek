"use client";

import Script from "next/script";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, BellRing, LockKeyhole, QrCode, Sparkles, Wallet } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";

import { getApiErrorMessage, parseJsonResponse } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
import { clearAccountScopedQueries } from "@/lib/query/account-scope";
import { SESSION_QUERY_KEY } from "@/lib/query/keys";
import type { SessionState } from "@/types/auth";

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void;
          prompt: () => void;
          cancel?: () => void;
        };
      };
    };
  }
}

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleButtonText = "continue_with" | "signin_with" | "signup_with";

type GoogleIdentityButtonProps = {
  text: GoogleButtonText;
  ready: boolean;
  pending: boolean;
  onCredential: (response: GoogleCredentialResponse) => void;
  className: string;
  loadingLabel?: string;
};

function getSafeNextPath(candidate: string | null) {
  if (!candidate || !candidate.startsWith("/")) {
    return "/";
  }

  return candidate.startsWith("//") ? "/" : candidate;
}

async function submitLogin(idToken: string) {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
  });

  const payload = await parseJsonResponse<SessionState | { ok?: boolean; error?: unknown }>(response);
  if (!response.ok || !payload) {
    throw payload ?? new Error("Giriş yanıtı okunamadı.");
  }

  return payload as SessionState;
}

function GoogleIdentityButton({
  text,
  ready,
  pending,
  onCredential,
  className,
  loadingLabel = "Google girişi hazırlanıyor...",
}: GoogleIdentityButtonProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [buttonWidth, setButtonWidth] = useState(320);

  useEffect(() => {
    const shellElement = shellRef.current;

    if (!shellElement) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(220, Math.min(Math.floor(shellElement.clientWidth) - 8, 380));
      setButtonWidth(nextWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(shellElement);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const buttonHost = hostRef.current;

    if (!ready || !buttonHost || !env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || !window.google?.accounts?.id) {
      return;
    }

    buttonHost.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      callback: onCredential,
      ux_mode: "popup",
      auto_select: false,
    });
    window.google.accounts.id.renderButton(buttonHost, {
      type: "standard",
      theme: "outline",
      size: "large",
      text,
      shape: "pill",
      width: buttonWidth,
      locale: "tr",
      logo_alignment: "left",
    });

    return () => {
      buttonHost.replaceChildren();
    };
  }, [buttonWidth, onCredential, ready, text]);

  if (!env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    return <p className="text-center text-sm text-zinc-600">Google giriş ayarı şu anda hazır değil.</p>;
  }

  return (
    <div ref={shellRef} className={`relative ${className}`}>
      <div
        ref={hostRef}
        className={`flex min-h-11 w-full items-center justify-center transition-opacity duration-200 ${ready ? "opacity-100" : "opacity-0"}`}
      />
      {!ready ? (
        <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-inherit bg-white text-sm text-zinc-500">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
          {loadingLabel}
        </div>
      ) : null}
      {pending ? <div className="absolute inset-0 rounded-inherit bg-white/70" aria-hidden="true" /> : null}
    </div>
  );
}

type LoginFormMode = "page" | "drawer" | "popup";

export function LoginForm({ mode = "page", nextPath: nextPathOverride }: { mode?: LoginFormMode; nextPath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [googleReady, setGoogleReady] = useState(false);
  const nextPath = useMemo(() => getSafeNextPath(nextPathOverride ?? searchParams.get("next")), [nextPathOverride, searchParams]);

  const loginMutation = useMutation({
    mutationFn: submitLogin,
    onSuccess: (session) => {
      clearAccountScopedQueries(queryClient);
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      toast.success("Giriş tamamlandı.");
      router.push(nextPath);
      router.refresh();
    },
    onError: (error) => {
      toast.error(getApiErrorMessage(error, "Giriş tamamlanamadı."));
    },
  });

  const handleCredential = useCallback(
    (response: GoogleCredentialResponse) => {
      if (!response.credential || loginMutation.isPending) {
        return;
      }

      loginMutation.mutate(response.credential);
    },
    [loginMutation],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (window.google?.accounts?.id) {
      setGoogleReady(true);
      return;
    }

    const intervalId = window.setInterval(() => {
      if (window.google?.accounts?.id) {
        setGoogleReady(true);
        window.clearInterval(intervalId);
      }
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const isDrawerMode = mode === "drawer";
  const isPopupMode = mode === "popup";

  if (isPopupMode) {
    return (
      <>
        {env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
          <Script
            src="https://accounts.google.com/gsi/client"
            strategy="afterInteractive"
            onLoad={() => setGoogleReady(true)}
            onReady={() => setGoogleReady(true)}
          />
        ) : null}
        <div className="mx-auto flex w-full max-w-[332px] flex-col space-y-5">
          <div className="space-y-1.5 text-center">
            <h3 className="text-3xl font-semibold tracking-tight text-zinc-900">Hoş geldin!</h3>
            <p className="text-sm text-zinc-600">Devam etmek için kayıt ol ya da giriş yap.</p>
          </div>

          <GoogleIdentityButton
            text="continue_with"
            ready={googleReady}
            pending={loginMutation.isPending}
            onCredential={handleCredential}
            className="min-h-[58px] overflow-hidden rounded-[14px] border border-zinc-300 bg-white px-3 py-2 text-center shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
          />

          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <div className="h-px flex-1 bg-zinc-200" />
            <span>veya</span>
            <div className="h-px flex-1 bg-zinc-200" />
          </div>

          <div className="space-y-3">
            <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="mb-2 text-sm font-semibold text-zinc-900">Giriş Yap</div>
              <GoogleIdentityButton
                text="signin_with"
                ready={googleReady}
                pending={loginMutation.isPending}
                onCredential={handleCredential}
                className="min-h-[54px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2"
                loadingLabel="Google girişi yükleniyor..."
              />
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
              <div className="mb-2 text-sm font-semibold text-zinc-900">Kayıt Ol</div>
              <GoogleIdentityButton
                text="signup_with"
                ready={googleReady}
                pending={loginMutation.isPending}
                onCredential={handleCredential}
                className="min-h-[54px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2"
                loadingLabel="Google kaydı yükleniyor..."
              />
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
        <Script
          src="https://accounts.google.com/gsi/client"
          strategy="afterInteractive"
          onLoad={() => setGoogleReady(true)}
          onReady={() => setGoogleReady(true)}
        />
      ) : null}
      <Card className={`border-zinc-200 ${isDrawerMode ? "rounded-3xl shadow-sm" : "rounded-[28px]"}`}>
        <CardContent className={`space-y-6 ${isDrawerMode ? "p-5 sm:p-6" : "p-6 sm:p-8"}`}>
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900">
              <LockKeyhole className="h-3.5 w-3.5" /> Güvenli Google girişi
            </span>
            <div>
              <h2 className={`${isDrawerMode ? "text-xl" : "text-2xl"} font-semibold tracking-tight text-zinc-950`}>Hesabınla hızlıca devam et</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Giriş yaptığında cüzdan, QR ve bildirim akışların kesintisiz devam eder.
              </p>
            </div>
          </div>

          <div
            className={`border border-zinc-200 bg-[linear-gradient(180deg,_rgba(250,250,250,1),_rgba(244,244,245,0.9))] p-5 shadow-sm ${
              isDrawerMode ? "rounded-3xl" : "rounded-[28px]"
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  <Sparkles className="h-3.5 w-3.5" />
                  Google ile tek adım giriş
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-zinc-950">Hemen devam etmek için oturum aç</h3>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm">
                <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
                Google doğrulaması
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-zinc-600">Giriş sonrası seni kaldığın sayfaya otomatik yönlendiririz.</p>

            <div className={`mt-4 grid gap-3 ${isDrawerMode ? "grid-cols-1" : "sm:grid-cols-3"}`}>
              <div className="rounded-2xl border border-white/80 bg-white/85 px-3 py-3 text-sm text-zinc-700">
                <div className="inline-flex items-center gap-1 font-semibold text-zinc-950">
                  <Wallet className="h-3.5 w-3.5" /> Cüzdan ödemesi
                </div>
                <div className="mt-1 text-zinc-600">Bakiyenle güvenli ödeme</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 px-3 py-3 text-sm text-zinc-700">
                <div className="inline-flex items-center gap-1 font-semibold text-zinc-950">
                  <QrCode className="h-3.5 w-3.5" /> QR kullanım
                </div>
                <div className="mt-1 text-zinc-600">Kasada hızlı doğrulama</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 px-3 py-3 text-sm text-zinc-700">
                <div className="inline-flex items-center gap-1 font-semibold text-zinc-950">
                  <BellRing className="h-3.5 w-3.5" /> Bildirim akışı
                </div>
                <div className="mt-1 text-zinc-600">Sipariş adımlarını takip et</div>
              </div>
            </div>

            <GoogleIdentityButton
              text="continue_with"
              ready={googleReady}
              pending={loginMutation.isPending}
              onCredential={handleCredential}
              className={`mt-5 flex min-h-[88px] items-center justify-center overflow-hidden border border-zinc-200 bg-white px-4 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)] ${
                isDrawerMode ? "rounded-2xl" : "rounded-[24px]"
              }`}
            />

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 shadow-sm">
                <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
                Güvenli kimlik doğrulama
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 shadow-sm">
                <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
                Kaldığın akışa geri dönüş
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
