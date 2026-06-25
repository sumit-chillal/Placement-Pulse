import cron from 'node-cron';
import { runScrapeJob } from './src/scraper.js';
import { closeDb } from './src/db.js';
import { config } from './src/config.js';
import { logger } from './src/logger.js';

// Daytime: every 30 minutes from 08:00 to 19:30 (high cadence).
const DAY_SCHEDULE = '*/30 8-19 * * *';
// Nighttime: every 2 hours across 20:00 → 06:00 (reduced load on the portal).
const NIGHT_SCHEDULE = '0 20,22,0,2,4,6 * * *';

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

function start() {
  cron.schedule(DAY_SCHEDULE, () => trigger('day'));
  cron.schedule(NIGHT_SCHEDULE, () => trigger('night'));
  logger.info('Scheduler armed', {
    day: DAY_SCHEDULE,
    night: NIGHT_SCHEDULE,
    timezone: process.env.TZ || 'system-local',
  });

  if (config.runOnBoot || process.argv.includes('--once')) {
    trigger('boot');
  }
}

async function shutdown(signal) {
  logger.info('Shutting down scheduler', { signal });
  await closeDb();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// `--once` runs a single cycle and exits (useful for testing / manual triggers).
if (process.argv.includes('--once') && !config.runOnBoot) {
  runScrapeJob()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
} else {
  start();
}
