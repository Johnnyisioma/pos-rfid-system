import jwt from 'jsonwebtoken';
import { many, one } from '../db/index.js';
import { can } from '../lib/permissions.js';

const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const EXPIRES = process.env.JWT_EXPIRES || '12h';

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, role: user.role, name: user.name, email: user.email },
    SECRET,
    { expiresIn: EXPIRES }
  );
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch {
    return null;
  }
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'Not authenticated' });

  const user = await one(
    'SELECT id, name, email, role, is_active, max_discount_percent FROM users WHERE id=$1',
    [payload.uid]
  );
  if (!user || !user.is_active) return res.status(401).json({ error: 'Account inactive' });

  const locs = await many('SELECT location_id FROM user_locations WHERE user_id=$1', [user.id]);
  user.location_ids = locs.map((l) => l.location_id);
  req.user = user;

  // Location the client is operating in (header set by the app shell).
  const requested = Number(req.headers['x-location-id'] || req.query.location_id || 0);
  if (requested) {
    if (user.role === 'admin' || user.location_ids.includes(requested)) {
      req.locationId = requested;
    } else {
      return res.status(403).json({ error: 'You are not assigned to that location' });
    }
  } else {
    req.locationId = user.location_ids[0] || null;
  }
  next();
}

export function requirePerm(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!can(req.user.role, permission)) {
      return res.status(403).json({ error: `Your role (${req.user.role}) cannot do this` });
    }
    next();
  };
}

/** Admins may read across all locations; everyone else is scoped. */
export function allowedLocationIds(user) {
  return user.role === 'admin' ? null : user.location_ids;
}
