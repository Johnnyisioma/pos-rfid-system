/**
 * Role-based permissions. Keys are "<area>.<action>"; "*" is a wildcard.
 * Location scoping is enforced separately (see requireLocation).
 */
export const ROLES = ['admin', 'manager', 'cashier', 'inventory'];

export const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'products.*', 'inventory.*', 'rfid.*', 'sales.*', 'returns.*', 'customers.*',
    'suppliers.*', 'purchases.*', 'transfers.*', 'register.*', 'expenses.*',
    'reports.*', 'settings.read', 'settings.write', 'users.read', 'users.write',
    'audit.read', 'locations.read', 'devices.*',
  ],
  cashier: [
    'products.read', 'inventory.read', 'rfid.scan', 'rfid.find',
    'sales.create', 'sales.read', 'sales.hold', 'returns.create', 'returns.read',
    'customers.read', 'customers.write', 'register.*', 'reports.read',
    'locations.read', 'settings.read',
  ],
  inventory: [
    'products.*', 'inventory.*', 'rfid.*', 'suppliers.*', 'purchases.*',
    'transfers.*', 'sales.read', 'reports.read', 'locations.read', 'settings.read',
  ],
};

export function can(role, permission) {
  const granted = ROLE_PERMISSIONS[role] || [];
  if (granted.includes('*')) return true;
  if (granted.includes(permission)) return true;
  const area = permission.split('.')[0];
  return granted.includes(`${area}.*`);
}

export const ROLE_LABELS = {
  admin: 'Administrator',
  manager: 'Manager',
  cashier: 'Cashier',
  inventory: 'Inventory Staff',
};
