// Prints the dispute analytics aggregation result.   npm run db:analytics
// The same pipeline (lib/disputeAnalytics.js) feeds the admin dashboard.
import { MongoClient } from 'mongodb';
import { getDisputeAnalytics } from '../lib/disputeAnalytics.js';

const client = new MongoClient(process.env.MONGODB_URI);
try {
  await client.connect();
  const result = await getDisputeAnalytics(client.db(process.env.MONGODB_DB || 'paytrust'));
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error('Analytics failed:', err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
