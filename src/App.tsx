import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import { BookingProvider } from './contexts/BookingContext';
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
import GardenerStatusPage from './components/gardener/GardenerStatusPage';
import ApplicationsAdmin from './components/admin/ApplicationsAdmin';
import BookingFlow from './pages/reserva/BookingFlow';
import ConfirmationPage from './pages/reserva/ConfirmationPage';
import { supabase } from './lib/supabase';

const toUiStatus = (db: any): 'pending'|'active'|'denied'|null => {
  if (!db) return null;
  if (db === 'approved') return 'active';
  if (db === 'rejected') return 'denied';
  if (db === 'submitted') return 'pending';
  // draft se trata como null (no enviado) para forzar /apply
  return null;
};

  const AppContent = () => {
    const { user, loading: authLoading } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();
    const isAuthPage = location.pathname === '/auth';
    const isBookingPage = location.pathname.startsWith('/reserva') || location.pathname.startsWith('/reservar');
    const isApplyPage = location.pathname === '/apply';
  
  // Debug logging
  useEffect(() => {
    console.log('[App Debug] Current path:', location.pathname);
    console.log('[App Debug] Location state:', location.state);
    console.log('[App Debug] Location search:', location.search);
  }, [location]);
  
  const [applicationStatus, setApplicationStatus] = useState<null | 'pending' | 'active' | 'denied'>(null);
  const [dbStatus, setDbStatus] = useState<null | 'draft' | 'submitted' | 'approved' | 'rejected'>(null);
  const [denialReason, setDenialReason] = useState<string>('');
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    // Si está cargando auth, esperamos
    if (authLoading) return;

    // Si no hay usuario, reseteamos y marcamos como cargado
    if (!user?.id) {
        setApplicationStatus(null);
        setStatusLoaded(true);
        return;
    }

    // Si hay usuario, iniciamos carga
    // Marcamos como no cargado para mostrar spinner si es necesario y bloquear redirecciones erróneas
    setStatusLoaded(false);

    const fetchStatus = async () => {
      try {
        // Optimización: Hacemos una única llamada compuesta o paralela si es posible
        // Primero verificamos perfil activo (es lo más común para usuarios establecidos)
        
        // Check 1: Gardener Profile (Active)
        // Intentamos leer el perfil directamente. Si existe, es active.
        const { data: gp, error: gpError } = await supabase
            .from('gardener_profiles')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();
            
        if (gp?.user_id) {
            setApplicationStatus('active');
            try { localStorage.setItem('gardenerApplicationStatus','active'); } catch {}
            setStatusLoaded(true);
            return;
        }

        // Check 2: Application Status (Pending/Draft/Denied)
        // Solo si no es activo buscamos la solicitud
        const { data: app, error: appError } = await supabase
          .from('gardener_applications')
          .select('status, review_comment')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (appError) console.error('Error fetching application:', appError);

        setDbStatus((app?.status as any) || null);
        setDenialReason((app?.review_comment as any) || '');

        const metaIntent = (user as any)?.user_metadata?.requested_role === 'gardener' || (user as any)?.user_metadata?.role === 'gardener';
        const lsRole = (()=>{ try { return localStorage.getItem('signup_role'); } catch { return null; } })();
        const gardenerIntent = metaIntent || lsRole === 'gardener';
        
        // Si no hay solicitud pero hay intención -> Draft/Null
        if (!app && gardenerIntent) {
            // Check LS for optimistic updates just in case
            const lsStatus = (()=>{ try { return localStorage.getItem('gardenerApplicationStatus') as any; } catch { return null; } })();
            const lsJust = (()=>{ try { return !!localStorage.getItem('gardenerApplicationJustSubmitted'); } catch { return false; } })();
            
            if (lsStatus === 'submitted' && lsJust) {
                setApplicationStatus('pending');
            } else {
                setApplicationStatus(null);
            }
            setStatusLoaded(true);
            return;
        }
        
        // Calcular estado UI
        const ui = toUiStatus(app?.status);
        
        // Cachear en LS para futuro
        try {
          if (ui) localStorage.setItem('gardenerApplicationStatus', ui === 'pending' ? 'submitted' : ui);
        } catch {}
        
        setApplicationStatus(ui);
      } catch (error) {
        console.error('Error fetching application status:', error);
        setApplicationStatus(null);
      } finally {
        setStatusLoaded(true);
      }
    };
    
    fetchStatus();
  }, [user?.id, authLoading]);

  // Strict Redirect Logic
  useEffect(() => {
    if (authLoading || !statusLoaded || !user) return;

    const isGardenerIntent = (user?.user_metadata?.role === 'gardener' || 
                             user?.user_metadata?.requested_role === 'gardener' ||
                             localStorage.getItem('signup_role') === 'gardener');

    if (!isGardenerIntent) return;

    const currentPath = location.pathname;
    
    // Caso 1: Solicitud Pendiente o Rechazada -> Forzar /status
    if (applicationStatus === 'pending' || applicationStatus === 'denied') {
      if (currentPath !== '/status') {
        navigate('/status', { replace: true });
      }
      return;
    }

    // Caso 2: Activo -> Permitir Dashboard (Redirigir si intenta ir a apply/status)
    if (applicationStatus === 'active') {
      if (currentPath === '/apply' || currentPath === '/status') {
        navigate('/dashboard', { replace: true });
      }
      return;
    }

    // Caso 3: No enviado (Draft o Null) -> Forzar /apply
    // Solo si no estamos ya en /apply y no estamos en auth
    if (applicationStatus === null) {
        if (currentPath !== '/apply' && currentPath !== '/auth') {
            navigate('/apply', { replace: true });
        }
    }

  }, [authLoading, statusLoaded, user, applicationStatus, location.pathname, navigate]);

  if (authLoading || (!statusLoaded && user)) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Cargando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {!isAuthPage && <Navbar applicationStatus={applicationStatus} />}
      <main className="max-w-full sm:max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pb-16 sm:pb-0">
        <Routes>
        <Route
          path="/"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <ErrorBoundary fallbackTitle="Error en la reserva" fallbackMessage="Si el problema persiste, vuelve al paso anterior y reintenta.">
                <ClientHome />
              </ErrorBoundary>
            )
          }
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              {(() => {
                const src = (()=>{ try { return localStorage.getItem('signup_source'); } catch { return null; } })();
                const metaIntent = (user as any)?.user_metadata?.role === 'gardener' || (user as any)?.user_metadata?.requested_role === 'gardener';
                const lsRole = (()=>{ try { return localStorage.getItem('signup_role'); } catch { return null; } })();
                const baseIntent = metaIntent || lsRole === 'gardener' || (applicationStatus === 'pending' || applicationStatus === 'active' || applicationStatus === 'denied');
                const gardenerIntent = (src === 'checkout') ? false : baseIntent;
                
                if (gardenerIntent) {
                    if (!statusLoaded) {
                        return (
                            <ErrorBoundary fallbackTitle="Cargando panel" fallbackMessage="Cargando información del perfil...">
                              <div className="flex items-center justify-center min-h-[50vh]">
                                <div className="text-center">
                                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
                                  <p className="mt-4 text-gray-600">Cargando estado...</p>
                                </div>
                              </div>
                            </ErrorBoundary>
                        );
                    }

                   // Si llega aquí es porque applicationStatus === 'active' debido al useEffect de redirección estricta
                   // O porque hubo un fallo en la redirección, en cuyo caso forzamos la navegación
                   if (applicationStatus === 'active') {
                      return (
                        <ErrorBoundary fallbackTitle="Algo ha fallado en el panel" fallbackMessage="Estamos trabajando para solucionarlo.">
                          <GardenerDashboard />
                        </ErrorBoundary>
                      );
                   }
                   
                   // Redirección declarativa como respaldo al useEffect
                   if (applicationStatus === 'pending' || applicationStatus === 'denied') {
                     return <Navigate to="/status" replace />;
                   }
                   
                   // Si no es ninguno de los anteriores, asumir draft/null y enviar a apply
                   return <Navigate to="/apply" replace />;
                }
                
                // Rol de Cliente
                try {
                  const raw = localStorage.getItem('bookingDraft');
                  if (raw) {
                    const draft = JSON.parse(raw);
                    if (draft?.step && draft.step !== 'welcome') {
                      return <Navigate to="/reservar" replace />;
                    }
                  }
                } catch {}
                return (
                  <ErrorBoundary fallbackTitle="Algo ha fallado en el panel" fallbackMessage="Estamos trabajando para solucionarlo. Puedes reintentar o volver atrás.">
                    <ClientHome />
                  </ErrorBoundary>
                );
              })()}
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/status" 
          element={
            <ProtectedRoute>
                <GardenerStatusPage 
                    status={applicationStatus === 'denied' ? 'denied' : 'pending'} 
                    denialReason={denialReason} 
                />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/reserva" 
          element={
            <BookingProvider>
              <ErrorBoundary fallbackTitle="Error en la reserva" fallbackMessage="Si el problema persiste, vuelve al paso anterior y reintenta.">
                <BookingFlow />
              </ErrorBoundary>
            </BookingProvider>
          } 
        />
        <Route 
          path="/reserva/confirmacion" 
          element={
            <BookingProvider>
              <ErrorBoundary fallbackTitle="Error en la confirmación" fallbackMessage="Si el problema persiste, vuelve a la reserva y reintenta.">
                <ConfirmationPage />
              </ErrorBoundary>
            </BookingProvider>
          } 
        />
        <Route 
          path="/reservar" 
          element={
            <BookingProvider>
              <ErrorBoundary fallbackTitle="Error en la reserva" fallbackMessage="Si el problema persiste, vuelve al paso anterior y reintenta.">
                <BookingFlow />
              </ErrorBoundary>
            </BookingProvider>
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
          path="/reservar/checkout" 
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
      {!isAuthPage && !isBookingPage && !isApplyPage && user && <BottomNav />}
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
