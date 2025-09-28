import { supabase } from '../lib/supabase';

export interface RoleLogEntry {
  id?: string;
  user_id: string;
  action: 'role_change' | 'inconsistency_detected' | 'inconsistency_fixed' | 'profile_created' | 'sync_performed';
  old_role?: 'client' | 'gardener' | null;
  new_role?: 'client' | 'gardener' | null;
  details: string;
  metadata?: Record<string, any>;
  created_at?: string;
}

class RoleLogger {
  private static instance: RoleLogger;
  private logs: RoleLogEntry[] = [];

  private constructor() {}

  static getInstance(): RoleLogger {
    if (!RoleLogger.instance) {
      RoleLogger.instance = new RoleLogger();
    }
    return RoleLogger.instance;
  }

  async log(entry: Omit<RoleLogEntry, 'id' | 'created_at'>): Promise<void> {
    const logEntry: RoleLogEntry = {
      ...entry,
      created_at: new Date().toISOString()
    };

    // Agregar al log local
    this.logs.push(logEntry);

    // Log en consola con formato mejorado
    const timestamp = new Date().toLocaleString();
    const roleChange = entry.old_role && entry.new_role ? 
      `${entry.old_role} → ${entry.new_role}` : 
      entry.new_role || 'N/A';

    console.group(`🔐 [${timestamp}] Role Log - ${entry.action}`);
    console.log(`👤 Usuario: ${entry.user_id}`);
    if (entry.old_role || entry.new_role) {
      console.log(`🔄 Cambio de rol: ${roleChange}`);
    }
    console.log(`📝 Detalles: ${entry.details}`);
    if (entry.metadata) {
      console.log(`📊 Metadata:`, entry.metadata);
    }
    console.groupEnd();

    // Intentar guardar en base de datos (opcional, si existe tabla de logs)
    try {
      await this.saveToDatabase(logEntry);
    } catch (error) {
      console.warn('No se pudo guardar el log en la base de datos:', error);
    }
  }

  private async saveToDatabase(entry: RoleLogEntry): Promise<void> {
    // Verificar si existe la tabla role_logs
    const { error } = await supabase
      .from('role_logs')
      .insert([{
        user_id: entry.user_id,
        action: entry.action,
        old_role: entry.old_role,
        new_role: entry.new_role,
        details: entry.details,
        metadata: entry.metadata
      }]);

    if (error) {
      throw error;
    }
  }

  async logRoleChange(userId: string, oldRole: 'client' | 'gardener' | null, newRole: 'client' | 'gardener', reason: string): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'role_change',
      old_role: oldRole,
      new_role: newRole,
      details: `Cambio de rol: ${reason}`,
      metadata: { reason, timestamp: Date.now() }
    });
  }

  async logInconsistencyDetected(userId: string, profileRole: 'client' | 'gardener', hasGardenerProfile: boolean): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'inconsistency_detected',
      old_role: profileRole,
      new_role: hasGardenerProfile ? 'gardener' : 'client',
      details: `Inconsistencia detectada: perfil indica '${profileRole}' pero ${hasGardenerProfile ? 'tiene' : 'no tiene'} perfil de jardinero`,
      metadata: { profileRole, hasGardenerProfile }
    });
  }

  async logInconsistencyFixed(userId: string, oldRole: 'client' | 'gardener', newRole: 'client' | 'gardener'): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'inconsistency_fixed',
      old_role: oldRole,
      new_role: newRole,
      details: `Inconsistencia corregida automáticamente`,
      metadata: { autoFixed: true }
    });
  }

  async logProfileCreated(userId: string, role: 'client' | 'gardener', reason: string): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'profile_created',
      new_role: role,
      details: `Perfil creado: ${reason}`,
      metadata: { reason, autoCreated: true }
    });
  }

  async logSyncPerformed(userId: string, details: string): Promise<void> {
    await this.log({
      user_id: userId,
      action: 'sync_performed',
      details: `Sincronización realizada: ${details}`,
      metadata: { timestamp: Date.now() }
    });
  }

  getLocalLogs(): RoleLogEntry[] {
    return [...this.logs];
  }

  getLogsForUser(userId: string): RoleLogEntry[] {
    return this.logs.filter(log => log.user_id === userId);
  }

  clearLocalLogs(): void {
    this.logs = [];
    console.log('🗑️ Logs locales limpiados');
  }

  async getRecentActivity(limit: number = 50): Promise<RoleLogEntry[]> {
    try {
      const { data, error } = await supabase
        .from('role_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.warn('No se pudieron obtener los logs de la base de datos, usando logs locales');
      return this.logs.slice(-limit);
    }
  }
}

// Exportar instancia singleton
export const roleLogger = RoleLogger.getInstance();

// Funciones de conveniencia
export const logRoleChange = (userId: string, oldRole: 'client' | 'gardener' | null, newRole: 'client' | 'gardener', reason: string) => 
  roleLogger.logRoleChange(userId, oldRole, newRole, reason);

export const logInconsistencyDetected = (userId: string, profileRole: 'client' | 'gardener', hasGardenerProfile: boolean) => 
  roleLogger.logInconsistencyDetected(userId, profileRole, hasGardenerProfile);

export const logInconsistencyFixed = (userId: string, oldRole: 'client' | 'gardener', newRole: 'client' | 'gardener') => 
  roleLogger.logInconsistencyFixed(userId, oldRole, newRole);

export const logProfileCreated = (userId: string, role: 'client' | 'gardener', reason: string) => 
  roleLogger.logProfileCreated(userId, role, reason);

export const logSyncPerformed = (userId: string, details: string) => 
  roleLogger.logSyncPerformed(userId, details);