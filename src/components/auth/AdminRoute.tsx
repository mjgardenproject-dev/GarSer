import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { fetchCurrentUserProfileRole, isAdminRole, type AppProfileRole } from '../../lib/adminAccess';

interface AdminRouteProps {
  children: React.ReactNode;
  allowInDevelopment?: boolean;
}

const AdminRoute: React.FC<AdminRouteProps> = ({ 
  children, 
  allowInDevelopment = true 
}) => {
  const { user, loading } = useAuth();
  const [profileRole, setProfileRole] = useState<AppProfileRole>(null);
  const [checkingRole, setCheckingRole] = useState(true);

  useEffect(() => {
    let mounted = true;

    const resolveRole = async () => {
      if (!user) {
        if (mounted) {
          setProfileRole(null);
          setCheckingRole(false);
        }
        return;
      }

      try {
        const role = await fetchCurrentUserProfileRole(user.id);
        if (mounted) {
          setProfileRole(role);
        }
      } catch (error) {
        console.error('Error resolving admin role:', error);
        if (mounted) {
          setProfileRole(null);
        }
      } finally {
        if (mounted) {
          setCheckingRole(false);
        }
      }
    };

    setCheckingRole(true);
    resolveRole();

    return () => {
      mounted = false;
    };
  }, [user?.id]);

  if (loading || checkingRole) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    );
  }

  // Si no está autenticado, redirigir al login
  if (!user) {
    return <Navigate to="/auth" />;
  }

  // En desarrollo, permitir acceso si allowInDevelopment es true
  const isDevelopment = import.meta.env.DEV;
  if (isDevelopment && allowInDevelopment) {
    console.log('🔧 AdminRoute: Acceso permitido en desarrollo');
    return <>{children}</>;
  }

  const isAdmin = isAdminRole(profileRole);

  if (!isAdmin) {
    console.warn('🚫 AdminRoute: Acceso denegado. Usuario no es administrador:', {
      userId: user.id,
      email: user.email,
      role: profileRole
    });
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="text-red-500 text-6xl mb-4">🚫</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Acceso Denegado
          </h2>
          <p className="text-gray-600 mb-4">
            No tienes permisos para acceder a esta página administrativa.
          </p>
          <button
            onClick={() => window.history.back()}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors"
          >
            Volver
          </button>
        </div>
      </div>
    );
  }

  console.log('✅ AdminRoute: Acceso permitido para administrador:', {
    userId: user.id,
    email: user.email,
    role: profileRole
  });

  return <>{children}</>;
};

export default AdminRoute;
