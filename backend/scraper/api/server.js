import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './database.js';
import { initFirebase } from './firebase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

const PORT = parseInt(process.env.API_PORT, 10) || 5050;

/**
 * Bootstrap tier — explicitly orders startup and handles initialization
 * failures. DB connection is fatal; Firebase failure degrades gracefully
 * (REST stays up, broadcasts are skipped).
 */
async function bootstrap() {
  try {
    await connectDatabase({
      uri: process.env.MONGO_URI,
      dbName: process.env.DB_NAME || 'placement_scraper',
    });
    console.log(JSON.stringify({ level: 'info', message: 'MongoDB connected' }));
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: 'DB init failed', detail: err.message }));
    process.exit(1);
  }

  try {
    initFirebase();
    console.log(JSON.stringify({ level: 'info', message: 'Firebase Admin initialized' }));
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        message: 'Firebase init failed — push notifications disabled',
        detail: err.message,
      }),
    );
  }

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(JSON.stringify({ level: 'info', message: `API listening on :${PORT}` }));
  });

  const shutdown = async (signal) => {
    console.log(JSON.stringify({ level: 'info', message: 'Shutting down', signal }));
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap();
