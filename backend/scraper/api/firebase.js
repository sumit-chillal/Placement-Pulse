import admin from 'firebase-admin';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let messaging = null;

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

// Base URL of the deployed PWA — used to build ABSOLUTE icon URLs and deep
// links. FCM webpush icons must be absolute; relative paths render
// inconsistently across Android OEMs.
const APP_URL = (process.env.FRONTEND_URL || 'https://canara-web-app.web.app').replace(/\/$/, '');

export async function broadcastJob(job, topic) {
  if (!messaging) initFirebase();

  const companyName =
    job.companyName && job.companyName !== '-' ? job.companyName : 'New Placement Update';
  const title = job.companyName && job.companyName !== '-' ? `New Drive: ${companyName}` : companyName;
  const body = `CTC: ${job.ctc} | Registration closes on ${job.endDate}`;
  const jobId = String(job._id ?? '');
  const deepLink = jobId ? `${APP_URL}/?job=${jobId}` : APP_URL;
  const iconUrl = `${APP_URL}/icons/icon-192.png`;
  const badgeUrl = `${APP_URL}/icons/badge-96.png`;

  const message = {
    topic,
    notification: { title, body },
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
        icon: iconUrl,
        badge: badgeUrl,
        requireInteraction: true,
        tag: job.uniqueHash || 'placement-alert',
        renotify: true,
        data: { jobId },
      },
      fcmOptions: { link: deepLink },
    },
  };

  return messaging.send(message);
}