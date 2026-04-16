import { env } from "@/lib/config/env";

export const dynamic = "force-dynamic";

function buildFirebaseWorkerConfig() {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY.trim();
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID.trim();
  const messagingSenderId = env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID.trim();
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID.trim();

  if (!apiKey || !projectId || !messagingSenderId || !appId) {
    return "self.__FIREBASE_MESSAGING_CONFIG__ = null;";
  }

  const firebaseConfig = {
    apiKey,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.trim() || `${projectId}.firebaseapp.com`,
    projectId,
    messagingSenderId,
    appId,
    ...(env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID.trim()
      ? { measurementId: env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID.trim() }
      : {}),
  };

  const defaultClickUrl = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/bildirimler`;
  return `self.__FIREBASE_MESSAGING_CONFIG__ = ${JSON.stringify({ firebaseConfig, defaultClickUrl })};`;
}

export async function GET() {
  return new Response(buildFirebaseWorkerConfig(), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
