import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { ShieldAlert } from 'lucide-react';

interface AdminProtectedRouteProps {
  children: React.ReactNode;
}

const AdminProtectedRoute: React.FC<AdminProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkAdmin = async () => {
      if (!user) {
        setIsAdmin(false);
        setChecking(false);
        return;
      }

      // Hardcoded list fallback (as used in previous AdminRoute)
      const defaultAdminEmails = [
        'admin@jardineria.com',
        'developer@jardineria.com',
        'mjgardenproject@gmail.com',
        'migardenproject@gmail.com'
      ];
      const envAdminEmailsRaw = import.meta.env.VITE_ADMIN_EMAILS?.split(',') || [];
      const adminEmails = Array.from(new Set([
        ...defaultAdminEmails,
        ...envAdminEmailsRaw
      ].map(e => (e || '').trim().toLowerCase())));

      if (adminEmails.includes((user.email || '').trim().toLowerCase())) {
        if (mounted) {
          setIsAdmin(true);
          setChecking(false);
        }
        return;
      }

      // Check DB Profile
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('role')
          .eq('user_id', user.id)
          .maybeSingle();
        
        if (mounted) {
          setIsAdmin(!error && data?.role === 'admin');
          setChecking(false);
        }
      } catch (err) {
        if (mounted) {
          setIsAdmin(false);
          setChecking(false);
        }
      }
    };

    checkAdmin();

    return () => {
      mounted = false;
    };
  }, [user]);

  if (loading || checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="flex flex-col items-center text-gray-500">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mb-4"></div>
          <p>Verificando permisos...</p>
        </div>
      </div>
    );
  }

  if (!user || isAdmin === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center border border-red-100">
          <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Acceso Denegado
          </h2>
          <p className="text-gray-600 mb-6">
            Esta área es exclusiva para administradores del sistema.
          </p>
          <button
            onClick={() => window.location.assign('/')}
            className="bg-gray-900 text-white px-6 py-2 rounded-lg hover:bg-gray-800 transition-colors font-medium"
          >
            Volver al Inicio
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default AdminProtectedRoute;
