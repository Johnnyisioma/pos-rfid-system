import { Router } from 'express';
import { many, one } from '../db/index.js';
import { h, str, int, paging } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';

const r = Router();

r.get('/', requirePerm('audit.read'), h(async (req, res) => {
  const { limit, offset, page } = paging(req, 50, 500);
  const params = [];
  const where = ['TRUE'];
  const add = (sql, v) => { params.push(v); where.push(sql.replace(/\?/g, `$${params.length}`)); };
  if (req.query.user_id) add('a.user_id = ?', int(req.query.user_id));
  if (req.query.entity_type) add('a.entity_type = ?', str(req.query.entity_type));
  if (req.query.action) add('a.action = ?', str(req.query.action));
  if (req.query.from) add('a.created_at >= ?::timestamptz', req.query.from);
  if (req.query.to) add("a.created_at < (?::date + interval '1 day')", req.query.to);
  if (req.query.q) add('(a.user_name ILIKE ? OR a.entity_type ILIKE ? OR a.action ILIKE ? OR a.details::text ILIKE ?)',
    `%${req.query.q}%`);

  const rows = await many(
    `SELECT a.*, l.name AS location_name FROM audit_logs a
       LEFT JOIN locations l ON l.id=a.location_id
      WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ${limit} OFFSET ${offset}`, params);
  const total = await one(`SELECT COUNT(*)::int AS n FROM audit_logs a WHERE ${where.join(' AND ')}`, params);
  res.json({ data: rows, page, limit, total: total.n });
}));

r.get('/facets', requirePerm('audit.read'), h(async (req, res) => {
  const [actions, entities, users] = await Promise.all([
    many('SELECT DISTINCT action FROM audit_logs ORDER BY action'),
    many('SELECT DISTINCT entity_type FROM audit_logs ORDER BY entity_type'),
    many('SELECT DISTINCT user_id, user_name FROM audit_logs WHERE user_id IS NOT NULL ORDER BY user_name'),
  ]);
  res.json({ actions: actions.map((a) => a.action), entities: entities.map((e) => e.entity_type), users });
}));

export default r;
