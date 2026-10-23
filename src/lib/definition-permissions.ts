// Definition administration is distinct from applying existing tags to leads.
export function canManageDefinitions(role: unknown): boolean {
  return role === 'super_admin';
}