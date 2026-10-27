// Writes to the MongoDB activity_logs collection. Logging must never break a
// request, so failures are printed and swallowed.
import { getDb, collections } from './mongo';

export function clientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';
}

export async function logActivity({ userId = null, action, entityType = null, entityId = null, ip, metadata }) {
  try {
    const db = await getDb();
    await db.collection(collections.activity).insertOne({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      ...(ip ? { ip } : {}),
      ...(metadata ? { metadata } : {}),
      created_at: new Date(),
    });
  } catch (err) {
    console.error(`activity log failed (${action}):`, err.message);
  }
}
