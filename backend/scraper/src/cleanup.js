import { config } from './config.js';
import { logger } from './logger.js';

// Entries whose end date could never be parsed (endDateISO stays null)
// are usually a dateParser edge case or a malformed source posting. Purge
// them after this many days so they don't linger indefinitely.
const STALE_DAYS = parseInt(process.env.STALE_NO_DATE_DAYS || '30', 10);

/**
 * Deletes jobs with no resolvable endDateISO that are older than STALE_DAYS.
 * Runs against the same shared MongoDB the Python API reads from — safe to
 * run from this service regardless of which backend serves requests.
 */
export async function purgeStaleUndatedJobs() {
  try {
    const res = await fetch(`${config.syncApiUrl}/api/jobs/purge-undated`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ olderThanDays: STALE_DAYS }),
    });
    const summary = await res.json().catch(() => ({}));
    logger.info('Purged stale undated jobs', summary);
    return summary;
  } catch (err) {
    logger.error('Failed to purge stale undated jobs', { reason: err.message });
    return { deleted: 0, error: err.message };
  }
}