import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { User, Database, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface ProfileData {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: 'client' | 'gardener';
  created_at: string;
}

interface GardenerProfileData {
  user_id: string;
  full_name: string;
  description: string;
  services: string[];
  is_available: boolean;
}

const RoleDebug = () => {
  const { user, profile, refreshProfile, fixAllUserRoles } = useAuth();
  const [profiles, setProfiles] = useState<ProfileData[]>([]);
  const [gardenerProfiles, setGardenerProfiles] = useState<GardenerProfileData[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUserData, setCurrentUserData] = useState<any>(null);

  useEffect(() => {
    if (user) {
      fetchAllData();
    }
  }, [user]);

  const fetchAllData = async () => {
    setLoading(true);
    try {
      // Obtener todos los perfiles
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;
      setProfiles(profilesData || []);

      // Obtener todos los perfiles de jardinero
      const { data: gardenerData, error: gardenerError } = await supabase
        .from('gardener_profiles')
        .select('*');

      if (gardenerError) throw gardenerError;
      setGardenerProfiles(gardenerData || []);

      // Obtener datos del usuario actual
      if (user) {
        const currentProfile = profilesData?.find(p => p.user_id === user.id);
        const currentGardenerProfile = gardenerData?.find(g => g.user_id === user.id);
        
        setCurrentUserData({
          user_id: user.id,
          email: user.email,
          profile: currentProfile,
          gardenerProfile: currentGardenerProfile,
          hasProfile: !!currentProfile,
          hasGardenerProfile: !!currentGardenerProfile,
          profileRole: currentProfile?.role,
          shouldBeGardener: !!currentGardenerProfile
        });
      }

    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Error al cargar los datos');
    } finally {
      setLoading(false);
    }
  };

  const fixCurrentUserRole = async () => {
    if (!user || !currentUserData) return;

    setLoading(true);
    try {
      // Si el usuario tiene un perfil de jardinero pero su rol en profiles es 'client', corregirlo
      if (currentUserData.hasGardenerProfile && currentUserData.profileRole === 'client') {
        const { error } = await supabase
          .from('profiles')
          .update({ role: 'gardener' })
          .eq('id', user.id);

        if (error) throw error;
        
        toast.success('Rol corregido a jardinero');
        await fetchAllData();
        
        // Actualizar el contexto de autenticación
        await refreshProfile();
      }
      // Si el usuario no tiene perfil de jardinero pero su rol es 'gardener', corregirlo
      else if (!currentUserData.hasGardenerProfile && currentUserData.profileRole === 'gardener') {
        const { error } = await supabase
          .from('profiles')
          .update({ role: 'client' })
          .eq('id', user.id);

        if (error) throw error;
        
        toast.success('Rol corregido a cliente');
        await fetchAllData();
        
        // Recargar la página para que se actualice el contexto
        window.location.reload();
      } else {
        toast.info('El rol ya es correcto');
      }
    } catch (error) {
      console.error('Error fixing role:', error);
      toast.error('Error al corregir el rol');
    } finally {
      setLoading(false);
    }
  };

  const checkUserProfile = async () => {
    if (!user) return;

    try {
      console.log('Checking profile for user:', user.id);
      
      // Verificar si el usuario tiene un perfil
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id);

      console.log('Profile check result:', { data, error });
      
      if (error) {
        console.error('Error checking profile:', error);
        toast.error('Error al verificar perfil: ' + error.message);
        return;
      }

      if (!data || data.length === 0) {
        console.log('No profile found, creating one...');
        await createUserProfile();
      } else {
        console.log('Profile found:', data[0]);
        toast.success('Perfil encontrado: ' + JSON.stringify(data[0]));
      }
      
    } catch (error: any) {
      console.error('Error in checkUserProfile:', error);
      toast.error('Error: ' + error.message);
    }
  };

  const createUserProfile = async () => {
    if (!user) return;

    try {
      console.log('Creating profile for user:', user.id);
      
      const { data, error } = await supabase
        .from('profiles')
        .insert([
          {
            id: user.id,
            full_name: user.email?.split('@')[0] || '',
            role: 'client',
            phone: '',
            address: ''
          }
        ])
        .select()
        .single();

      if (error) throw error;

      console.log('Profile created:', data);
      toast.success('Perfil creado exitosamente');
      
      // Refrescar los datos
      await fetchAllData();
      await refreshProfile();
      
    } catch (error: any) {
      console.error('Error creating profile:', error);
      toast.error('Error al crear perfil: ' + error.message);
    }
  };

  const forceRoleToGardener = async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      // Primero verificar si el usuario tiene un perfil
      await checkUserProfile();
      
      // Actualizar el rol en la tabla profiles
      const { error } = await supabase
        .from('profiles')
        .update({ role: 'gardener' })
        .eq('id', user.id);

      if (error) throw error;

      toast.success('Rol forzado a jardinero');
      
      // Refrescar los datos
      await fetchAllData();
      await refreshProfile();
      
    } catch (error: any) {
      console.error('Error forcing role:', error);
      toast.error('Error al forzar el rol: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const createGardenerProfileForUser = async () => {
    if (!user || !currentUserData || currentUserData.hasGardenerProfile) return;

    setLoading(true);
    try {
      // Crear perfil de jardinero
      const { error: gardenerError } = await supabase
        .from('gardener_profiles')
        .insert([{
          user_id: user.id,
          full_name: currentUserData.profile?.full_name || '',
          description: 'Jardinero profesional',
          services: [],
          max_distance: 25,
          rating: 5.0,
          is_available: true,
          address: currentUserData.profile?.address || '',
          phone: currentUserData.profile?.phone || ''
        }]);

      if (gardenerError) throw gardenerError;

      // Actualizar rol en profiles
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ role: 'gardener' })
        .eq('id', user.id);

      if (profileError) throw profileError;

      toast.success('Perfil de jardinero creado exitosamente');
      await fetchAllData();
      
      // Actualizar el contexto de autenticación
      await refreshProfile();
    } catch (error) {
      console.error('Error creating gardener profile:', error);
      toast.error('Error al crear el perfil de jardinero');
    } finally {
      setLoading(false);
    }
  };

  const handleFixAllRoles = async () => {
    if (!confirm('¿Estás seguro de que quieres corregir todos los roles inconsistentes? Esta acción afectará a todos los usuarios.')) {
      return;
    }

    setLoading(true);
    try {
      const correctedCount = await fixAllUserRoles();
      toast.success(`✅ Corrección masiva completada. ${correctedCount} usuarios corregidos.`);
      await fetchAllData();
    } catch (error) {
      console.error('Error in mass role correction:', error);
      toast.error('Error en la corrección masiva de roles');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-lg">
        <p className="text-gray-600">Debes estar autenticado para usar esta herramienta.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            <Database className="w-6 h-6 mr-2" />
            Depuración de Roles de Usuario
          </h1>
          <button
            onClick={fetchAllData}
            disabled={loading}
            className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        {/* Información del usuario actual */}
        {currentUserData && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <User className="w-5 h-5 mr-2" />
              Tu Cuenta Actual
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p><strong>Email:</strong> {currentUserData.email}</p>
                <p><strong>ID:</strong> {currentUserData.user_id}</p>
                <p><strong>Nombre:</strong> {currentUserData.profile?.full_name || 'No definido'}</p>
              </div>
              <div>
                <p className="flex items-center">
                  <strong>Tiene perfil básico:</strong> 
                  {currentUserData.hasProfile ? (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-2" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-500 ml-2" />
                  )}
                </p>
                <p className="flex items-center">
                  <strong>Tiene perfil de jardinero:</strong> 
                  {currentUserData.hasGardenerProfile ? (
                    <CheckCircle className="w-4 h-4 text-green-500 ml-2" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-500 ml-2" />
                  )}
                </p>
                <p><strong>Rol actual:</strong> 
                  <span className={`ml-2 px-2 py-1 rounded text-sm ${
                    currentUserData.profileRole === 'gardener' 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {currentUserData.profileRole === 'gardener' ? 'Jardinero' : 'Cliente'}
                  </span>
                </p>
              </div>
            </div>

            {/* Información detallada de depuración */}
            <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm">
              <h4 className="font-semibold mb-2">Datos de depuración:</h4>
              <p><strong>hasGardenerProfile:</strong> {currentUserData.hasGardenerProfile ? 'true' : 'false'}</p>
              <p><strong>profileRole:</strong> {currentUserData.profileRole}</p>
              <p><strong>shouldBeGardener:</strong> {currentUserData.shouldBeGardener ? 'true' : 'false'}</p>
              <p><strong>Condición para "Corregir a Jardinero":</strong> {currentUserData.hasGardenerProfile && currentUserData.profileRole === 'client' ? 'true' : 'false'}</p>
              <p><strong>Condición para "Convertir a Jardinero":</strong> {!currentUserData.hasGardenerProfile && currentUserData.profileRole === 'client' ? 'true' : 'false'}</p>
            </div>

            {/* Acciones de corrección */}
            <div className="mt-4 space-x-2">
              {currentUserData.hasGardenerProfile && currentUserData.profileRole === 'client' && (
                <button
                  onClick={fixCurrentUserRole}
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  Corregir a Jardinero
                </button>
              )}
              
              {!currentUserData.hasGardenerProfile && currentUserData.profileRole === 'gardener' && (
                <button
                  onClick={fixCurrentUserRole}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Corregir a Cliente
                </button>
              )}

              {!currentUserData.hasGardenerProfile && currentUserData.profileRole === 'client' && (
                <button
                  onClick={createGardenerProfileForUser}
                  disabled={loading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  Convertir a Jardinero
                </button>
              )}

              {/* Botón de verificación de perfil */}
              <button
                onClick={checkUserProfile}
                disabled={loading}
                className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50"
              >
                Verificar Perfil
              </button>

              {/* Botón de corrección manual que siempre aparece */}
              <button
                onClick={forceRoleToGardener}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                Forzar Rol a Jardinero
              </button>
            </div>
          </div>
        )}

        {/* Acciones globales */}
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">Acciones Administrativas</h3>
          <p className="text-sm text-yellow-700 mb-3">
            Estas acciones afectan a todos los usuarios del sistema. Úsalas con precaución.
          </p>
          <div className="space-x-2">
            <button
              onClick={handleFixAllRoles}
              disabled={loading}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 flex items-center"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Corregir Todos los Roles
            </button>
            <button
              onClick={fetchAllData}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Actualizar Datos
            </button>
          </div>
        </div>

        {/* Resumen de datos */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-blue-50 p-4 rounded-lg">
            <h3 className="font-semibold text-blue-900">Total Perfiles</h3>
            <p className="text-2xl font-bold text-blue-600">{profiles.length}</p>
          </div>
          <div className="bg-green-50 p-4 rounded-lg">
            <h3 className="font-semibold text-green-900">Jardineros</h3>
            <p className="text-2xl font-bold text-green-600">
              {profiles.filter(p => p.role === 'gardener').length}
            </p>
          </div>
          <div className="bg-purple-50 p-4 rounded-lg">
            <h3 className="font-semibold text-purple-900">Perfiles de Jardinero</h3>
            <p className="text-2xl font-bold text-purple-600">{gardenerProfiles.length}</p>
          </div>
        </div>

        {/* Lista de todos los perfiles */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Todos los Perfiles</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white border border-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left">Email</th>
                  <th className="px-4 py-2 text-left">Nombre</th>
                  <th className="px-4 py-2 text-left">Rol</th>
                  <th className="px-4 py-2 text-left">Perfil Jardinero</th>
                  <th className="px-4 py-2 text-left">Estado</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  const hasGardenerProfile = gardenerProfiles.some(g => g.user_id === profile.user_id);
                  const isConsistent = (profile.role === 'gardener' && hasGardenerProfile) || 
                                     (profile.role === 'client' && !hasGardenerProfile);
                  
                  return (
                    <tr key={profile.id} className={profile.user_id === user?.id ? 'bg-yellow-50' : ''}>
                      <td className="px-4 py-2 border-t">{profile.email}</td>
                      <td className="px-4 py-2 border-t">{profile.full_name || 'Sin nombre'}</td>
                      <td className="px-4 py-2 border-t">
                        <span className={`px-2 py-1 rounded text-sm ${
                          profile.role === 'gardener' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {profile.role === 'gardener' ? 'Jardinero' : 'Cliente'}
                        </span>
                      </td>
                      <td className="px-4 py-2 border-t">
                        {hasGardenerProfile ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <AlertCircle className="w-4 h-4 text-gray-400" />
                        )}
                      </td>
                      <td className="px-4 py-2 border-t">
                        {isConsistent ? (
                          <span className="text-green-600 font-medium">✓ Consistente</span>
                        ) : (
                          <span className="text-red-600 font-medium">⚠ Inconsistente</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoleDebug;
