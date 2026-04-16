"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import { ApiClientError } from "@/lib/api/errors";
import { SESSION_QUERY_KEY } from "@/lib/query/keys";
import { useBootstrappedSession } from "@/providers/session-provider";
import type { SessionState } from "@/types/auth";

async function fetchSession() {
  const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });

  if (!response.ok) {
    throw new ApiClientError("Oturum bilgisi alınamadı.", response.status);
  }

  return (await response.json()) as SessionState;
}

export function useSession() {
  const bootstrappedSession = useBootstrappedSession();
  const initialSessionRef = useRef(bootstrappedSession);

  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    initialData: initialSessionRef.current ?? undefined,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnReconnect: true,
    refetchOnWindowFocus: true,
  });
}
