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
      <Toaster richColors position="top-right" />
    </QueryClientProvider>
  );
}
