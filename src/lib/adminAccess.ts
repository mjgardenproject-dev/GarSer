import { supabase } from './supabase';
import { normalizeAccountRole, type AccountRole } from './accountRole';

export type AppProfileRole = AccountRole | null;

async function fetchRoleByColumn(column: 'user_id' | 'id', userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq(column, userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return normalizeAccountRole((data as { role?: unknown } | null)?.role);
}

export async function fetchCurrentUserProfileRole(userId: string): Promise<AppProfileRole> {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return null;
  }

  // The canonical key in `profiles` is `user_id`. We keep an `id` fallback to
  // tolerate legacy rows until the schema usage is fully normalized.
  const roleByUserId = await fetchRoleByColumn('user_id', normalizedUserId);
  if (roleByUserId) {
    return roleByUserId;
  }

  return fetchRoleByColumn('id', normalizedUserId);
}

export function isAdminRole(role: AppProfileRole) {
  return role === 'admin';
}
