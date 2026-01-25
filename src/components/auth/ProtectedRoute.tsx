import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Bloquea siempre mientras la autenticación esté cargando
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando autenticación...</p>
        </div>
      </div>
    );
  }

  // Una vez loading es false, permitir si hay usuario
  if (user) {
    return <>{children}</>;
  }

  // Si no hay usuario, redirigir de forma estable a /auth
  if (location.pathname !== '/auth') {
    return <Navigate to="/auth" replace state={{ from: location }} />;
  }

  // Ya estamos en /auth, permitir la ruta actual
  return <>{children}</>;
};

export default ProtectedRoute;