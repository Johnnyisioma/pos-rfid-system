import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, many, query } from '../db/index.js';
import { signToken, requireAuth } from '../middleware/auth.js';
import { h, bad, HttpError } from '../lib/util.js';
import { audit } from '../lib/audit.js';
import { ROLE_PERMISSIONS } from '../lib/permissions.js';

const r = Router();

r.post('/login', h(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) throw bad('Email and password are required');

  const user = await one('SELECT * FROM users WHERE lower(email)=$1', [email]);
  if (!user || !user.is_active) throw new HttpError(401, 'Invalid email or password');
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new HttpError(401, 'Invalid email or password');

  await query('UPDATE users SET last_login_at=now() WHERE id=$1', [user.id]);
  const locations = await many(
    `SELECT l.* FROM locations l
      JOIN user_locations ul ON ul.location_id=l.id
     WHERE ul.user_id=$1 AND l.is_active ORDER BY l.name`,
    [user.id]
  );
  const allLocations =
    user.role === 'admin'
      ? await many('SELECT * FROM locations WHERE is_active ORDER BY name')
      : locations;

  await audit({ user, headers: req.headers, ip: req.ip }, 'login', 'user', user.id, { email });

  res.json({
    token: signToken(user),
    user: {
      id: user.id, name: user.name, email: user.email, role: user.role,
      max_discount_percent: Number(user.max_discount_percent),
      permissions: ROLE_PERMISSIONS[user.role],
    },
    locations: allLocations,
  });
}));

r.get('/me', requireAuth, h(async (req, res) => {
  const locations =
    req.user.role === 'admin'
      ? await many('SELECT * FROM locations WHERE is_active ORDER BY name')
      : await many(
          `SELECT l.* FROM locations l JOIN user_locations ul ON ul.location_id=l.id
            WHERE ul.user_id=$1 AND l.is_active ORDER BY l.name`,
          [req.user.id]
        );
  res.json({
    user: { ...req.user, permissions: ROLE_PERMISSIONS[req.user.role] },
    locations,
  });
}));

r.post('/change-password', requireAuth, h(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || String(new_password).length < 6)
    throw bad('New password must be at least 6 characters');
  const user = await one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  const ok = await bcrypt.compare(String(current_password || ''), user.password_hash);
  if (!ok) throw bad('Current password is incorrect');
  const hash = await bcrypt.hash(String(new_password), 10);
  await query('UPDATE users SET password_hash=$1, updated_at=now() WHERE id=$2', [hash, user.id]);
  await audit(req, 'change_password', 'user', user.id);
  res.json({ ok: true });
}));

export default r;
