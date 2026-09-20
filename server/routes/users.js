import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { many, one, tx } from '../db/index.js';
import { h, bad, str, num, bool } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import {
  ROLES, ROLE_PERMISSIONS, ROLE_LABELS, PERMISSION_CATALOG, ALL_PERMISSIONS,
  effectivePermissions,
} from '../lib/permissions.js';
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

/**
 * The permission matrix, as the server actually enforces it.
 *
 * Roles are defined in code rather than in a table on purpose: a permission
 * set that can be edited at runtime is a permission set that can be widened
 * by anyone who gets into the admin screen. This endpoint publishes what the
 * server will allow so the UI can show it honestly instead of guessing.
 */
r.get('/roles', requirePerm('users.read'), h(async (req, res) => {
  const counts = await many(
    'SELECT role, COUNT(*)::int AS n, COUNT(*) FILTER (WHERE is_active)::int AS active FROM users GROUP BY role');
  const byRole = Object.fromEntries(counts.map((c) => [c.role, c]));

  // Every area the permission strings mention, in the order the menu shows them.
  const areas = [...new Set(
    Object.values(ROLE_PERMISSIONS).flat()
      .filter((p) => p !== '*')
      .map((p) => p.split('.')[0]))].sort();

  res.json({
    roles: ROLES.map((role) => {
      const granted = ROLE_PERMISSIONS[role];
      return {
        role,
        label: ROLE_LABELS[role] || role,
        permissions: granted,
        is_superuser: granted.includes('*'),
        users: byRole[role]?.n || 0,
        active_users: byRole[role]?.active || 0,
        areas: Object.fromEntries(areas.map((a) => {
          if (granted.includes('*')) return [a, 'full'];
          if (granted.includes(`${a}.*`)) return [a, 'full'];
          const own = granted.filter((p) => p.startsWith(`${a}.`)).map((p) => p.split('.')[1]);
          return [a, own.length ? own.join(', ') : 'none'];
        })),
      };
    }),
    areas,
  });
}));

/**
 * The permission catalogue, so the settings screen can render every switch
 * without hard-coding a list that drifts out of step with the server's.
 */
r.get('/permissions', requirePerm('users.read'), h(async (req, res) => {
  res.json({ catalog: PERMISSION_CATALOG, roles: ROLE_PERMISSIONS, labels: ROLE_LABELS });
}));

/** What one person can actually do, preset and exceptions shown separately. */
r.get('/:id(\\d+)/permissions', requirePerm('users.read'), h(async (req, res) => {
  const id = Number(req.params.id);
  const user = await one('SELECT id, name, role FROM users WHERE id=$1', [id]);
  if (!user) throw bad('User not found');
  const overrides = await many(
    `SELECT up.permission, up.effect, up.created_at, u.name AS granted_by_name
       FROM user_permissions up LEFT JOIN users u ON u.id=up.granted_by
      WHERE up.user_id=$1 ORDER BY up.permission`, [id]);
  res.json({
    user,
    preset: ROLE_PERMISSIONS[user.role] || [],
    overrides,
    effective: effectivePermissions(user.role, overrides),
    catalog: PERMISSION_CATALOG,
  });
}));

/**
 * Replace a user's exceptions.
 *
 * Sent as a whole set rather than one at a time, because a permission screen
 * is edited as a form and a partial save is how somebody ends up with half the
 * rights they were meant to have.
 */
r.put('/:id(\\d+)/permissions', requirePerm('users.write'), h(async (req, res) => {
  const id = Number(req.params.id);
  const user = await one('SELECT id, name, role FROM users WHERE id=$1', [id]);
  if (!user) throw bad('User not found');

  const incoming = Array.isArray(req.body.overrides) ? req.body.overrides : [];
  const clean = [];
  for (const o of incoming) {
    const permission = str(o.permission);
    if (!permission) continue;
    // Only permissions that actually exist, plus area wildcards. Storing a
    // typo means a switch that appears to be set and does nothing.
    const valid = ALL_PERMISSIONS.includes(permission)
      || (permission.endsWith('.*') && ALL_PERMISSIONS.some(
        (k) => k.startsWith(permission.slice(0, -1))));
    if (!valid) throw bad(`"${permission}" is not a permission this system has.`);
    clean.push({ permission, effect: o.effect === 'deny' ? 'deny' : 'grant' });
  }

  // Do not let somebody lock the last administrator out of user management —
  // there would then be no way back in without database access.
  if (user.role === 'admin' && clean.some((o) => o.effect === 'deny' && o.permission.startsWith('users.'))) {
    const { count } = await one(
      `SELECT COUNT(*)::int AS count FROM users u
        WHERE u.role='admin' AND u.is_active AND u.id <> $1
          AND NOT EXISTS (SELECT 1 FROM user_permissions p
                           WHERE p.user_id=u.id AND p.effect='deny' AND p.permission LIKE 'users.%')`,
      [id]);
    if (!count) throw bad('That would leave nobody able to manage staff. Grant it to another administrator first.');
  }

  await tx(async (c) => {
    await c.query('DELETE FROM user_permissions WHERE user_id=$1', [id]);
    for (const o of clean) {
      await c.query(
        `INSERT INTO user_permissions (user_id, permission, effect, granted_by)
         VALUES ($1,$2,$3,$4)`, [id, o.permission, o.effect, req.user.id]);
    }
  });

  await audit(req, 'update_permissions', 'user', id, {
    grants: clean.filter((o) => o.effect === 'grant').map((o) => o.permission),
    denies: clean.filter((o) => o.effect === 'deny').map((o) => o.permission),
  });

  res.json({
    ok: true,
    overrides: clean,
    effective: effectivePermissions(user.role, clean),
  });
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
