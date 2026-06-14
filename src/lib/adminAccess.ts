import { supabase } from './supabase';

export type AppProfileRole = 'admin' | 'gardener' | 'client' | null;

async function fetchRoleByColumn(column: 'user_id' | 'id', userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq(column, userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return ((data as { role?: AppProfileRole } | null)?.role as AppProfileRole) || null;
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
