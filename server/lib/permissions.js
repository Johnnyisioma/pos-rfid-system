/**
 * Permissions.
 *
 * Two layers, because a shop is not an org chart:
 *
 *   ROLE PRESETS    what a cashier, a manager, an inventory clerk can do by
 *                   default. Covers the first day of anyone's employment.
 *   PER-USER RULES  the exceptions, which is where real shops live. The senior
 *                   cashier may void a sale; the junior may not; neither of
 *                   them is a manager. Without this, the only way to let one
 *                   person do one extra thing is to make them a manager, and
 *                   that is how everybody ends up a manager.
 *
 * A deny always beats a grant. If someone has been explicitly barred from
 * discounting, inheriting it back through a role change would be a surprise,
 * and surprises in a permission system are how money goes missing.
 */

export const ROLES = ['admin', 'manager', 'cashier', 'inventory'];

/**
 * Everything that can be permitted, grouped for the settings screen.
 * `sensitive` marks the ones worth a second look before granting.
 */
export const PERMISSION_CATALOG = [
  { group: 'Till', items: [
    { key: 'sales.create',   label: 'Ring up a sale' },
    { key: 'sales.read',     label: 'See past sales' },
    { key: 'sales.hold',     label: 'Park and resume a sale' },
    { key: 'sales.discount', label: 'Discount a line or a sale', sensitive: true },
    { key: 'sales.edit',     label: 'Amend an issued receipt', sensitive: true },
    { key: 'sales.void',     label: 'Void a completed sale', sensitive: true },
    { key: 'returns.create', label: 'Take a return' },
    { key: 'returns.read',   label: 'See returns' },
  ] },
  { group: 'Cash drawer', items: [
    { key: 'register.open',  label: 'Open a shift' },
    { key: 'register.close', label: 'Count and close a shift' },
    { key: 'register.audit', label: 'See expected cash before it is counted', sensitive: true },
  ] },
  { group: 'Stock', items: [
    { key: 'products.read',   label: 'See products' },
    { key: 'products.write',  label: 'Add and edit products' },
    { key: 'products.delete', label: 'Delete products', sensitive: true },
    { key: 'inventory.read',  label: 'See stock levels' },
    { key: 'inventory.write', label: 'Receive stock and adjust counts', sensitive: true },
    { key: 'transfers.write', label: 'Send and receive branch transfers' },
    { key: 'purchases.write', label: 'Raise purchase orders' },
    { key: 'quarantine.write', label: 'Quarantine and write off stock', sensitive: true },
  ] },
  { group: 'RFID', items: [
    { key: 'rfid.scan',       label: 'Scan tags' },
    { key: 'rfid.find',       label: 'Find an item by tag' },
    { key: 'rfid.encode',     label: 'Pair tags to stock' },
    { key: 'rfid.stocktake',  label: 'Run a stock take' },
  ] },
  { group: 'People and money', items: [
    { key: 'customers.read',  label: 'See customers' },
    { key: 'customers.write', label: 'Add and edit customers' },
    { key: 'customers.credit', label: 'Give credit and set limits', sensitive: true },
    { key: 'expenses.write',  label: 'Record expenses' },
    { key: 'accounts.write',  label: 'Manage bank and till accounts', sensitive: true },
    { key: 'commissions.read', label: 'See commission owed' },
    { key: 'commissions.write', label: 'Set commission rules and pay out', sensitive: true },
  ] },
  { group: 'Reporting and setup', items: [
    { key: 'reports.read',    label: 'See reports' },
    { key: 'reports.profit',  label: 'See cost and profit figures', sensitive: true },
    { key: 'settings.read',   label: 'See settings' },
    { key: 'settings.write',  label: 'Change settings', sensitive: true },
    { key: 'users.read',      label: 'See staff' },
    { key: 'users.write',     label: 'Add staff and set permissions', sensitive: true },
    { key: 'audit.read',      label: 'Read the audit log', sensitive: true },
    { key: 'devices.write',   label: 'Manage printers and readers' },
    { key: 'locations.read',  label: 'See branches' },
  ] },
];

export const ALL_PERMISSIONS = PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key));

