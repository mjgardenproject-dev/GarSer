import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AuthForm from './components/auth/AuthForm';
import ResetPassword from './components/auth/ResetPassword';
import AdminRoute from './components/auth/AdminRoute';
import DevelopmentRoute from './components/auth/DevelopmentRoute';
import Navbar from './components/layout/Navbar';
import GardenerBookings from './components/gardener/GardenerBookings';
import BottomNav from './components/layout/BottomNav';
import ServiceCatalog from './components/client/ServiceCatalog';
import ClientHome from './components/client/ClientHome';
import BookingCheckout from './components/client/BookingCheckout';
import ErrorBoundary from './components/common/ErrorBoundary';
import ServiceDetail from './components/client/ServiceDetail';
import MyAccount from './components/account/MyAccount';
import ServiceBooking from './components/client/ServiceBooking';
import GardenerPublicProfile from './components/public/GardenerPublicProfile';
import BookingsList from './components/client/BookingsList';
import GardenerDashboard from './components/gardener/GardenerDashboard';
import DashboardApplyCTA from './components/gardener/DashboardApplyCTA';
import GoogleMapsDebug from './components/common/GoogleMapsDebug';
import ChatList from './components/chat/ChatList';
import RoleDebug from './components/debug/RoleDebug';
import RoleMonitor from './components/admin/RoleMonitor';
import GardenerApplicationWizard from './components/gardener/GardenerApplicationWizard';
import ApplicationsAdmin from './components/admin/ApplicationsAdmin';
import { supabase } from './lib/supabase';

const toUiStatus = (db: any): 'pending'|'active'|'denied'|null => {
  if (!db) return null;
  if (db === 'approved') return 'active';
  if (db === 'rejected') return 'denied';
  if (db === 'submitted' || db === 'draft') return 'pending';
  return null;
};

