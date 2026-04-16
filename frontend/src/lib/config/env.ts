import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().default("HalkYemek"),
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://127.0.0.1:8000"),
  NEXT_PUBLIC_DEFAULT_DISTRICT: z.string().default("BEYLIKDUZU"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_API_KEY: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_APP_ID: z.string().optional().default(""),
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: z.string().optional().default(""),
  NEXT_PUBLIC_FCM_WEB_VAPID_KEY: z.string().optional().default(""),
  SESSION_COOKIE_PREFIX: z.string().default("hy"),
  SESSION_COOKIE_SECURE: z.coerce.boolean().default(false),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_DEFAULT_DISTRICT: process.env.NEXT_PUBLIC_DEFAULT_DISTRICT,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
  NEXT_PUBLIC_FCM_WEB_VAPID_KEY: process.env.NEXT_PUBLIC_FCM_WEB_VAPID_KEY,
  SESSION_COOKIE_PREFIX: process.env.SESSION_COOKIE_PREFIX,
  SESSION_COOKIE_SECURE: process.env.SESSION_COOKIE_SECURE,
});
