/**
 * Decides which payment account a tender lands in.
 *
 * Order: whatever the caller explicitly chose, then the mapping configured for
 * that tender type (cash → till, transfer → the bank account, and so on).
 *
 * The default account is only used as a last resort for CASH. That looks like
 * an omission but it is the point: the seeded default is the cash till, and
 * quietly sweeping a bank transfer or a card settlement into the till would
 * produce a drawer figure nobody can reconcile and hide the fact that the bank
 * account was never set up. Leaving it null instead is visible — the Money in
 * and out report shows it as "Unassigned" and points at the mapping screen.
 */
export async function resolveAccountId(client, method, explicit = null) {
  if (explicit) return Number(explicit);

  const { rows: mapped } = await client.query(
    'SELECT account_id FROM payment_method_accounts WHERE method = $1', [method]);
  if (mapped[0]?.account_id) return mapped[0].account_id;

  if (method !== 'cash') return null;

  const { rows: fallback } = await client.query(
    `SELECT id FROM payment_accounts
      WHERE is_default AND is_active AND type = 'cash' ORDER BY id LIMIT 1`);
  return fallback[0]?.id || null;
}
