import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { 
  logRoleChange, 
  logInconsistencyDetected, 
  logInconsistencyFixed, 
  logProfileCreated, 
  logSyncPerformed 
} from '../utils/roleLogger';

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signUp: (email: string, password: string, role: 'client' | 'gardener') => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  syncUserRole: () => Promise<void>;
  fixAllUserRoles: () => Promise<number>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout;

    // Safety timeout to prevent infinite loading
    const safetyTimeout = () => {
      timeoutId = setTimeout(() => {
        if (mounted) {
          console.warn('⚠️ Auth initialization timeout, stopping loading');
          setLoading(false);
        }
      }, 10000); // 10 seconds timeout
    };

    // Get initial session
    const initializeAuth = async () => {
      try {
        setLoading(true);
        safetyTimeout();
        
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (!mounted) return;
        
        if (error) {
          console.error('Session error:', error);
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setLoading(false);
        }
      } catch (error) {
        console.error('Session recovery error:', error);
        if (mounted) {
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        console.log('🔄 Auth state change:', event, session?.user?.id);
        
        setUser(session?.user ?? null);
        
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, role, phone, address, avatar_url, created_at, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Profile fetch error:', error);
        setProfile(null);
      } else if (data) {
        console.log('📋 Perfil encontrado:', { userId, role: data.role, fullName: data.full_name });
        setProfile(data);
      } else {
        console.log('❌ No profile found for user:', userId);
        console.log('🔧 Creating missing profile automatically...');
        // Crear automáticamente el perfil faltante
        await createMissingProfile(userId);
        // Intentar obtener el perfil recién creado
        const { data: newProfile } = await supabase
          .from('profiles')
          .select('id, user_id, full_name, role, phone, address, avatar_url, created_at, updated_at')
          .eq('user_id', userId)
          .maybeSingle();
        
        if (newProfile) {
          console.log('✅ Perfil creado exitosamente:', { userId, role: newProfile.role });
          setProfile(newProfile);
        } else {
          console.error('❌ Error: No se pudo crear el perfil');
          setProfile(null);
        }
      }
    } catch (error: any) {
      console.error('Error fetching profile:', error);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const createMissingProfile = async (userId: string) => {
    try {
      console.log('🔧 Creating missing profile for user:', userId);
      
      // Intentar obtener los metadatos del usuario con retry
      let correctRole: 'client' | 'gardener' = 'client';
      let user = null;
      
      // Retry para obtener metadatos (a veces no están disponibles inmediatamente)
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`🔄 Intento ${attempt}/3 para obtener metadatos del usuario`);
        
        const { data: userData } = await supabase.auth.getUser();
        user = userData.user;
        
        if (user && user.user_metadata?.role && (user.user_metadata.role === 'client' || user.user_metadata.role === 'gardener')) {
          correctRole = user.user_metadata.role;
          console.log('👤 Rol encontrado en metadatos:', correctRole);
          break;
        }
        
        if (attempt < 3) {
          console.log('⏳ Metadatos no disponibles, esperando 1 segundo...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Si después de los intentos no tenemos rol en metadatos, usar fallback
      if (!user || !user.user_metadata?.role) {
        console.log('⚠️ No se encontró rol en metadatos después de 3 intentos, verificando perfil de jardinero...');
        
        // Como fallback, verificar si existe un perfil de jardinero
        const { data: gardenerProfile, error: gardenerError } = await supabase
          .from('gardener_profiles')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

        if (gardenerError && gardenerError.code !== 'PGRST116') {
          console.error('Error checking gardener profile:', gardenerError);
        }

        if (gardenerProfile) {
          correctRole = 'gardener';
          console.log('🌱 Perfil de jardinero encontrado, usando rol: gardener');
        } else {
          console.log('📝 No se encontró perfil de jardinero, usando rol por defecto: client');
        }
      }
      
      const { data, error } = await supabase
        .from('profiles')
        .insert([
          {
            user_id: userId,
            full_name: '',
            role: correctRole,
            phone: '',
            address: ''
          }
        ])
        .select()
        .single();

      if (error) throw error;

      console.log('✅ Profile created successfully with role:', correctRole, data);
      await logProfileCreated(userId, correctRole, `Perfil faltante creado automáticamente con rol ${correctRole}`);
      setProfile(data);
    } catch (error: any) {
      console.error('❌ Error creating missing profile:', error);
    }
  };

  const verifyRoleConsistency = async (profile: Profile) => {
    try {
      console.log('🔍 Verificando consistencia de roles para usuario:', profile.user_id);
      
      // Verificar si el usuario tiene un perfil de jardinero
      const { data: gardenerProfile, error } = await supabase
        .from('gardener_profiles')
        .select('id, full_name')
        .eq('user_id', profile.user_id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking gardener profile:', error);
        return;
      }

      const hasGardenerProfile = !!gardenerProfile;
      const currentRole = profile.role;

      console.log(`📊 Estado actual: rol=${currentRole}, tienePerfilJardinero=${hasGardenerProfile}`);

      // Detectar inconsistencias
      if (hasGardenerProfile && currentRole === 'client') {
        console.warn('🚨 INCONSISTENCIA DETECTADA: Usuario tiene perfil de jardinero pero rol de cliente');
        await logInconsistencyDetected(profile.user_id, currentRole, hasGardenerProfile);
        await fixRoleInconsistency(profile.user_id, 'gardener');
      } else if (!hasGardenerProfile && currentRole === 'gardener') {
        console.warn('🚨 INCONSISTENCIA DETECTADA: Usuario tiene rol de jardinero pero no perfil de jardinero');
        await logInconsistencyDetected(profile.user_id, currentRole, hasGardenerProfile);
        await fixRoleInconsistency(profile.user_id, 'client');
      } else {
        console.log('✅ Roles consistentes para usuario:', profile.user_id, `(${currentRole})`);
      }
    } catch (error: any) {
      console.error('Error verifying role consistency:', error);
    }
  };

  const fixRoleInconsistency = async (userId: string, correctRole: 'client' | 'gardener') => {
    try {
      console.log(`🔧 Corrigiendo rol inconsistente a: ${correctRole}`);
      
      // Obtener el rol actual antes de cambiarlo
      const { data: currentProfile } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', userId)
        .maybeSingle();

      const oldRole = currentProfile?.role;
      
      const { error } = await supabase
        .from('profiles')
        .update({ role: correctRole })
        .eq('user_id', userId);

      if (error) throw error;

      console.log('✅ Rol corregido automáticamente');
      await logInconsistencyFixed(userId, oldRole, correctRole);
      
      // Refrescar el perfil después de la corrección
      await fetchProfile(userId);
    } catch (error: any) {
      console.error('❌ Error corrigiendo rol:', error);
    }
  };

  const signUp = async (email: string, password: string, role: 'client' | 'gardener') => {
    try {
      console.log('🔐 Iniciando registro con rol:', role);
      console.log('📧 Email:', email);
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role }
        }
      });

      console.log('🔍 Respuesta de signUp:', { data, error });

      if (error) {
        console.error('❌ Error en signUp:', error);
        throw error;
      }

      if (data.user) {
        console.log('👤 Usuario creado exitosamente:', data.user.id);
        console.log('🔍 Estado de confirmación:', data.user.email_confirmed_at);
        
        // Si el usuario necesita confirmación de email, no podemos crear el perfil aún
        // El rol ya está guardado en los metadatos iniciales del signUp
        if (!data.user.email_confirmed_at) {
          console.log('📧 Usuario requiere confirmación de email');
          console.log('💾 Rol guardado en metadatos iniciales del usuario');
          console.log('🎉 Registro completado - esperando confirmación de email');
          return data.user;
        }
        
        console.log('📝 Creando perfil con rol:', role);
        
        // Create profile with validation
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .insert([
            {
              user_id: data.user.id,
              full_name: '',
              phone: '',
              address: '',
              role: role
            }
          ])
          .select()
          .single();

        console.log('🔍 Respuesta de creación de perfil:', { profileData, profileError });

        if (profileError) {
          console.error('❌ Error creando perfil:', profileError);
          throw profileError;
        }

        console.log('✅ Perfil creado exitosamente:', profileData);
        
        // Si el rol es jardinero, crear también el perfil de jardinero
        if (role === 'gardener') {
          console.log('🌱 Creando perfil de jardinero...');
          
          const { error: gardenerError } = await supabase
            .from('gardener_profiles')
            .insert([
              {
                user_id: data.user.id,
                full_name: '',
                phone: '',
                address: '',
                description: '',
                max_distance: 10,
                services: [],
                is_available: true,
                rating: 5.0,
                total_reviews: 0
              }
            ]);

          if (gardenerError) {
            console.error('❌ Error creando perfil de jardinero:', gardenerError);
            // No lanzar error aquí, el perfil principal ya está creado
          } else {
            console.log('✅ Perfil de jardinero creado exitosamente');
          }
        }
        
        console.log('🎉 Registro completado exitosamente');
        return data.user;
      }
    } catch (error: any) {
      console.error('❌ Error en registro:', error);
      throw error;
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      console.log('🔐 Iniciando sesión para:', email);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      if (data.user) {
        console.log('✅ Sesión iniciada exitosamente para usuario:', data.user.id);
        
        // Esperar un momento para que el estado se actualice
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Obtener el perfil del usuario para determinar la redirección
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, user_id, role, full_name, phone, address, avatar_url, created_at, updated_at')
          .eq('user_id', data.user.id)
          .maybeSingle();

        if (profileError) {
          console.error('❌ Error obteniendo perfil:', profileError);
          // Si no hay perfil, crear uno por defecto
          await createMissingProfile(data.user.id);
          return;
        }

        if (profileData) {
          console.log('📋 Perfil encontrado:', { role: profileData.role, name: profileData.full_name });
          
          // Verificar consistencia antes de redirigir
          await verifyRoleConsistency(profileData);
          
          // Redirigir según el rol
          const targetPath = profileData.role === 'gardener' ? '/dashboard' : '/dashboard';
          console.log(`🔄 Redirigiendo a ${targetPath} para rol: ${profileData.role}`);
          
          // La redirección se manejará automáticamente por el useEffect en App.tsx
          // que detecta cambios en el perfil del usuario
        }
      }
    } catch (error: any) {
      console.error('❌ Error en inicio de sesión:', error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      // Clear local state first
      setUser(null);
      setProfile(null);
      setLoading(false);
      
      // Then sign out from Supabase
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('Sign out error:', error);
        // Even if signOut fails, we've cleared local state
      }
      
      // Clear any remaining session data from localStorage
      localStorage.removeItem('supabase.auth.token');
      sessionStorage.clear();
    } catch (error) {
      console.error('Error during sign out:', error);
      // Ensure local state is cleared even if there's an error
      setUser(null);
      setProfile(null);
      setLoading(false);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      console.log('Refreshing profile for user:', user.id);
      setLoading(true);
      
      try {
        // Forzar una nueva consulta con timestamp para evitar cache
        const { data, error } = await supabase
          .from('profiles')
          .select('id, user_id, full_name, role, phone, address, avatar_url, created_at, updated_at')
          .eq('user_id', user.id)
          .maybeSingle();

        console.log('Profile refresh result:', { data, error });

        if (error) {
          console.error('Error refreshing profile:', error);
          throw error;
        }

        if (data) {
          // Verificar consistencia después del refresh
          await verifyRoleConsistency(data);
          console.log('Setting new profile data:', data);
          setProfile(data);
        } else {
          console.log('No profile found during refresh');
          await createMissingProfile(user.id);
        }
      } catch (error) {
        console.error('Error in refreshProfile:', error);
        throw error;
      } finally {
        setLoading(false);
      }
    }
  };

  const syncUserRole = async () => {
    if (user && profile) {
      console.log('🔄 Sincronizando roles para usuario:', user.id);
      await logSyncPerformed(user.id, 'Sincronización manual de roles iniciada');
      await verifyRoleConsistency(profile);
      // Refrescar el perfil después de la sincronización
      await fetchProfile(user.id);
    }
  };

  const fixAllUserRoles = async () => {
    try {
      console.log('🔧 Iniciando corrección masiva de roles...');
      
      // Obtener todos los perfiles
      const { data: allProfiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id, role, full_name');

      if (profilesError) throw profilesError;

      // Obtener todos los perfiles de jardineros
      const { data: allGardenerProfiles, error: gardenersError } = await supabase
        .from('gardener_profiles')
        .select('user_id');

      if (gardenersError) throw gardenersError;

      const gardenerUserIds = new Set(allGardenerProfiles?.map(g => g.user_id) || []);

      let corrected = 0;
      
      for (const profile of allProfiles || []) {
        const hasGardenerProfile = gardenerUserIds.has(profile.user_id);
        const currentRole = profile.role;
        
        // Detectar y corregir inconsistencias
        if (hasGardenerProfile && currentRole === 'client') {
          console.log(`🔧 Corrigiendo ${profile.full_name || profile.user_id}: client -> gardener`);
          await fixRoleInconsistency(profile.user_id, 'gardener');
          corrected++;
        } else if (!hasGardenerProfile && currentRole === 'gardener') {
          console.log(`🔧 Corrigiendo ${profile.full_name || profile.user_id}: gardener -> client`);
          await fixRoleInconsistency(profile.user_id, 'client');
          corrected++;
        }
      }

      console.log(`✅ Corrección masiva completada. ${corrected} usuarios corregidos.`);
      return corrected;
    } catch (error: any) {
      console.error('❌ Error en corrección masiva:', error);
      throw error;
    }
  };

  const value = {
    user,
    profile,
    loading,
    signUp,
    signIn,
    signOut,
    refreshProfile,
    syncUserRole,
    fixAllUserRoles,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};