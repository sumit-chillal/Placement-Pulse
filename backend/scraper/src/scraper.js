import { config } from './config.js';
import { logger } from './logger.js';
import { reportDomMutation } from './notifier.js';
import { persistJobs } from './db.js';
import {
  launchBrowser,
  createIncognitoContext,
  login,
  harvestRows,
  crawlDetail,
} from './browser.js';
import { enrichAndSync } from './enrich.js';

// Module-level resiliency state: tracks back-to-back failures so the
// monitoring hook only fires on a sustained outage (DOM mutation), not a blip.
let consecutiveFailures = 0;

/**
 * One full scrape cycle wrapped in a global try/catch/finally matrix.
 * The browser is guaranteed to close (finally) under all code paths.
 */
export async function runScrapeJob() {
  const startedAt = Date.now();
  let browser = null;
  logger.info('Scrape job started');

  try {
    browser = await launchBrowser();
    const context = await createIncognitoContext(browser);
    const page = await context.newPage();

    await login(page);
    const allRows = await harvestRows(page);
    // Optional throttle: MAX_ROWS=0 means crawl every row.
    const rows = config.maxRows > 0 ? allRows.slice(0, config.maxRows) : allRows;

    // Deep crawl each detail page within the same authenticated session.
    for (const row of rows) {
      row.detailPayload = await crawlDetail(context, row.detailUrl);
    }

    await persistJobs(rows);

    // Gemini-enrich fresh rows and push structured jobs to /api/sync (which
    // persists + broadcasts). Non-fatal: a failure here won't fail the scrape.
    if (config.enableEnrich) {
      try {
        await enrichAndSync(rows);
      } catch (err) {
        logger.warn('Enrich/sync step failed', { reason: err.message });
      }
    }

    consecutiveFailures = 0;
    logger.info('Scrape job succeeded', {
      jobs: rows.length,
      durationMs: Date.now() - startedAt,
    });
    return rows;
  } catch (error) {
    consecutiveFailures += 1;
    const structured = typeof error.toStructured === 'function'
      ? error.toStructured()
      : { name: error.name, message: error.message };
    logger.error('Scrape job failed', { ...structured, consecutiveFailures });

    if (consecutiveFailures >= config.maxConsecutiveFailures) {
      await reportDomMutation({ error, consecutiveFailures });
    }
    // Swallow so the cron scheduler keeps running; state is already recorded.
    return null;
  } finally {
    if (browser) {
      await browser.close().catch((e) =>
        logger.warn('Browser failed to close cleanly', { reason: e.message }),
      );
    }
    logger.info('Browser instance closed', { durationMs: Date.now() - startedAt });
  }
}
