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
  const { user, syncUserRole } = useAuth();
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

      const gardenerUserIds = new Set(gardenerProfiles?.map(gp => gp.user_id) || []);
      const foundInconsistencies: RoleInconsistency[] = [];

      profiles?.forEach(profile => {
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
        toast.error(`Se encontraron ${foundInconsistencies.length} inconsistencias de roles`);
      } else {
        console.log('✅ Todos los roles están consistentes');
        toast.success('Todos los roles están consistentes');
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
      
      // Si es el usuario actual, sincronizar
      if (user?.id === inconsistency.user_id) {
        await syncUserRole();
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
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Shield className="h-8 w-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Monitor de Roles</h1>
              <p className="text-gray-600">Supervisión y corrección automática de inconsistencias</p>
            </div>
          </div>
          <button
            onClick={checkAllRoles}
            disabled={loading}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Verificar Roles</span>
          </button>
        </div>

        {/* Estadísticas */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <Users className="h-6 w-6 text-blue-600" />
              <div>
                <p className="text-sm text-blue-600">Total Usuarios</p>
                <p className="text-2xl font-bold text-blue-900">{stats.totalUsers}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-green-50 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <CheckCircle className="h-6 w-6 text-green-600" />
              <div>
                <p className="text-sm text-green-600">Roles Consistentes</p>
                <p className="text-2xl font-bold text-green-900">{stats.consistentUsers}</p>
              </div>
            </div>
          </div>
          
          <div className="bg-red-50 p-4 rounded-lg">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="h-6 w-6 text-red-600" />
              <div>
                <p className="text-sm text-red-600">Inconsistencias</p>
                <p className="text-2xl font-bold text-red-900">{stats.inconsistentUsers}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Lista de inconsistencias */}
        {inconsistencies.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Inconsistencias Detectadas</h2>
              <button
                onClick={fixAllInconsistencies}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Corregir Todas
              </button>
            </div>

            <div className="space-y-3">
              {inconsistencies.map((inconsistency, index) => (
                <div key={index} className="border border-red-200 rounded-lg p-4 bg-red-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">{inconsistency.full_name}</h3>
                      <p className="text-sm text-gray-600">
                        Rol actual: <span className="font-medium text-red-600">{inconsistency.profile_role}</span>
                        {' → '}
                        Rol esperado: <span className="font-medium text-green-600">{inconsistency.expected_role}</span>
                      </p>
                      <p className="text-xs text-gray-500">
                        {inconsistency.has_gardener_profile ? 'Tiene perfil de jardinero' : 'No tiene perfil de jardinero'}
                      </p>
                    </div>
                    <button
                      onClick={() => fixInconsistency(inconsistency)}
                      className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700"
                    >
                      Corregir
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {inconsistencies.length === 0 && !loading && (
          <div className="text-center py-8">
            <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">¡Todos los roles están consistentes!</h3>
            <p className="text-gray-600">No se encontraron inconsistencias en la base de datos.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RoleMonitor;
