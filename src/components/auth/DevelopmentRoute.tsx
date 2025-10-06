import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

interface DevelopmentRouteProps {
  children: React.ReactNode;
  requireAuth?: boolean;
}

const DevelopmentRoute: React.FC<DevelopmentRouteProps> = ({ 
  children, 
  requireAuth = true 
}) => {
  const { user, loading } = useAuth();

  // Verificar si estamos en desarrollo
  const isDevelopment = import.meta.env.DEV;
  const isLocalhost = window.location.hostname === 'localhost' || 
                     window.location.hostname === '127.0.0.1' ||
                     window.location.hostname === '::1';
  const debugRoutesEnabled = import.meta.env.VITE_ENABLE_DEBUG_ROUTES === 'true';

  // Si no estamos en desarrollo o localhost, o si las rutas de debug están deshabilitadas, denegar acceso
  if ((!isDevelopment || !isLocalhost) && !debugRoutesEnabled) {
    console.warn('🚫 DevelopmentRoute: Acceso denegado. No es entorno de desarrollo:', {
      isDevelopment,
      isLocalhost,
      hostname: window.location.hostname
    });
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="text-yellow-500 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Página de Desarrollo
          </h2>
          <p className="text-gray-600 mb-4">
            Esta página solo está disponible en el entorno de desarrollo local.
          </p>
          <button
            onClick={() => window.location.href = '/dashboard'}
            className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors"
          >
            Ir al Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    );
  }

  // Si requiere autenticación y no está autenticado
  if (requireAuth && !user) {
    return <Navigate to="/auth" />;
  }

  console.log('🔧 DevelopmentRoute: Acceso permitido en desarrollo');
  return <>{children}</>;
};

export default DevelopmentRoute;