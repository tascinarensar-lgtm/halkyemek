"use client";

import Script from "next/script";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";

import { getApiErrorMessage, parseJsonResponse } from "@/lib/api/errors";
import { env } from "@/lib/config/env";
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

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleButtonShellRef = useRef<HTMLDivElement | null>(null);
  const loginPendingRef = useRef(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleButtonWidth, setGoogleButtonWidth] = useState(320);
  const nextPath = useMemo(() => getSafeNextPath(searchParams.get("next")), [searchParams]);

  const loginMutation = useMutation({
    mutationFn: submitLogin,
    onSuccess: (session) => {
      queryClient.setQueryData(SESSION_QUERY_KEY, session);
      queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
      toast.success("Giriş başarılı. Yönlendiriliyorsunuz.");
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

  function handleGoogleCredential(idToken: string) {
    if (loginPendingRef.current) {
      return;
    }

    loginMutation.mutate(idToken);
  }

  useEffect(() => {
    const element = googleButtonShellRef.current;

    if (!element) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.max(240, Math.min(Math.floor(element.clientWidth) - 24, 380));
      setGoogleButtonWidth(nextWidth);
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!googleReady || !googleButtonRef.current || !env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || !window.google?.accounts?.id) {
      return;
    }

    googleButtonRef.current.replaceChildren();
    window.google.accounts.id.initialize({
      client_id: env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
      callback: (response: { credential?: string }) => {
        if (response.credential) {
          handleGoogleCredential(response.credential);
        }
      },
      ux_mode: "popup",
      auto_select: false,
    });
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "continue_with",
      shape: "pill",
      width: googleButtonWidth,
    });

    return () => {
      googleButtonRef.current?.replaceChildren();
      window.google?.accounts?.id?.cancel?.();
    };
  }, [googleReady, googleButtonWidth]);

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
      <Card className="rounded-[28px] border-zinc-200">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="space-y-3">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900">
              <ShieldCheck className="h-3.5 w-3.5" /> Güvenli giriş
            </span>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Google hesabınla devam et</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                Tek adımda giriş yaparak HalkYemek'teki özel menülere ve sipariş akışına güvenli şekilde devam edebilirsin.
              </p>
            </div>
          </div>

          <div className="rounded-[28px] border border-zinc-200 bg-[linear-gradient(180deg,_rgba(250,250,250,1),_rgba(244,244,245,0.9))] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
                  <Sparkles className="h-3.5 w-3.5" />
                  Google ile hızlı giriş
                </div>
                <h3 className="text-lg font-semibold tracking-tight text-zinc-950">Tek dokunuşla oturumunu başlat</h3>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm">
                <LockKeyhole className="h-3.5 w-3.5" />
                Güvenli doğrulama
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-zinc-600">
              Girişe bastıktan sonra Google doğrulama penceresi açılır, hesabını seçersin ve oturumun açılarak seni kaldığın akışa geri taşırız.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/80 bg-white/85 px-3 py-3 text-sm text-zinc-700">
                <div className="font-semibold text-zinc-950">Hızlı</div>
                <div className="mt-1 text-zinc-600">Tek butonla giriş</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 px-3 py-3 text-sm text-zinc-700">
                <div className="font-semibold text-zinc-950">Güvenli</div>
                <div className="mt-1 text-zinc-600">Google doğrulaması</div>
              </div>
              <div className="rounded-2xl border border-white/80 bg-white/85 px-3 py-3 text-sm text-zinc-700">
                <div className="font-semibold text-zinc-950">Kesintisiz</div>
                <div className="mt-1 text-zinc-600">Kaldığın yere dönüş</div>
              </div>
            </div>

            <div ref={googleButtonShellRef} className="relative mt-5 flex min-h-[88px] items-center justify-center overflow-hidden rounded-[24px] border border-zinc-200 bg-white px-4 py-4 shadow-[0_8px_30px_rgba(0,0,0,0.04)]">
              {env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ? (
                <>
                  <div ref={googleButtonRef} className={`flex min-h-11 w-full items-center justify-center transition-opacity duration-200 ${googleReady ? "opacity-100" : "opacity-0"}`} />
                  {!googleReady ? (
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white text-sm text-zinc-500">
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
                      Google giriş hazırlanıyor...
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-center text-sm text-zinc-600">
                  Google giriş ayarı şu anda hazır değil. Lütfen daha sonra tekrar deneyin.
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 shadow-sm">
                <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
                Google hesabın ile doğrulanır
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1.5 shadow-sm">
                <BadgeCheck className="h-3.5 w-3.5 text-emerald-600" />
                Kaldığın akışa geri döner
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
