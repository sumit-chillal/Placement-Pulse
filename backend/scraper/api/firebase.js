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

// Base URL of the deployed PWA — used to build in-app deep links for
// notification taps instead of sending students straight to an external form.
const APP_URL = process.env.FRONTEND_URL || 'https://canara-web-app.web.app';

/**
 * Broadcast a newly-saved listing to a global FCM topic. The webpush block
 * is what enables BACKGROUND web push notifications on mobile browsers
 * (delivered to the service worker even when the tab/app is closed).
 */
export async function broadcastJob(job, topic) {
  if (!messaging) initFirebase();

  const companyName =
    job.companyName && job.companyName !== '-' ? job.companyName : 'New Placement Update';
  const title = job.companyName && job.companyName !== '-' ? `New Drive: ${companyName}` : companyName;
  const body = `CTC: ${job.ctc} | Registration closes on ${job.endDate}`;
  const jobId = String(job._id ?? '');
  const deepLink = jobId ? `${APP_URL}/?job=${jobId}` : APP_URL;

  const message = {
    topic,
    notification: { title, body },
    // String-only data payload (FCM requirement) for the service worker.
    data: {
      jobId,
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
        icon: '/icons/icon-192.png', // was /icons/notification-icon.png — 404, root cause of inconsistent rendering
        badge: '/icons/icon-192.png', // was /icons/badge.png — 404, same issue
        requireInteraction: true,
        tag: job.uniqueHash || 'placement-alert',
        renotify: true,
        data: { jobId },
      },
      // Opens the app's own job card, not the raw external registration link.
      fcmOptions: { link: deepLink },
    },
  };

  return messaging.send(message);
}