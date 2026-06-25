import { parsePlacementText } from './geminiParser.js';
import { config } from './config.js';
import { logger } from './logger.js';

/** Pull detailUrls already stored so we never re-parse (saves Gemini quota). */
async function fetchKnownUrls() {
  try {
    const res = await fetch(`${config.syncApiUrl}/api/jobs/known`);
    if (!res.ok) return new Set();
    const data = await res.json();
    return new Set(data.detailUrls || []);
  } catch (err) {
    logger.warn('Could not fetch known URLs — enriching all rows', { reason: err.message });
    return new Set();
  }
}

/**
 * For each freshly-scraped row: run the deep-crawled text through Gemini to
 * get structured metadata, then POST the batch to the Express /api/sync
 * endpoint (which dedups, persists with normalized dates, and broadcasts FCM).
 */
export async function enrichAndSync(rows) {
  if (!rows.length) return { parsed: 0, inserted: 0, notified: 0 };

  const known = await fetchKnownUrls();
  const fresh = rows.filter((r) => r.detailPayload && !known.has(r.detailUrl));
  logger.info('Enrichment candidates', { total: rows.length, fresh: fresh.length });

  const structured = [];
  for (const row of fresh) {
    try {
      const parsed = await parsePlacementText(row.detailPayload);
      structured.push({ ...parsed, detailUrl: row.detailUrl, postedDate: row.postedDate });
    } catch (err) {
      logger.warn('Gemini parse failed', { detailUrl: row.detailUrl, reason: err.message });
    }
  }
  if (!structured.length) return { parsed: 0, inserted: 0, notified: 0 };

  try {
    const res = await fetch(`${config.syncApiUrl}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobs: structured }),
    });
    const summary = await res.json().catch(() => ({}));
    logger.info('Posted structured jobs to /api/sync', summary);
    return { parsed: structured.length, inserted: summary.inserted ?? 0, notified: summary.notified ?? 0 };
  } catch (err) {
    logger.error('Failed to POST to /api/sync', { reason: err.message });
    return { parsed: structured.length, inserted: 0, notified: 0 };
  }
}
