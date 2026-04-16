export const AUTH_STATE_CLEARED_EVENT = "hy:auth:state-cleared";

export function notifyAuthStateCleared(reason: "logout" | "unauthorized" | "session_invalid") {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(AUTH_STATE_CLEARED_EVENT, { detail: { reason } }));
}
