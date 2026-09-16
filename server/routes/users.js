import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { many, one, tx } from '../db/index.js';
import { h, bad, str, num, bool } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { ROLES } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', requirePerm('users.read'), h(async (req, res) => {
  const rows = await many(
    `SELECT u.id,u.name,u.email,u.role,u.phone,u.is_active,u.max_discount_percent,
            u.last_login_at,u.created_at,
            COALESCE(json_agg(json_build_object('id',l.id,'name',l.name))
                     FILTER (WHERE l.id IS NOT NULL), '[]') AS locations
       FROM users u
       LEFT JOIN user_locations ul ON ul.user_id=u.id
       LEFT JOIN locations l ON l.id=ul.location_id
      GROUP BY u.id ORDER BY u.name`
  );
  res.json(rows);
}));

r.post('/', requirePerm('users.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  const email = str(req.body.email).trim().toLowerCase();
  const role = str(req.body.role);
  const password = str(req.body.password);
  if (!name || !email) throw bad('Name and email are required');
  if (!ROLES.includes(role)) throw bad(`Role must be one of: ${ROLES.join(', ')}`);
  if (password.length < 6) throw bad('Password must be at least 6 characters');
  if (await one('SELECT id FROM users WHERE lower(email)=$1', [email]))
    throw bad('That email is already registered');

  const user = await tx(async (c) => {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await c.query(
      `INSERT INTO users (name,email,password_hash,role,phone,max_discount_percent)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id,name,email,role,phone,is_active,max_discount_percent`,
      [name, email, hash, role, str(req.body.phone), num(req.body.max_discount_percent, 0)]
    );
    const u = rows[0];
    const locs = Array.isArray(req.body.location_ids) ? req.body.location_ids : [];
    const ids = role === 'admin'
      ? (await c.query('SELECT id FROM locations')).rows.map((x) => x.id)
      : locs;
    for (const lid of ids) {
      await c.query(
        'INSERT INTO user_locations (user_id,location_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [u.id, lid]
      );
    }
    return u;
  });
  await audit(req, 'create', 'user', user.id, { email, role });
  res.status(201).json(user);
}));

r.put('/:id', requirePerm('users.write'), h(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await one('SELECT * FROM users WHERE id=$1', [id]);
  if (!existing) throw bad('User not found');
  if (existing.role === 'admin' && bool(req.body.is_active) === false) {
    const { count } = await one(
      "SELECT COUNT(*)::int AS count FROM users WHERE role='admin' AND is_active AND id<>$1", [id]);
    if (!count) throw bad('You cannot deactivate the last active administrator');
  }
  const user = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE users SET name=COALESCE($2,name), role=COALESCE($3,role), phone=COALESCE($4,phone),
              max_discount_percent=COALESCE($5,max_discount_percent),
              is_active=COALESCE($6,is_active), updated_at=now()
        WHERE id=$1 RETURNING id,name,email,role,phone,is_active,max_discount_percent`,
      [id, req.body.name ?? null, req.body.role ?? null, req.body.phone ?? null,
       req.body.max_discount_percent ?? null,
       'is_active' in req.body ? bool(req.body.is_active) : null]
    );
    if (req.body.password) {
      if (String(req.body.password).length < 6) throw bad('Password must be at least 6 characters');
      await c.query('UPDATE users SET password_hash=$2 WHERE id=$1',
        [id, await bcrypt.hash(String(req.body.password), 10)]);
    }
    if (Array.isArray(req.body.location_ids)) {
      await c.query('DELETE FROM user_locations WHERE user_id=$1', [id]);
      for (const lid of req.body.location_ids) {
        await c.query('INSERT INTO user_locations (user_id,location_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, lid]);
      }
    }
    return rows[0];
  });
  await audit(req, 'update', 'user', id, { fields: Object.keys(req.body).filter((k) => k !== 'password') });
  res.json(user);
}));

export default r;
