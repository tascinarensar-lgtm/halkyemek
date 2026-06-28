"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { Toaster } from "sonner";

import { createQueryClient } from "@/lib/query/client";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster
        closeButton
        expand={false}
        position="top-right"
        theme="light"
        toastOptions={{
          style: {
            background: "rgba(255,255,255,0.98)",
            border: "1px solid rgba(228,228,231,0.95)",
            color: "#18181b",
            boxShadow: "0 18px 55px rgba(15,23,42,0.14)",
          },
          classNames: {
            toast: "rounded-2xl px-4 py-3",
            title: "text-sm font-semibold tracking-[-0.01em]",
            description: "text-sm leading-5 text-zinc-600",
            success: "border-emerald-200 bg-[linear-gradient(135deg,#ffffff,#f0fdf4)]",
            error: "border-rose-200 bg-[linear-gradient(135deg,#ffffff,#fff1f2)]",
            warning: "border-amber-200 bg-[linear-gradient(135deg,#ffffff,#fffbeb)]",
            info: "border-sky-200 bg-[linear-gradient(135deg,#ffffff,#f0f9ff)]",
          },
        }}
      />
    </QueryClientProvider>
  );
}
