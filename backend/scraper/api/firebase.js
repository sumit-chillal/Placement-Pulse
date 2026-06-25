import admin from 'firebase-admin';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let messaging = null;

/** Load the service account from a raw-JSON env var or a file path. */
function loadServiceAccount() {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawJson) return JSON.parse(rawJson);

  const path =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    resolve(__dirname, '..', 'secrets', 'firebase-admin.json');
  if (!fs.existsSync(path)) {
    throw new Error(`Firebase service account not found at ${path}`);
  }
  return JSON.parse(fs.readFileSync(path, 'utf-8'));
}

/** Idempotent Admin SDK init (singleton — safe across hot reloads). */
export function initFirebase() {
  if (admin.apps.length) {
    messaging = admin.messaging();
    return;
  }
  const serviceAccount = loadServiceAccount();
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  messaging = admin.messaging();
}

export function isMessagingReady() {
  return !!messaging;
}

/**
 * Broadcast a newly-saved listing to a global FCM topic. The webpush block
 * is what enables BACKGROUND web push notifications on mobile browsers
 * (delivered to the service worker even when the tab/app is closed).
 */
export async function broadcastJob(job, topic) {
  if (!messaging) initFirebase();

  const title = `New Drive: ${job.companyName}`;
  const body = `CTC: ${job.ctc} | Registration closes on ${job.endDate}`;
  const link = job.registrationLink || '/';

  const message = {
    topic,
    notification: { title, body },
    // String-only data payload (FCM requirement) for the service worker.
    data: {
      companyName: String(job.companyName ?? '-'),
      ctc: String(job.ctc ?? '-'),
      endDate: String(job.endDate ?? '-'),
      registrationLink: String(job.registrationLink ?? ''),
      uniqueHash: String(job.uniqueHash ?? ''),
    },
    webpush: {
      headers: { Urgency: 'high', TTL: '86400' },
      notification: {
        title,
        body,
        icon: '/icons/notification-icon.png',
        badge: '/icons/badge.png',
        requireInteraction: true,
        tag: job.uniqueHash || 'placement-alert',
        renotify: true,
      },
      // Opens the registration link when the notification is clicked.
      fcmOptions: { link },
    },
  };

  return messaging.send(message);
}