const AppContent = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isAuthPage = location.pathname === '/auth';
  
  // Debug logging
  useEffect(() => {
    console.log('[App Debug] Current path:', location.pathname);
    console.log('[App Debug] Location state:', location.state);
    console.log('[App Debug] Location search:', location.search);
  }, [location]);
  const [applicationStatus, setApplicationStatus] = useState<null | 'pending' | 'active' | 'denied'>(null);
  const [dbStatus, setDbStatus] = useState<null | 'draft' | 'submitted' | 'approved' | 'rejected'>(null);
  const [denialReason, setDenialReason] = useState<string>('');

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        if (!user?.id) return;
        const { data: app } = await supabase
          .from('gardener_applications')
          .select('status, review_comment')
          .eq('user_id', user.id)
          .maybeSingle();
        setDbStatus((app?.status as any) || null);
        setDenialReason((app?.review_comment as any) || '');

        try {
          const { data: gp } = await supabase
            .from('gardener_profiles')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();
          if (gp?.user_id) {
            setApplicationStatus('active');
            try { localStorage.setItem('gardenerApplicationStatus','active'); } catch {}
            return;
          }
        } catch {}

        try {
          const { data: prof } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .maybeSingle();
          if ((prof?.role as any) === 'gardener') {
            setApplicationStatus('active');
            try { localStorage.setItem('gardenerApplicationStatus','active'); } catch {}
            return;
          }
        } catch {}
        const metaIntent = (user as any)?.user_metadata?.requested_role === 'gardener' || (user as any)?.user_metadata?.role === 'gardener';
        const lsStatus = (()=>{ try { return localStorage.getItem('gardenerApplicationStatus') as any; } catch { return null; } })();
        const lsJust = (()=>{ try { return !!localStorage.getItem('gardenerApplicationJustSubmitted'); } catch { return false; } })();
        if (!app && metaIntent) {
          if (lsStatus === 'submitted' && lsJust) {
            setApplicationStatus('pending');
          } else {
            navigate('/apply');
            setApplicationStatus(null);
          }
          return;
        }
        const ui = toUiStatus(app?.status) || (lsJust && lsStatus === 'submitted' ? 'pending' : null);
        if (ui === 'pending' && (app?.status === 'draft')) {
          navigate('/apply');
        }
        try {
          if (ui) localStorage.setItem('gardenerApplicationStatus', ui === 'pending' ? 'submitted' : ui);
          if (app?.status) localStorage.removeItem('gardenerApplicationJustSubmitted');
        } catch {}
        setApplicationStatus(ui);
      } catch (error) {
        console.error('Error fetching application status:', error);
        setApplicationStatus(null);
      }
    };
    fetchStatus();
  }, [user?.id]);

  return (
    <div className="min-h-screen bg-gray-50">
      {!isAuthPage && <Navbar />}
      <main className="max-w-full sm:max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-16 sm:pb-0">
        <Routes>
        <Route
          path="/"
          element={
            <ErrorBoundary fallbackTitle="Error en la reserva" fallbackMessage="Si el problema persiste, vuelve al paso anterior y reintenta.">
              <ClientHome />
            </ErrorBoundary>
          }
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              {(() => {
                const src = (()=>{ try { return localStorage.getItem('signup_source'); } catch { return null; } })();
                const metaIntent = (user as any)?.user_metadata?.role === 'gardener' || (user as any)?.user_metadata?.requested_role === 'gardener';
                const gardenerIntent = (src === 'checkout') ? false : (metaIntent || (applicationStatus === 'pending' || applicationStatus === 'active' || applicationStatus === 'denied'));
                if (gardenerIntent && applicationStatus === null) {
                  return (
                    <ErrorBoundary fallbackTitle="Cargando panel" fallbackMessage="Cargando información del perfil...">
                      <div className="p-8 text-center text-gray-600">Cargando...</div>
                    </ErrorBoundary>
                  );
                }
                const effectiveRole = gardenerIntent ? 'gardener' : 'client';
                console.log('🏠 Dashboard: Mostrando componente para rol:', effectiveRole);
                
                if (effectiveRole === 'gardener') {
                  const showDraftCta = dbStatus === 'draft';
                  const header = showDraftCta ? <DashboardApplyCTA /> : null;
                  if (applicationStatus === 'pending') {
                    return header || (
                      <div className="max-w-2xl mx-auto p-8 text-center">
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Tu solicitud está en revisión</h2>
                        <p className="text-gray-700">Tu cuenta ha sido verificada y tu solicitud para ser jardinero está enviada. Nuestro equipo la revisará y te avisaremos cuando esté aprobada.</p>
                      </div>
                    );
                  }
                  if (applicationStatus === 'denied') {
                    return (
                      <div className="max-w-2xl mx-auto p-8 text-center">
                        <h2 className="text-2xl font-bold text-gray-900 mb-2">Solicitud no aceptada</h2>
                        <p className="text-gray-700">Gracias por tu interés. En este momento no podemos aceptar tu solicitud.</p>
                        {denialReason && <p className="text-gray-700 mt-2">Motivo: {denialReason}</p>}
                        <p className="text-gray-700 mt-4">Puedes corregir tu información y volver a enviar la solicitud.</p>
                      </div>
                    );
                  }
                  if (applicationStatus === 'active') {
                    return (
                      <ErrorBoundary fallbackTitle="Algo ha fallado en el panel" fallbackMessage="Estamos trabajando para solucionarlo. Puedes reintentar o volver atrás.">
                        <GardenerDashboard />
                      </ErrorBoundary>
                    );
                  }
                  return (
                    <ErrorBoundary fallbackTitle="Algo ha fallado en el panel" fallbackMessage="Estamos trabajando para solucionarlo. Puedes reintentar o volver atrás.">
                      <GardenerDashboard />
                    </ErrorBoundary>
                  );
                } else {
                  return (
                    <ErrorBoundary fallbackTitle="Algo ha fallado en el panel" fallbackMessage="Estamos trabajando para solucionarlo. Puedes reintentar o volver atrás.">
                      <ClientHome />
                    </ErrorBoundary>
                  );
                }
              })()}
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/reserva" 
          element={
            <ErrorBoundary fallbackTitle="Error en la reserva" fallbackMessage="Si el problema persiste, vuelve al paso anterior y reintenta.">
              <ClientHome />
            </ErrorBoundary>
          } 
        />
        <Route 
          path="/reserva/checkout" 
          element={
            <ErrorBoundary fallbackTitle="Error en el checkout" fallbackMessage="Si el problema persiste, vuelve a la reserva y reintenta.">
              <BookingCheckout />
            </ErrorBoundary>
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
          path="/reservar/:gardenerId" 
          element={
            <ErrorBoundary fallbackTitle="Error al cargar el perfil público" fallbackMessage="Vuelve a intentar desde el QR o el enlace.">
              <GardenerPublicProfile />
            </ErrorBoundary>
          } 
        />
        <Route 
          path="/booking" 
          element={
            <ErrorBoundary fallbackTitle="Error en la reserva" fallbackMessage="Si el problema persiste, vuelve al paso anterior y reintenta.">
              <ServiceBooking />
            </ErrorBoundary>
          } 
        />
        <Route 
          path="/bookings" 
          element={
            <ProtectedRoute>
              {/* Mostrar lista distinta según el rol sin depender del perfil */}
              {(() => {
                const src = (()=>{ try { return localStorage.getItem('signup_source'); } catch { return null; } })();
                const fallbackRole = (src === 'checkout') ? 'client' : ((user as any)?.user_metadata?.role === 'gardener' ? 'gardener' : 'client');
                const effectiveRole = fallbackRole;
                if (effectiveRole === 'gardener') {
                  if (applicationStatus !== 'active') {
                    return (
                      <div className="max-w-2xl mx-auto p-8 text-center">
                        <h2 className="text-xl font-semibold text-gray-900 mb-2">Funcionalidad no disponible</h2>
                        <p className="text-gray-700">Tu solicitud de jardinero aún no ha sido aprobada. Podrás gestionar tus reservas cuando sea aceptada.</p>
                      </div>
                    );
                  }
                  return <GardenerBookings />;
                }
                return <BookingsList />;
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
        <Route 
          path="/apply" 
          element={
            <ProtectedRoute>
              <GardenerApplicationWizard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/admin/applications" 
          element={
            <AdminRoute allowInDevelopment={true}>
              <ApplicationsAdmin />
            </AdminRoute>
          } 
        />
        <Route 
          path="/account" 
          element={
            <ProtectedRoute>
              <ErrorBoundary fallbackTitle="Error en Mi Cuenta" fallbackMessage="Intenta reintentar más tarde.">
                <MyAccount />
              </ErrorBoundary>
            </ProtectedRoute>
          } 
        />
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/auth" element={<AuthForm />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </main>
      {!isAuthPage && <BottomNav />}
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
