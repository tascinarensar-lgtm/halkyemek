import type { Metadata } from "next";
import "@/app/globals.css";

import { AppHeader } from "@/components/layout/app-header";
import { WebPushBootstrap } from "@/components/notifications/web-push-bootstrap";
import { QueryProvider } from "@/providers/query-provider";
import { SessionProvider } from "@/providers/session-provider";
import { readSessionState } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "HalkYemek",
  description: "Mahallendeki anlaşmalı işletmeleri keşfet, sepetini oluştur ve QR ile siparişini tamamla.",
  icons: {
    icon: "/hy-favicon.svg",
    shortcut: "/hy-favicon.svg",
    apple: "/hy-favicon.svg",
  },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await readSessionState();

  return (
    <html lang="tr">
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased">
        <QueryProvider>
          <SessionProvider initialSession={session}>
            <AppHeader />
            <WebPushBootstrap />
            {children}
          </SessionProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
