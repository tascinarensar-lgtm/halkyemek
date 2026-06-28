"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { LoginForm } from "@/components/auth/login-form";

type LoginDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  nextPath?: string;
};

export function LoginDrawer({ isOpen, onClose, nextPath }: LoginDrawerProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      const frameId = window.requestAnimationFrame(() => setIsVisible(true));
      return () => window.cancelAnimationFrame(frameId);
    }

    setIsVisible(false);
    if (!shouldRender) {
      return;
    }

    const timeoutId = window.setTimeout(() => setShouldRender(false), 280);
    return () => window.clearTimeout(timeoutId);
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!shouldRender || typeof document === "undefined") {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [shouldRender, onClose]);

  if (!shouldRender || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <button
        type="button"
        aria-label={"Giri\u015F panelini kapat"}
        className={`absolute inset-0 bg-zinc-950/58 transition-all duration-300 ease-out ${
          isVisible ? "opacity-100 backdrop-blur-md" : "opacity-0 backdrop-blur-0"
        }`}
        onClick={onClose}
      />

      <div
        className="relative z-10 flex h-full w-full items-end justify-center overflow-y-auto p-0 sm:items-start sm:p-6 sm:pt-[12vh] lg:pt-[14vh]"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose();
          }
        }}
      >
        <div
          className={`relative max-h-[92dvh] w-full overflow-hidden rounded-t-[30px] border border-white/70 bg-white shadow-[0_40px_140px_rgba(0,0,0,0.34)] transition-all duration-300 ease-out sm:max-h-[calc(100dvh-4rem)] sm:w-[min(94vw,860px)] sm:rounded-[32px] ${
            isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-8 scale-[0.975] opacity-0"
          }`}
        >
          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200/90 bg-white/95 text-zinc-700 shadow-[0_10px_30px_rgba(0,0,0,0.08)] transition duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_14px_38px_rgba(0,0,0,0.12)]"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="grid max-h-[92dvh] grid-cols-1 overflow-y-auto sm:max-h-[calc(100dvh-4rem)] md:min-h-[560px] md:grid-cols-[1.02fr_0.98fr]">
            <section className="relative hidden overflow-hidden bg-[linear-gradient(155deg,#313139_0%,#1e1f24_58%,#111216_100%)] p-6 text-white sm:p-8 md:block">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_30%)]" />

              <div className="relative flex h-full flex-col items-center justify-center gap-8 text-center">
                <div className="flex w-full max-w-[340px] flex-col items-center space-y-6">
                  <div className="inline-flex rounded-[26px] bg-white/96 p-4 shadow-[0_16px_45px_rgba(255,255,255,0.08)] ring-1 ring-white/80">
                    <Image src="/logo-halkyemek.png" alt="HalkYemek" width={230} height={72} className="h-[52px] w-auto object-contain sm:h-[58px]" priority />
                  </div>

                  <div className="w-full rounded-[28px] border border-white/20 bg-white/[0.06] px-5 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-sm">
                    <p className="text-[1.7rem] font-semibold leading-[1.2] tracking-[-0.03em] text-white sm:text-[1.95rem]">
                      {"Her bir sipari\u015Finizdeki ucuz fiyatl\u0131l\u0131\u011F\u0131 doyas\u0131ya de\u011Ferlendirin."}
                    </p>
                  </div>

                  <div className="space-y-2.5 text-sm">
                    <div className="inline-flex items-center gap-2 text-zinc-100">
                      <span className="h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_18px_rgba(255,255,255,0.92)]" />
                      <span className="text-base font-semibold">4.3 puan</span>
                    </div>
                    <p className="text-sm leading-6 text-zinc-300">
                      {"Mahallendeki anla\u015Fmal\u0131 men\u00FCler, c\u00FCzdan ve QR ile tek ak\u0131\u015Fta seni bekliyor."}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section className="flex items-center justify-center bg-[linear-gradient(180deg,#ffffff_0%,#fffdfd_100%)] p-5 pb-7 pt-14 sm:p-8 md:pt-8">
              <LoginForm mode="popup" nextPath={nextPath} />
            </section>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
