/**
 * Accounting — chart of accounts, the journal, and the three statements that
 * come straight out of the ledger (trial balance, balance sheet, P&L).
 *
 * The ledger service does the posting and the maths; this router is the door to
 * it: read the accounts, read the reports, and post a manual correcting entry.
 */
import { Router } from 'express';
import { many, one, query, tx } from '../db/index.js';
import { h, bad, notFound, str, num, int, bool } from '../lib/util.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { postEntry, trialBalance, balanceSheet, incomeStatement } from '../services/ledger.js';

const r = Router();

/* ═══════════════════ chart of accounts ═══════════════════ */
r.get('/accounts', requirePerm('accounts.balance_sheet'), h(async (req, res) => {
  const rows = await many(
    `SELECT a.*,
            COALESCE(SUM(jl.debit),0)  AS debit,
            COALESCE(SUM(jl.credit),0) AS credit
       FROM chart_of_accounts a
       LEFT JOIN journal_lines jl ON jl.account_id=a.id
      WHERE a.is_active OR $1
      GROUP BY a.id
      ORDER BY a.code`, [bool(req.query.all)]);
  const accounts = rows.map((a) => {
    const bal = Number(a.debit) - Number(a.credit);
    return { ...a, debit: Number(a.debit), credit: Number(a.credit),
      balance: a.normal_balance === 'debit' ? bal : -bal };
  });
  res.json(accounts);
}));

r.post('/accounts', requirePerm('accounts.journal'), h(async (req, res) => {
  const code = str(req.body.code).trim();
  const name = str(req.body.name).trim();
  const type = str(req.body.type);
  if (!code || !name) throw bad('Code and name are required.');
  if (!['asset', 'liability', 'equity', 'income', 'expense'].includes(type)) throw bad('Pick an account type.');
  const normal = ['asset', 'expense'].includes(type) ? 'debit' : 'credit';
  const row = await one(
    `INSERT INTO chart_of_accounts (code, name, type, normal_balance, parent_id, description)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [code, name, type, str(req.body.normal_balance) || normal,
     int(req.body.parent_id, null) || null, str(req.body.description)]).catch((e) => {
      if (/unique/i.test(e.message)) throw bad(`Account code "${code}" already exists.`);
      throw e;
    });
  await audit(req, 'create', 'account', row.id, { code });
  res.status(201).json(row);
}));

r.put('/accounts/:id(\\d+)', requirePerm('accounts.journal'), h(async (req, res) => {
  const row = await one(
    `UPDATE chart_of_accounts SET name=COALESCE($2,name), description=COALESCE($3,description),
            is_active=COALESCE($4,is_active), parent_id=$5
      WHERE id=$1 RETURNING *`,
    [req.params.id, str(req.body.name) || null, req.body.description ?? null,
     'is_active' in req.body ? bool(req.body.is_active) : null, int(req.body.parent_id, null) || null]);
  if (!row) throw notFound('Account not found');
  await audit(req, 'update', 'account', row.id, {});
  res.json(row);
}));

/* ═══════════════════ the journal ═══════════════════ */
r.get('/journal', requirePerm('accounts.balance_sheet'), h(async (req, res) => {
  const limit = Math.min(int(req.query.limit, 50), 200);
  const rows = await many(
    `SELECT je.*, u.name AS created_by_name,
            (SELECT COALESCE(SUM(debit),0) FROM journal_lines WHERE entry_id=je.id) AS total
       FROM journal_entries je LEFT JOIN users u ON u.id=je.created_by
      WHERE ($1='' OR je.source_type=$1)
        AND ($2::date IS NULL OR je.entry_date >= $2)
        AND ($3::date IS NULL OR je.entry_date <= $3)
      ORDER BY je.entry_date DESC, je.id DESC LIMIT ${limit}`,
    [str(req.query.source_type), req.query.from || null, req.query.to || null]);
  res.json(rows);
}));

r.get('/journal/:id(\\d+)', requirePerm('accounts.balance_sheet'), h(async (req, res) => {
  const je = await one(
    `SELECT je.*, u.name AS created_by_name FROM journal_entries je
       LEFT JOIN users u ON u.id=je.created_by WHERE je.id=$1`, [req.params.id]);
  if (!je) throw notFound('Entry not found');
  je.lines = await many(
    `SELECT jl.*, a.code, a.name AS account_name, a.type
       FROM journal_lines jl JOIN chart_of_accounts a ON a.id=jl.account_id
      WHERE jl.entry_id=$1 ORDER BY jl.id`, [req.params.id]);
  res.json(je);
}));

/** Post a manual entry — a correction, an opening balance, an accrual. */
r.post('/journal', requirePerm('accounts.journal'), h(async (req, res) => {
  const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
  const clean = lines
    .map((l) => ({ account: int(l.account_id), debit: num(l.debit, 0), credit: num(l.credit, 0), memo: str(l.memo) }))
    .filter((l) => l.account && (l.debit > 0 || l.credit > 0));
  if (clean.length < 2) throw bad('A journal entry needs at least two lines.');
  const entry = await tx((c) => postEntry(c, {
    memo: str(req.body.memo), source_type: 'manual', entry_date: req.body.entry_date || null,
    location_id: int(req.body.location_id, req.locationId), created_by: req.user.id, lines: clean,
  })).catch((e) => { throw bad(e.message); });
  await audit(req, 'post', 'journal_entry', entry?.id, { ref: entry?.ref });
  res.status(201).json(entry);
}));

/* ═══════════════════ account mappings ═══════════════════ */
r.get('/mappings', requirePerm('accounts.journal'), h(async (req, res) => {
  res.json(await many(
    `SELECT m.mapping_key, m.account_id, a.code, a.name
       FROM account_mappings m LEFT JOIN chart_of_accounts a ON a.id=m.account_id
      ORDER BY m.mapping_key`));
}));

r.put('/mappings/:key', requirePerm('accounts.journal'), h(async (req, res) => {
  const row = await one(
    `INSERT INTO account_mappings (mapping_key, account_id) VALUES ($1,$2)
     ON CONFLICT (mapping_key) DO UPDATE SET account_id=EXCLUDED.account_id RETURNING *`,
    [req.params.key, int(req.body.account_id, null) || null]);
  res.json(row);
}));

/* ═══════════════════ statements ═══════════════════ */
r.get('/trial-balance', requirePerm('accounts.balance_sheet'), h(async (req, res) => {
  res.json(await trialBalance({ upto: req.query.upto || null }));
}));

r.get('/balance-sheet', requirePerm('accounts.balance_sheet'), h(async (req, res) => {
  res.json(await balanceSheet({ upto: req.query.upto || null }));
}));

r.get('/income-statement', requirePerm('reports.read'), h(async (req, res) => {
  res.json(await incomeStatement({ from: req.query.from || null, to: req.query.to || null }));
}));

export default r;
