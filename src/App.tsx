import React from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AuthForm from './components/auth/AuthForm';
import AdminRoute from './components/auth/AdminRoute';
import DevelopmentRoute from './components/auth/DevelopmentRoute';
import Navbar from './components/layout/Navbar';
import GardenerBookings from './components/gardener/GardenerBookings';
import BottomNav from './components/layout/BottomNav';
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

const AppContent = () => {
  const { user, profile } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="max-w-full sm:max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-16 sm:pb-0">
        <Routes>
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              {(() => {
                // Usar rol de metadatos del usuario como fallback para no bloquear UI
                const fallbackRole = (user as any)?.user_metadata?.role === 'gardener' ? 'gardener' : 'client';
                const effectiveRole = profile?.role || fallbackRole;
                const component = effectiveRole === 'gardener' ? <GardenerDashboard /> : <ClientHome />;
                console.log('🏠 Dashboard: Mostrando componente para rol:', effectiveRole);
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
              {/* Mostrar lista distinta según el rol sin depender del perfil */}
              {(() => {
                const fallbackRole = (user as any)?.user_metadata?.role === 'gardener' ? 'gardener' : 'client';
                const effectiveRole = profile?.role || fallbackRole;
                return effectiveRole === 'gardener' ? <GardenerBookings /> : <BookingsList />;
              })()}
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
      </main>
      <BottomNav />
    </div>
  );
};

function App() {
  return (
    <>
      <AppContent />
      <Toaster position="top-right" />
    </>
  );
}

export default App;