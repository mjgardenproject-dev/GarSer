import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Shield, AlertTriangle, CheckCircle, RefreshCw, Users } from 'lucide-react';
import toast from 'react-hot-toast';

interface RoleInconsistency {
  user_id: string;
  profile_role: 'client' | 'gardener';
  has_gardener_profile: boolean;
  expected_role: 'client' | 'gardener';
  full_name: string;
}

const RoleMonitor = () => {
  const { user } = useAuth();
  const [inconsistencies, setInconsistencies] = useState<RoleInconsistency[]>([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({
    totalUsers: 0,
    consistentUsers: 0,
    inconsistentUsers: 0
  });

  useEffect(() => {
    checkAllRoles();
  }, []);

  const checkAllRoles = async () => {
    setLoading(true);
    try {
      console.log('🔍 Verificando consistencia de roles en toda la base de datos...');

      // Obtener todos los perfiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, role');

      if (profilesError) throw profilesError;

      // Obtener todos los perfiles de jardineros
      const { data: gardenerProfiles, error: gardenerError } = await supabase
        .from('gardener_profiles')
        .select('user_id');

      if (gardenerError) throw gardenerError;

      const gardenerUserIds = new Set(gardenerProfiles?.map((gp: any) => gp.user_id) || []);
      const foundInconsistencies: RoleInconsistency[] = [];

      profiles?.forEach((profile: any) => {
        const hasGardenerProfile = gardenerUserIds.has(profile.id);
        const currentRole = profile.role;
        let expectedRole: 'client' | 'gardener' = 'client';

        if (hasGardenerProfile) {
          expectedRole = 'gardener';
        }

        if (currentRole !== expectedRole) {
          foundInconsistencies.push({
            user_id: profile.id,
            profile_role: currentRole,
            has_gardener_profile: hasGardenerProfile,
            expected_role: expectedRole,
            full_name: profile.full_name || 'Sin nombre'
          });
        }
      });

      setInconsistencies(foundInconsistencies);
      setStats({
        totalUsers: profiles?.length || 0,
        consistentUsers: (profiles?.length || 0) - foundInconsistencies.length,
        inconsistentUsers: foundInconsistencies.length
      });

      if (foundInconsistencies.length > 0) {
        console.warn(`🚨 Se encontraron ${foundInconsistencies.length} inconsistencias de roles`);
      } else {
        console.log('✅ Todos los roles están consistentes');
      }

    } catch (error: any) {
      console.error('Error checking roles:', error);
      toast.error('Error al verificar roles: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const fixInconsistency = async (inconsistency: RoleInconsistency) => {
    try {
      console.log(`🔧 Corrigiendo inconsistencia para usuario: ${inconsistency.user_id}`);

      const { error } = await supabase
        .from('profiles')
        .update({ role: inconsistency.expected_role })
        .eq('id', inconsistency.user_id);

      if (error) throw error;

      toast.success(`Rol corregido para ${inconsistency.full_name}`);
      
      // Refrescar la lista
      await checkAllRoles();
      
      // Si es el usuario actual, sincronizar (requeriría recargar o re-login)
      if (user?.id === inconsistency.user_id) {
        toast.success('Tu rol ha sido actualizado. Por favor recarga la página.');
      }

    } catch (error: any) {
      console.error('Error fixing inconsistency:', error);
      toast.error('Error al corregir inconsistencia: ' + error.message);
    }
  };

  const fixAllInconsistencies = async () => {
    if (inconsistencies.length === 0) return;

    try {
      setLoading(true);
      console.log(`🔧 Corrigiendo ${inconsistencies.length} inconsistencias...`);

      for (const inconsistency of inconsistencies) {
        await fixInconsistency(inconsistency);
      }

      toast.success('Todas las inconsistencias han sido corregidas');
    } catch (error: any) {
      console.error('Error fixing all inconsistencies:', error);
      toast.error('Error al corregir inconsistencias');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <Shield className="w-8 h-8 text-blue-600 shrink-0" aria-hidden="true" />
          <div>
            <h3 className="text-lg font-bold text-gray-900">Supervisión Automática</h3>
            <p className="text-sm text-gray-600">Detección y corrección de inconsistencias</p>
          </div>
        </div>
        <button
          type="button"
          onClick={checkAllRoles}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Verificar Roles</span>
        </button>
      </div>

      {/* Estadísticas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-3">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-lg shrink-0">
            <Users className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-blue-800">Total Usuarios</p>
            <p className="text-2xl font-bold text-blue-900">{stats.totalUsers}</p>
          </div>
        </div>
        
        <div className="bg-green-50 p-4 rounded-xl border border-green-100 flex items-center gap-3">
          <div className="p-3 bg-green-100 text-green-600 rounded-lg shrink-0">
            <CheckCircle className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-green-800">Roles Consistentes</p>
            <p className="text-2xl font-bold text-green-900">{stats.consistentUsers}</p>
          </div>
        </div>
        
        <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex items-center gap-3">
          <div className="p-3 bg-red-100 text-red-600 rounded-lg shrink-0">
            <AlertTriangle className="w-6 h-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-medium text-red-800">Inconsistencias</p>
            <p className="text-2xl font-bold text-red-900">{stats.inconsistentUsers}</p>
          </div>
        </div>
      </div>

      {/* Lista de inconsistencias */}
      <div aria-live="polite">
        {inconsistencies.length > 0 && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-200 pb-4">
              <h4 className="text-base font-semibold text-gray-900">Inconsistencias Detectadas</h4>
              <button
                type="button"
                onClick={fixAllInconsistencies}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:outline-none transition-colors"
              >
                Corregir Todas
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {inconsistencies.map((inconsistency, index) => (
                <div key={index} className="border border-red-200 rounded-xl p-4 bg-red-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h5 className="font-semibold text-gray-900 truncate" title={inconsistency.full_name}>{inconsistency.full_name}</h5>
                    <p className="text-sm text-gray-700 mt-1">
                      Rol actual: <span className="font-medium text-red-700">{inconsistency.profile_role}</span>
                      <span className="mx-2 text-gray-400">→</span>
                      Rol esperado: <span className="font-medium text-green-700">{inconsistency.expected_role}</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {inconsistency.has_gardener_profile ? 'Tiene perfil de jardinero' : 'No tiene perfil de jardinero'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fixInconsistency(inconsistency)}
                    className="shrink-0 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:outline-none transition-colors w-full sm:w-auto"
                  >
                    Corregir
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {inconsistencies.length === 0 && !loading && (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-100">
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" aria-hidden="true" />
            <h4 className="text-base font-medium text-gray-900 mb-1">¡Todos los roles están consistentes!</h4>
            <p className="text-sm text-gray-600">No se encontraron inconsistencias en la base de datos.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleMonitor;
