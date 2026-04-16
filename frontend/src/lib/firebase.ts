"use client";

import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";

import { env } from "@/lib/config/env";

export interface FirebaseMessagingClientConfig {
  firebaseOptions: FirebaseOptions;
  vapidKey: string;
}

export function getFirebaseMessagingClientConfig(): FirebaseMessagingClientConfig | null {
  const apiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY.trim();
  const projectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID.trim();
  const messagingSenderId = env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID.trim();
  const appId = env.NEXT_PUBLIC_FIREBASE_APP_ID.trim();
  const vapidKey = env.NEXT_PUBLIC_FCM_WEB_VAPID_KEY.trim();

  if (!apiKey || !projectId || !messagingSenderId || !appId) {
    return null;
  }

  const firebaseOptions: FirebaseOptions = {
    apiKey,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.trim() || `${projectId}.firebaseapp.com`,
    projectId,
    messagingSenderId,
    appId,
  };

  const measurementId = env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID.trim();
  if (measurementId) {
    firebaseOptions.measurementId = measurementId;
  }

  return {
    firebaseOptions,
    vapidKey,
  };
}

export function isFirebaseMessagingConfigured() {
  const config = getFirebaseMessagingClientConfig();
  return Boolean(config?.vapidKey);
}

export function getFirebaseClientApp(): FirebaseApp {
  const config = getFirebaseMessagingClientConfig();
  if (!config) {
    throw new Error("Firebase web yapılandırması eksik.");
  }

  return getApps().length ? getApp() : initializeApp(config.firebaseOptions);
}
