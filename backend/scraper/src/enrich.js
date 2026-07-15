import { parsePlacementTextsChunked } from './geminiParser.js';
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
 * For each freshly-scraped row: batch-parse through Gemini (several rows per
 * API call — see GEMINI_BATCH_SIZE), then POST the batch to /api/sync (which
 * dedups, persists with normalized dates, and broadcasts FCM).
 */
export async function enrichAndSync(rows) {
  if (!rows.length) return { parsed: 0, inserted: 0, notified: 0 };

  const known = await fetchKnownUrls();
  const fresh = rows.filter((r) => r.detailPayload && !known.has(r.detailUrl));
  logger.info('Enrichment candidates', { total: rows.length, fresh: fresh.length });
  if (!fresh.length) return { parsed: 0, inserted: 0, notified: 0 };

  let parsedResults;
  try {
    parsedResults = await parsePlacementTextsChunked(fresh.map((r) => r.detailPayload));
  } catch (err) {
    logger.error('Batch Gemini parse failed entirely', { reason: err.message });
    return { parsed: 0, inserted: 0, notified: 0 };
  }

  const structured = [];
  fresh.forEach((row, i) => {
    const parsed = parsedResults[i];
    if (!parsed) {
      logger.warn('Gemini returned no result for row', { detailUrl: row.detailUrl });
      return;
    }
    structured.push({ ...parsed, detailUrl: row.detailUrl, postedDate: row.postedDate });
  });

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