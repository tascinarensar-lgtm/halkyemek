"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { SessionState } from "@/types/auth";
import { SESSION_QUERY_KEY } from "@/lib/query/keys";
import { AUTH_STATE_CLEARED_EVENT } from "@/lib/auth/events";
import { getAnonymousSessionState } from "@/lib/auth/session-state";

const SessionBootstrapContext = createContext<SessionState | null>(null);

export function SessionProvider({ children, initialSession }: { children: ReactNode; initialSession: SessionState }) {
  const queryClient = useQueryClient();
  const hydratedInitialSessionRef = useRef<SessionState | null>(null);

  useEffect(() => {
    hydratedInitialSessionRef.current = initialSession;
    queryClient.setQueryData(SESSION_QUERY_KEY, initialSession);
  }, [initialSession, queryClient]);

  useEffect(() => {
    function handleAuthStateCleared() {
      queryClient.removeQueries();
      queryClient.setQueryData(SESSION_QUERY_KEY, getAnonymousSessionState());
    }

    window.addEventListener(AUTH_STATE_CLEARED_EVENT, handleAuthStateCleared as EventListener);
    return () => {
      window.removeEventListener(AUTH_STATE_CLEARED_EVENT, handleAuthStateCleared as EventListener);
    };
  }, [queryClient]);

  return <SessionBootstrapContext.Provider value={hydratedInitialSessionRef.current ?? initialSession}>{children}</SessionBootstrapContext.Provider>;
}

export function useBootstrappedSession() {
  return useContext(SessionBootstrapContext);
}