export const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'products.*', 'inventory.*', 'rfid.*', 'sales.*', 'returns.*', 'customers.*',
    'suppliers.*', 'purchases.*', 'transfers.*', 'register.*', 'expenses.*',
    'reports.*', 'quarantine.*', 'commissions.*', 'accounts.write',
    'settings.read', 'settings.write', 'users.read', 'users.write',
    'audit.read', 'locations.read', 'devices.*',
  ],
  cashier: [
    'products.read', 'inventory.read', 'rfid.scan', 'rfid.find',
    'sales.create', 'sales.read', 'sales.hold', 'returns.create', 'returns.read',
    'customers.read', 'customers.write',
    // Deliberately NOT register.* — register.audit is what the blind cash-out
    // exists to withhold, and a cashier holding it can see the figure they are
    // supposed to be counting against.
    'register.open', 'register.close',
    'reports.read', 'locations.read', 'settings.read',
  ],
  inventory: [
    'products.*', 'inventory.*', 'rfid.*', 'suppliers.*', 'purchases.*',
    'transfers.*', 'quarantine.*', 'sales.read', 'reports.read',
    'locations.read', 'settings.read',
  ],
};

/** Does a list of granted patterns cover this permission? */
function matches(granted, permission) {
  if (!granted || !granted.length) return false;
  if (granted.includes('*')) return true;
  if (granted.includes(permission)) return true;
  const area = permission.split('.')[0];
  return granted.includes(`${area}.*`);
}

/**
 * can(role, permission, overrides)
 *
 * `overrides` is the user's own rules: [{ permission, effect }]. A deny wins
 * outright, including over an admin's wildcard — that is the point of being
 * able to bar one specific person from one specific thing.
 */
export function can(role, permission, overrides) {
  if (Array.isArray(overrides) && overrides.length) {
    const exact = overrides.find((o) => o.permission === permission);
    if (exact) return exact.effect !== 'deny';

    const area = `${permission.split('.')[0]}.*`;
    const wild = overrides.find((o) => o.permission === area);
    if (wild) return wild.effect !== 'deny';
  }
  return matches(ROLE_PERMISSIONS[role] || [], permission);
}

/** The full effective list for a user, for the client to reason about. */
export function effectivePermissions(role, overrides = []) {
  const base = ROLE_PERMISSIONS[role] || [];
  if (base.includes('*')) {
    const denied = overrides.filter((o) => o.effect === 'deny').map((o) => o.permission);
    return denied.length ? ['*', ...denied.map((d) => `!${d}`)] : ['*'];
  }
  const set = new Set(base);
  for (const o of overrides) {
    if (o.effect === 'deny') { set.delete(o.permission); set.add(`!${o.permission}`); }
    else set.add(o.permission);
  }
  return [...set];
}

export const ROLE_LABELS = {
  admin: 'Administrator',
  manager: 'Manager',
  cashier: 'Cashier',
  inventory: 'Inventory Staff',
};

/**
 * Whole areas a shop can switch off.
 *
 * Off means gone from the menu, not greyed out, and refused by the API too —
 * a feature that is "disabled" but still reachable by URL is a feature that is
 * enabled with extra steps.
 */
export const FEATURES = [
  { key: 'rfid',        label: 'RFID tags and stock takes', default: true },
  { key: 'transfers',   label: 'Branch transfers', default: true },
  { key: 'purchases',   label: 'Purchase orders', default: true },
  { key: 'expenses',    label: 'Expenses', default: true },
  { key: 'accounts',    label: 'Bank and till accounts', default: true },
  { key: 'customers',   label: 'Customers and loyalty', default: true },
  { key: 'credit',      label: 'Customer credit and layaway', default: false },
  { key: 'commissions', label: 'Sales-rep commission', default: false },
  { key: 'quarantine',  label: 'Quarantine and return to vendor', default: true },
  { key: 'holds',       label: 'Cross-branch holds', default: false },
  { key: 'deadstock',   label: 'Deadstock ageing', default: true },
  { key: 'digital_receipts', label: 'WhatsApp and SMS receipts', default: true },
];

export const featureDefaults = () =>
  Object.fromEntries(FEATURES.map((f) => [f.key, f.default]));
