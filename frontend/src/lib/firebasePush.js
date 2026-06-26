import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import { API } from './api';

// Web app config is read from env. Until the user fills these (Firebase Console
// → Project Settings → Web app + a Web Push VAPID key), push gracefully no-ops.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_FIREBASE_APP_ID,
};
const VAPID_KEY = process.env.REACT_APP_FCM_VAPID_KEY;
export const TOPIC = 'placement_alerts';

/** Registers the lightweight app SW (required for PWA installability). */
export async function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch (err) {
    console.warn('[pwa] app SW registration failed', err);
    return null;
  }
}

/** Registers a visitor's FCM token to the placement topic server-side. */
export async function subscribeToken(token) {
  try {
    const res = await fetch(`${API}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) console.info('[push] subscribed to topic', data);
    return data;
  } catch (err) {
    console.warn('[push] topic subscribe failed', err);
    return null;
  }
}

/**
 * Initializes FCM web push: registers the messaging service worker, requests
 * notification permission, retrieves the device token, AUTO-SUBSCRIBES it to
 * the placement topic, and binds a foreground listener. Pass { silent: true }
 * to skip when permission isn't already granted (used for return visits).
 */
export async function initPush({ silent = false } = {}) {
  if (!firebaseConfig.apiKey || !VAPID_KEY) {
    console.info('[push] Firebase web config / VAPID key not set — push disabled.');
    return { ok: false, reason: 'not-configured' };
  }
  if (!(await isSupported().catch(() => false))) {
    return { ok: false, reason: 'unsupported' };
  }
  if (silent && Notification.permission !== 'granted') {
    return { ok: false, reason: 'not-granted' };
  }

  try {
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };

    const app = initializeApp(firebaseConfig);
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });
    if (!token) return { ok: false, reason: 'no-token' };

    // Auto-register this visitor to the global topic — no manual setup needed.
    await subscribeToken(token);

    onMessage(messaging, (payload) => {
      const { title, body } = payload.notification || {};
      if (title && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/icons/icon-192.png' });
      }
    });

    return { ok: true, token };
  } catch (err) {
  console.error("FULL ERROR:", err);
  console.error("CODE:", err.code);
  console.error("MESSAGE:", err.message);
  console.error("STACK:", err.stack);

  return {
    ok: false,
    reason: err.code,
    message: err.message,
  };
}
}
