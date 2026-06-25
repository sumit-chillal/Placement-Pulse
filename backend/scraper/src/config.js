import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

function required(key) {
  const value = process.env[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key, fallback) {
  const value = process.env[key];
  return value === undefined || value === '' ? fallback : value;
}

export const config = {
  loginUrl: required('LOGIN_URL'),
  credentials: {
    email: required('PORTAL_EMAIL'),
    password: required('PORTAL_PASSWORD'),
  },
  discordWebhookUrl: required('DISCORD_WEBHOOK_URL'),
  mongo: {
    uri: required('MONGO_URI'),
    dbName: optional('DB_NAME', 'placement_scraper'),
    collectionName: optional('COLLECTION_NAME', 'placement_jobs'),
  },
  selectors: {
    email: optional('EMAIL_SELECTOR', 'input[name="email"]'),
    password: optional('PASSWORD_SELECTOR', 'input[name="password"]'),
    submit: optional('SUBMIT_SELECTOR', 'input[name="submit"]'),
  },
  maxConsecutiveFailures: parseInt(optional('MAX_CONSECUTIVE_FAILURES', '3'), 10),
  maxRows: parseInt(optional('MAX_ROWS', '0'), 10),
  syncApiUrl: optional('SYNC_API_URL', 'http://localhost:5050'),
  enableEnrich: optional('ENABLE_ENRICH', 'true') !== 'false',
  headless: optional('HEADLESS', 'true') !== 'false',
  navTimeoutMs: parseInt(optional('NAV_TIMEOUT_MS', '60000'), 10),
  runOnBoot: optional('RUN_ON_BOOT', 'false') === 'true',
};
