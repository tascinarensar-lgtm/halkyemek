export const OPEN_LOGIN_DRAWER_EVENT = "halkyemek:open-login-drawer";

export type OpenLoginDrawerDetail = {
  nextPath?: string;
};

export function openLoginDrawer(nextPath?: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<OpenLoginDrawerDetail>(OPEN_LOGIN_DRAWER_EVENT, {
      detail: { nextPath },
    }),
  );
}
