/**
 * Custom roles.
 *
 * The four built-in roles (admin, manager, cashier, inventory) are the floor.
 * This lets a shop build its own on top — "Senior cashier", "Floor supervisor"
 * — each a named, saved permission set, so hiring is one dropdown rather than
 * forty checkboxes per person. Per-user exceptions still layer on top.
 *
 * Built-ins are not editable or deletable here: they are the safety net every
 * install can rely on, and a shop that mangles "admin" locks itself out.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, int } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import {
  ROLES, ROLE_PERMISSIONS, ROLE_LABELS, PERMISSION_CATALOG, ALL_PERMISSIONS,
} from '../lib/permissions.js';

const r = Router();

/** Both the built-in presets and the shop's own roles, in one list. */
r.get('/', requirePerm('users.read'), h(async (req, res) => {
  const custom = await many(
    `SELECT cr.*, u.name AS created_by_name,
            (SELECT COUNT(*)::int FROM users WHERE custom_role_id = cr.id) AS users
       FROM custom_roles cr LEFT JOIN users u ON u.id=cr.created_by
      ORDER BY cr.name`);
  const builtin = ROLES.map((role) => ({
    id: `builtin:${role}`, key: role, name: ROLE_LABELS[role] || role,
    permissions: ROLE_PERMISSIONS[role], is_system: true, builtin: true,
    users: null,
  }));
  res.json({ builtin, custom, catalog: PERMISSION_CATALOG });
}));

r.post('/', requirePerm('roles.write'), h(async (req, res) => {
  const name = str(req.body.name);
  if (!name) throw bad('Give the role a name.');
  const permissions = cleanPermissions(req.body.permissions);
  const row = await one(
    `INSERT INTO custom_roles (name, description, permissions, business_type, created_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, str(req.body.description), JSON.stringify(permissions),
     str(req.body.business_type) || null, req.user.id]);
  await audit(req, 'create', 'role', row.id, { name, permissions: permissions.length });
  res.status(201).json(row);
}));

r.put('/:id(\\d+)', requirePerm('roles.write'), h(async (req, res) => {
  const existing = await one('SELECT * FROM custom_roles WHERE id=$1', [req.params.id]);
  if (!existing) throw notFound('Role not found');
  const permissions = req.body.permissions ? cleanPermissions(req.body.permissions) : existing.permissions;
  const row = await one(
    `UPDATE custom_roles SET name=COALESCE($2,name), description=COALESCE($3,description),
            permissions=$4, updated_at=now() WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null, req.body.description ?? null,
     JSON.stringify(permissions)]);
  await audit(req, 'update', 'role', row.id, { permissions: permissions.length });
  res.json(row);
}));

r.delete('/:id(\\d+)', requirePerm('roles.write'), h(async (req, res) => {
  const inUse = await one(
    'SELECT COUNT(*)::int AS n FROM users WHERE custom_role_id=$1', [req.params.id]);
  if (inUse.n > 0) throw bad(`${inUse.n} staff member(s) still hold this role. Reassign them first.`);
  const row = await one('DELETE FROM custom_roles WHERE id=$1 RETURNING name', [req.params.id]);
  if (!row) throw notFound('Role not found');
  await audit(req, 'delete', 'role', req.params.id, { name: row.name });
  res.json({ ok: true });
}));

/** Keep only permissions this system actually has — a typo is a dead switch. */
function cleanPermissions(list) {
  if (!Array.isArray(list)) return [];
  const valid = new Set(ALL_PERMISSIONS);
  return [...new Set(list.filter((p) => {
    if (typeof p !== 'string') return false;
    if (valid.has(p)) return true;
    if (p.endsWith('.*')) return ALL_PERMISSIONS.some((k) => k.startsWith(p.slice(0, -1)));
    return false;
  }))];
}

export default r;
