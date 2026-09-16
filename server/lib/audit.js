import { query } from '../db/index.js';

/**
 * Record who did what, when. Never throws into the request path.
 * Pass `client` to make the log part of the caller's transaction.
 */
export async function audit(reqOrUser, action, entityType, entityId, details = {}, client = null) {
  try {
    const user = reqOrUser?.user || reqOrUser || {};
    const ip =
      reqOrUser?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
      reqOrUser?.ip ||
      null;
    const runner = client || { query };
    await runner.query(
      `INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, location_id, details, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        user.id || null,
        user.name || null,
        action,
        entityType,
        entityId == null ? null : String(entityId),
        reqOrUser?.locationId || null,
        JSON.stringify(details || {}),
        ip,
      ]
    );
  } catch (err) {
    console.error('[audit] failed:', err.message);
  }
}
