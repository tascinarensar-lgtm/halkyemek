"use client";

import Script from "next/script";
import Image from "next/image";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, BellRing, LockKeyhole, QrCode, Sparkles, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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

type LoginFormMode = "page" | "drawer" | "popup";

export function LoginForm({ mode = "page", nextPath: nextPathOverride }: { mode?: LoginFormMode; nextPath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleButtonShellRef = useRef<HTMLDivElement | null>(null);
  const loginPendingRef = useRef(false);
  const loginMutateRef = useRef<(idToken: string) => void>(() => undefined);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleButtonWidth, setGoogleButtonWidth] = useState(320);
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

  useEffect(() => {
    loginPendingRef.current = loginMutation.isPending;
  }, [loginMutation.isPending]);

  useEffect(() => {
    loginMutateRef.current = loginMutation.mutate;
  }, [loginMutation.mutate]);

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

  useEffect(() => {
    const shellElement = googleButtonShellRef.current;

    if (!shellElement) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(240, Math.min(Math.floor(shellElement.clientWidth) - 24, 380));
      setGoogleButtonWidth(nextWidth);
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
    const buttonHost = googleButtonRef.current;

    if (!googleReady || !buttonHost || !env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || !window.google?.accounts?.id) {
      return;
    }

    buttonHost.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      callback: (response: { credential?: string }) => {
        if (!response.credential || loginPendingRef.current) {
          return;
        }
        loginMutateRef.current(response.credential);
      },
      ux_mode: "popup",
      auto_select: false,
    });
    window.google.accounts.id.renderButton(buttonHost, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: googleButtonWidth,
    });

    return () => {
      buttonHost.replaceChildren();
      window.google?.accounts?.id?.cancel?.();
    };
  }, [googleReady, googleButtonWidth]);

  const isDrawerMode = mode === "drawer";
  const isPopupMode = mode === "popup";
  const triggerGoogleLogin = () => {
    const host = googleButtonRef.current;
    const button = host?.querySelector("div[role='button']") as HTMLDivElement | null;
    button?.click();
  };

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
            <p className="text-sm text-zinc-600">Devam etmek için kayıt ol ya da giriş yap</p>
          </div>

          <div ref={googleButtonShellRef} className="relative">
            <button
              type="button"
              onClick={triggerGoogleLogin}
              disabled={!env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || !googleReady || loginMutation.isPending}
              className="group relative flex min-h-[58px] w-full items-center justify-center overflow-hidden rounded-[14px] border border-zinc-300 bg-white px-5 py-3 text-center shadow-[0_10px_24px_rgba(15,23,42,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-[0_18px_34px_rgba(15,23,42,0.1)] disabled:cursor-wait disabled:opacity-75"
            >
              <span className="absolute left-4 inline-flex h-7 w-7 items-center justify-center">
                <Image src="/google-g-logo.svg" alt="" width={20} height={20} className="h-5 w-5" />
              </span>

              <span className="block text-base font-medium text-zinc-800 transition-colors duration-200 group-hover:text-zinc-950">
                {loginMutation.isPending
                  ? "Google hesab\u0131 do\u011Frulan\u0131yor"
                  : "Google ile devam edin"}
              </span>
            </button>

            {env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
              <div className="pointer-events-none absolute -left-[9999px] top-0 opacity-0" aria-hidden="true">
                <div ref={googleButtonRef} className="min-h-11 w-full max-w-[320px]" />
              </div>
            ) : (
              <p className="mt-3 text-center text-sm text-zinc-600">Google giriş ayarı şu anda hazır değil.</p>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <div className="h-px flex-1 bg-zinc-200" />
            <span>ya da</span>
            <div className="h-px flex-1 bg-zinc-200" />
          </div>

          <button
            type="button"
            onClick={triggerGoogleLogin}
            className="w-full rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition duration-200 hover:-translate-y-0.5 hover:bg-rose-700 hover:shadow-[0_16px_32px_rgba(225,29,72,0.28)]"
          >
            Giriş Yap
          </button>

          <button
            type="button"
            onClick={triggerGoogleLogin}
            className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-800 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-400 hover:bg-zinc-50 hover:shadow-[0_14px_32px_rgba(15,23,42,0.08)]"
          >
            Kayıt Ol
          </button>
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

            <div
              ref={googleButtonShellRef}
              className={`relative mt-5 flex min-h-[88px] items-center justify-center overflow-hidden border border-zinc-200 bg-white px-4 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)] ${
                isDrawerMode ? "rounded-2xl" : "rounded-[24px]"
              }`}
            >
              {env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
                <>
                  <div ref={googleButtonRef} className={`flex min-h-11 w-full items-center justify-center transition-opacity duration-200 ${googleReady ? "opacity-100" : "opacity-0"}`} />
                  {!googleReady ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white text-sm text-zinc-500">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
                      Google girişi hazırlanıyor...
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-center text-sm text-zinc-600">Google giriş ayarı şu anda hazır değil. Lütfen daha sonra tekrar deneyin.</p>
              )}
            </div>

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
