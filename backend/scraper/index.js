import cron from 'node-cron';
import { runScrapeJob } from './src/scraper.js';
import { closeDb } from './src/db.js';
import { config } from './src/config.js';
import { logger } from './src/logger.js';
import { createApp } from './api/app.js';
import { connectDatabase, disconnectDatabase } from './api/database.js';
import { initFirebase } from './api/firebase.js';
import { purgeStaleUndatedJobs } from './src/cleanup.js';

// Daytime: every 30 minutes from 08:00 to 23:59 IST.
const DAY_SCHEDULE = '*/30 8-23 * * *';
// Nighttime: every 2 hours across 00:00 → 07:59 IST.
const NIGHT_SCHEDULE = '0 0-7/2 * * *';
// Cleanup: once daily, well clear of both windows above.
const CLEANUP_SCHEDULE = '0 3 * * *';

const API_PORT = parseInt(process.env.API_PORT, 10) || 5050;
let apiServer = null;

// Guard against overlapping runs if a previous cycle is still in flight.
let running = false;

async function trigger(label) {
  if (running) {
    logger.warn('Skipping tick — previous run still in progress', { label });
    return;
  }
  running = true;
  logger.info('Cron tick fired', { label });
  try {
    await runScrapeJob();
  } finally {
    running = false;
  }
}

/**
 * Start the internal Express API (POST /api/sync, GET /api/jobs/known, etc.)
 * on the same container as the scraper. `enrich.js` talks to this over
 * localhost via SYNC_API_URL — no second Railway service needed.
 */
async function startInternalApi() {
  await connectDatabase({
    uri: process.env.MONGO_URI,
    dbName: process.env.DB_NAME || 'placement_scraper',
  });
  logger.info('MongoDB (mongoose) connected for internal API');

  try {
    initFirebase();
    logger.info('Firebase Admin initialized for internal API');
  } catch (err) {
    logger.warn('Firebase init failed — push broadcasts disabled for this API', {
      reason: err.message,
    });
  }

  const app = createApp();
  apiServer = app.listen(API_PORT, () => {
    logger.info('Internal sync API listening', { port: API_PORT });
  });
}

function start() {
  cron.schedule(DAY_SCHEDULE, () => trigger('day'), { timezone: 'Asia/Kolkata' });
  cron.schedule(NIGHT_SCHEDULE, () => trigger('night'), { timezone: 'Asia/Kolkata' });
  cron.schedule(CLEANUP_SCHEDULE, () => purgeStaleUndatedJobs(), { timezone: 'Asia/Kolkata' });
  logger.info('Scheduler armed', {
    day: DAY_SCHEDULE,
    night: NIGHT_SCHEDULE,
    cleanup: CLEANUP_SCHEDULE,
    timezone: 'Asia/Kolkata',
  });
  if (config.runOnBoot || process.argv.includes('--once')) {
    trigger('boot');
  }
}

async function shutdown(signal) {
  logger.info('Shutting down scheduler', { signal });
  if (apiServer) apiServer.close();
  await disconnectDatabase().catch(() => {});
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// `--once` runs a single cycle and exits (useful for testing / manual triggers).
if (process.argv.includes('--once') && !config.runOnBoot) {
  startInternalApi()
    .then(() => runScrapeJob())
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  startInternalApi()
    .then(() => start())
    .catch((err) => {
      logger.error('Failed to start internal API — scraper will still run without sync', {
        reason: err.message,
      });
      start();
    });
}