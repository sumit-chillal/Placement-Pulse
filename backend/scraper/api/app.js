import express from 'express';
import { Job } from './models/Job.js';
import { syncJobs } from './sync.js';

const TOPIC = process.env.FCM_TOPIC || 'placement_alerts';

/**
 * Express app instance layer — owns routing only. It assumes the database
 * connection has already been established by the bootstrap tier.
 */
export function createApp() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // GET /api/jobs — active listings, newest-posted first, expired drives
  // hidden by default. Paginated.
  app.get('/api/jobs', async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const skip = (page - 1) * limit;
      const includeExpired = req.query.includeExpired === 'true';

      const filter = {};
      if (!includeExpired) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        // Keep drives ending today-or-later, plus those with unknown dates (null).
        filter.$or = [{ endDateISO: { $gte: startOfToday } }, { endDateISO: null }];
      }

      const [items, total] = await Promise.all([
        Job.find(filter)
          .sort({ createdAt: -1 }) // newest posting first (was endDateISO — sorted by soonest-deadline, not newness)
          .skip(skip)
          .limit(limit)
          .lean(),
        Job.countDocuments(filter),
      ]);

      res.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        count: items.length,
        data: items,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/jobs/known — detailUrls already stored (lets the scraper skip
  // re-parsing pages it has already seen, preserving Gemini quota).
  app.get('/api/jobs/known', async (_req, res, next) => {
    try {
      const urls = await Job.distinct('detailUrl', { detailUrl: { $ne: null } });
      res.json({ count: urls.length, detailUrls: urls });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/sync — receives scraped jobs, runs the diff + broadcast pipeline.
  app.post('/api/sync', async (req, res, next) => {
    try {
      const jobs = Array.isArray(req.body) ? req.body : req.body?.jobs;
      if (!Array.isArray(jobs)) {
        return res.status(400).json({ error: 'Expected an array of jobs (or { jobs: [...] }).' });
      }
      const summary = await syncJobs(jobs, { topic: TOPIC });
      res.json(summary);
    } catch (err) {
      next(err);
    }
  });

  // Centralized error handler.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ level: 'error', scope: 'express', message: err.message }));
    res.status(500).json({ error: 'Internal Server Error', detail: err.message });
  });

  return app;
}