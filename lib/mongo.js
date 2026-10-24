import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'paytrust';

// Reuse one client across Next.js hot reloads in development.
const globalForMongo = globalThis;

function getClientPromise() {
  if (!uri) throw new Error('Missing environment variable MONGODB_URI. Copy .env.example to .env.');
  if (!globalForMongo.__paytrustMongoClient) {
    globalForMongo.__paytrustMongoClient = new MongoClient(uri, { maxPoolSize: 10 }).connect();
  }
  return globalForMongo.__paytrustMongoClient;
}

export async function getDb() {
  const client = await getClientPromise();
  return client.db(dbName);
}

export const collections = {
  disputes: 'dispute_cases',
  kyc: 'kyc_documents',
  activity: 'activity_logs',
};
