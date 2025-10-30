import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AuthForm from './components/auth/AuthForm';
import AdminRoute from './components/auth/AdminRoute';
import DevelopmentRoute from './components/auth/DevelopmentRoute';
import Navbar from './components/layout/Navbar';
import ServiceCatalog from './components/client/ServiceCatalog';
import ClientHome from './components/client/ClientHome';
import ErrorBoundary from './components/common/ErrorBoundary';
import ServiceDetail from './components/client/ServiceDetail';
import ServiceBooking from './components/client/ServiceBooking';
import BookingsList from './components/client/BookingsList';
import GardenerDashboard from './components/gardener/GardenerDashboard';
import GoogleMapsDebug from './components/common/GoogleMapsDebug';
import ChatList from './components/chat/ChatList';
import RoleDebug from './components/debug/RoleDebug';
import RoleMonitor from './components/admin/RoleMonitor';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/auth" />;
};

const AppContent = () => {
  const { user, profile, loading } = useAuth();

  // Log para debugging
  React.useEffect(() => {
    if (user && profile) {
      console.log('🔄 App: Usuario autenticado:', {
        userId: user.id,
        email: user.email,
        role: profile.role,
        fullName: profile.full_name
      });
    }
  }, [user, profile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Inicializando aplicación...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Routes>
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              {(() => {
                // Evitar renderizar el panel hasta que el rol del perfil esté disponible
                if (!profile || !profile.role) {
                  console.log('⏳ Dashboard: Esperando a que el perfil cargue rol...');
                  return (
                    <div className="flex items-center justify-center min-h-[50vh]">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto"></div>
                        <p className="mt-3 text-gray-600">Cargando perfil...</p>
                      </div>
                    </div>
                  );
                }

                const component = profile.role === 'gardener' ? <GardenerDashboard /> : <ClientHome />;
                console.log('🏠 Dashboard: Mostrando componente para rol:', profile.role);
                return (
                  <ErrorBoundary fallbackTitle="Algo ha fallado en el panel" fallbackMessage="Estamos trabajando para solucionarlo. Puedes reintentar o volver atrás.">
                    {component}
                  </ErrorBoundary>
                );
              })()}
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/service/:serviceId" 
          element={
            <ProtectedRoute>
              <ErrorBoundary fallbackTitle="Error al cargar el servicio" fallbackMessage="Intenta reintentar o volver al catálogo.">
                <ServiceDetail />
              </ErrorBoundary>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/booking" 
          element={
            <ProtectedRoute>
              <ErrorBoundary fallbackTitle="Error en la reserva" fallbackMessage="Si el problema persiste, vuelve al paso anterior y reintenta.">
                <ServiceBooking />
              </ErrorBoundary>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/bookings" 
          element={
            <ProtectedRoute>
              <BookingsList />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/chat" 
          element={
            <ProtectedRoute>
              <ChatList />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/debug-maps" 
          element={
            <DevelopmentRoute>
              <div className="p-8">
                <GoogleMapsDebug />
              </div>
            </DevelopmentRoute>
          } 
        />
        <Route 
          path="/debug-roles" 
          element={
            <DevelopmentRoute>
              <RoleDebug />
            </DevelopmentRoute>
          } 
        />
        <Route 
          path="/role-monitor" 
          element={
            <AdminRoute allowInDevelopment={true}>
              <RoleMonitor />
            </AdminRoute>
          } 
        />
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/auth" element={<AuthForm />} />
      </Routes>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
        <Toaster position="top-right" />
      </Router>
    </AuthProvider>
  );
}

export default App;