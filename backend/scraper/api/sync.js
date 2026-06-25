import crypto from 'crypto';
import { Job } from './models/Job.js';
import { broadcastJob, isMessagingReady } from './firebase.js';
import { parseDate } from './dateParser.js';

const norm = (v) => String(v ?? '').trim().toLowerCase();

/** Deterministic dedup key: companyName + endDate (case/space-insensitive). */
export function generateHash(job) {
  return crypto
    .createHash('sha256')
    .update(`${norm(job.companyName)}|${norm(job.endDate)}`)
    .digest('hex');
}

/**
 * Diffing + pipeline engine.
 * For each incoming job: compute hash → skip if it already exists → otherwise
 * insert and immediately broadcast via FCM. The unique index is the final
 * guard against duplicate writes under concurrent load (11000 → treated as skip).
 */
export async function syncJobs(incomingJobs, { topic }) {
  const summary = { received: 0, inserted: 0, skipped: 0, notified: 0, errors: [] };
  if (!Array.isArray(incomingJobs)) {
    throw new Error('syncJobs expects an array of jobs.');
  }
  summary.received = incomingJobs.length;

  for (const item of incomingJobs) {
    const uniqueHash = generateHash(item);

    if (await Job.exists({ uniqueHash })) {
      summary.skipped += 1;
      continue;
    }

    let doc;
    try {
      doc = await Job.create({
        companyName: item.companyName,
        ctc: item.ctc,
        description: item.description,
        roles: item.roles,
        eligibilityCriteria: item.eligibilityCriteria,
        selectionWorkflow: item.selectionWorkflow,
        registrationLink: item.registrationLink ?? null,
        registrationLinks: Array.isArray(item.registrationLinks) ? item.registrationLinks : [],
        venue: item.venue,
        reportingTime: item.reportingTime,
        additionalDetails: item.additionalDetails,
        startDate: item.startDate,
        endDate: item.endDate,
        startDateISO: parseDate(item.startDate),
        endDateISO: parseDate(item.endDate),
        detailUrl: item.detailUrl ?? null,
        postedDate: item.postedDate ?? '-',
        uniqueHash,
      });
      summary.inserted += 1;
    } catch (err) {
      if (err.code === 11000) {
        summary.skipped += 1; // lost a race — another worker inserted it
        continue;
      }
      summary.errors.push({ stage: 'insert', message: err.message });
      continue;
    }

    // Broadcast only after a confirmed unique write.
    if (isMessagingReady()) {
      try {
        await broadcastJob(doc, topic);
        summary.notified += 1;
      } catch (err) {
        summary.errors.push({ stage: 'broadcast', hash: uniqueHash, message: err.message });
      }
    }
  }

  return summary;
}
