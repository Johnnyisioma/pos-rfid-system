import { Router } from 'express';
import { many, one, query } from '../db/index.js';
import { h, bad, str, bool } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const r = Router();

r.get('/', h(async (req, res) => {
  const all = req.user.role === 'admin';
  const rows = all
    ? await many('SELECT * FROM locations ORDER BY name')
    : await many(
        `SELECT l.* FROM locations l JOIN user_locations ul ON ul.location_id=l.id
          WHERE ul.user_id=$1 ORDER BY l.name`,
        [req.user.id]
      );
  res.json(rows);
}));

r.post('/', requirePerm('settings.write'), h(async (req, res) => {
  const name = str(req.body.name).trim();
  const code = str(req.body.code).trim().toUpperCase();
  if (!name || !code) throw bad('Name and code are required');
  const exists = await one('SELECT id FROM locations WHERE code=$1', [code]);
  if (exists) throw bad(`Location code "${code}" is already in use`);
  const row = await one(
    `INSERT INTO locations (name, code, address, phone, is_active)
     VALUES ($1,$2,$3,$4,TRUE) RETURNING *`,
    [name, code, str(req.body.address), str(req.body.phone)]
  );
  // Admins can work in every location; give existing admins access implicitly.
  await query(
    `INSERT INTO user_locations (user_id, location_id)
     SELECT id, $1 FROM users WHERE role='admin' ON CONFLICT DO NOTHING`,
    [row.id]
  );
  await audit(req, 'create', 'location', row.id, { name, code });
  res.status(201).json(row);
}));

r.put('/:id', requirePerm('settings.write'), h(async (req, res) => {
  const row = await one(
    `UPDATE locations SET name=COALESCE($2,name), address=COALESCE($3,address),
            phone=COALESCE($4,phone), is_active=COALESCE($5,is_active)
      WHERE id=$1 RETURNING *`,
    [req.params.id, req.body.name ?? null, req.body.address ?? null,
     req.body.phone ?? null, 'is_active' in req.body ? bool(req.body.is_active) : null]
  );
  if (!row) throw bad('Location not found');
  await audit(req, 'update', 'location', row.id, req.body);
  res.json(row);
}));

export default r;
