import { MongoClient } from 'mongodb';
import { config } from './config.js';
import { logger } from './logger.js';

let client = null;

async function getCollection() {
  if (!client) {
    client = new MongoClient(config.mongo.uri, {
      serverSelectionTimeoutMS: 15000,
    });
    await client.connect();
    logger.info('Connected to MongoDB Atlas', { db: config.mongo.dbName });
  }
  return client.db(config.mongo.dbName).collection(config.mongo.collectionName);
}

/**
 * Upsert harvested jobs, keyed by their detail URL so re-runs update
 * existing records (deep-crawl payload, scrapedAt) instead of duplicating.
 */
export async function persistJobs(jobs) {
  if (!jobs.length) return { upserted: 0 };

  const collection = await getCollection();
  await collection.createIndex({ detailUrl: 1 }, { unique: true });

  const now = new Date();
  const ops = jobs.map((job) => ({
    updateOne: {
      filter: { detailUrl: job.detailUrl },
      update: {
        $set: { ...job, scrapedAt: now },
        $setOnInsert: { firstSeenAt: now },
      },
      upsert: true,
    },
  }));

  const result = await collection.bulkWrite(ops, { ordered: false });
  const count = result.upsertedCount + result.modifiedCount;
  logger.info('Persisted jobs to MongoDB', {
    upserted: result.upsertedCount,
    modified: result.modifiedCount,
  });
  return { upserted: count };
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
  }
}
