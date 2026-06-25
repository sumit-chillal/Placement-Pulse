import mongoose from 'mongoose';

/**
 * Database connection tier — intentionally isolated from the Express app
 * instance. Throws on failure so the bootstrap layer can decide how to react
 * (the app instance never owns connection lifecycle).
 */
export async function connectDatabase({ uri, dbName }) {
  if (!uri) throw new Error('MONGO_URI is not configured.');

  mongoose.connection.on('error', (err) => {
    console.error(JSON.stringify({ level: 'error', scope: 'mongoose', message: err.message }));
  });
  mongoose.connection.on('disconnected', () => {
    console.warn(JSON.stringify({ level: 'warn', scope: 'mongoose', message: 'disconnected' }));
  });

  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 15000,
  });
  // Ensure declared indexes (unique hash + compound) exist before serving load.
  await mongoose.connection.asPromise();
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
