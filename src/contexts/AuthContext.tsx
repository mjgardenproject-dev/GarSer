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
    // Get initial session
    const initializeAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Session error:', error);
          // Clear invalid session
          await supabase.auth.signOut();
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
        // Clear any invalid session data
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    };

    initializeAuth();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state change:', event, session?.user?.id);
        
        setUser(session?.user ?? null);
        
        if (session?.user) {
          try {
            await fetchProfile(session.user.id);
          } catch (error) {
            console.error('Error fetching profile on auth change:', error);
            setProfile(null);
            setLoading(false);
          }
        } else {
          setProfile(null);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      // Verify we have a valid session before making the request
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        console.log('No valid session, skipping profile fetch');
        setProfile(null);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, user_id, full_name, role, phone, address, avatar_url, created_at, updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('Supabase profile error:', error);
        // If it's an auth error, clear the session
        if (error.code === 'PGRST301' || error.message?.includes('JWT')) {
          console.log('Authentication error, clearing session');
          await supabase.auth.signOut();
          setUser(null);
          setProfile(null);
          return;
        }
        setProfile(null);
      } else if (data) {
        // Verificar consistencia de roles automáticamente
        await verifyRoleConsistency(data);
        setProfile(data);
      } else {
        console.log('No profile found for user:', userId);
        // Si no hay perfil, crear uno automáticamente
        await createMissingProfile(userId);
      }
    } catch (error: any) {
      console.error('Error fetching profile:', error);
      // If it's a network or auth error, clear the session
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        console.log('Auth-related error, clearing session');
        await supabase.auth.signOut();
        setUser(null);
      }
      setProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const createMissingProfile = async (userId: string) => {
    try {
      console.log('🔧 Creating missing profile for user:', userId);
      
      const { data, error } = await supabase
        .from('profiles')
        .insert([
          {
            user_id: userId,
            full_name: '',
            role: 'client', // Default role
            phone: '',
            address: ''
          }
        ])
        .select()
        .single();

      if (error) throw error;

      console.log('✅ Profile created successfully:', data);
      await logProfileCreated(userId, 'client', 'Perfil faltante creado automáticamente');
      setProfile(data);
    } catch (error: any) {
      console.error('❌ Error creating missing profile:', error);
    }
  };

  const verifyRoleConsistency = async (profile: Profile) => {
    try {
      // Verificar si el usuario tiene un perfil de jardinero
      const { data: gardenerProfile, error } = await supabase
        .from('gardener_profiles')
        .select('id')
        .eq('user_id', profile.user_id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking gardener profile:', error);
        return;
      }

      const hasGardenerProfile = !!gardenerProfile;
      const currentRole = profile.role;

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
        console.log('✅ Roles consistentes para usuario:', profile.user_id);
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
        .single();

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
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { role }
        }
      });

      if (error) throw error;

      if (data.user) {
        console.log('👤 Usuario creado, creando perfil...');
        
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
      }
    } catch (error: any) {
      console.error('❌ Error en registro:', error);
      throw error;
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;
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
    syncUserRole
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};