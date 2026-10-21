export class AccessError extends Error {
  constructor(message = 'Forbidden', status = 403) { super(message); this.status = status; }
}

export function requirePrincipal(principal) {
  if (!principal) throw new AccessError('Authentication required', 401);
  return principal;
}

export function requirePermission(principal, code, ownerId) {
  requirePrincipal(principal);
  if (principal.password_change_due) throw new AccessError('Password change required', 403);
  if (!principal.permissions?.includes(code)) throw new AccessError('Forbidden');
  if (code === 'expenses.own' && ownerId !== undefined && String(ownerId) !== String(principal.id)) throw new AccessError('Forbidden');
  return principal;
}
