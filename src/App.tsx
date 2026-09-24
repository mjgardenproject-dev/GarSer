import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './contexts/AuthContext';
import { BookingProvider } from './contexts/BookingContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import AuthForm from './components/auth/AuthForm';
import ResetPassword from './components/auth/ResetPassword';
import AdminRoute from './components/auth/AdminRoute';
import Navbar from './components/layout/Navbar';
import BottomNav from './components/layout/BottomNav';
import ErrorBoundary from './components/common/ErrorBoundary';
import ScrollToTop from './components/common/ScrollToTop';
import LegacyBookingRedirect from './components/client/LegacyBookingRedirect';
import LegacyCheckoutRedirect from './components/client/LegacyCheckoutRedirect';
import NotFoundPage from './pages/public/NotFoundPage';
import PublicHomePage from './pages/public/PublicHomePage';
import { supabase } from './lib/supabase';
import { useAccount } from './contexts/AccountContext';
import { hasWizardResume } from './utils/bookingResumeStorage';

import AdminProtectedRoute from './components/auth/AdminProtectedRoute';

// -----------------------------------------------------------------------------
// Carga diferida por zonas (paso 12)
//
// Todo iba en un único archivo de 1,4 MB: el cliente que entra a reservar desde el móvil
// descargaba también el panel de administración y el de jardinero, que no va a abrir nunca.
// En una conexión móvil eso es tiempo de espera antes de ver nada, y ahí se pierden reservas.
//
// Se separa por ZONA, no por pantalla: quien entra como cliente no paga el panel del
// jardinero, quien entra como jardinero no paga el del admin, y las landings públicas —que
// son la puerta de entrada— quedan lo más ligeras posible.
//
// Lo que sigue siendo carga inmediata: la home pública, el login y los redirectores. Son lo
// primero que ve alguien que llega, y diferirlos solo añadiría un parpadeo.
// -----------------------------------------------------------------------------

// Zona de administración
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const ServicesManagement = lazy(() => import('./pages/admin/ServicesManagement'));
const PhytosanitaryManagement = lazy(() => import('./pages/admin/PhytosanitaryManagement'));
const UserManagement = lazy(() => import('./pages/admin/UserManagement'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const RoleMonitor = lazy(() => import('./components/admin/RoleMonitor'));
const IncidentsManagement = lazy(() => import('./pages/admin/IncidentsManagement'));

// Zona de jardinero
const GardenerDashboard = lazy(() => import('./components/gardener/GardenerDashboard'));
const GardenerBookings = lazy(() => import('./components/gardener/GardenerBookings'));
const GardenerApplicationWizard = lazy(() => import('./components/gardener/GardenerApplicationWizard'));
const GardenerStatusPage = lazy(() => import('./components/gardener/GardenerStatusPage'));
// GarSer Empresas (F3.2): alta y panel de empresa.
const CompanyApplicationPage = lazy(() => import('./pages/empresa/CompanyApplicationPage'));
const CompanyStatusPage = lazy(() => import('./pages/empresa/CompanyStatusPage'));
const CompanyHomePage = lazy(() => import('./pages/empresa/CompanyHomePage'));

// Funnel de reserva (el más pesado: análisis con IA, wizards manuales y checkout)
const BookingFlow = lazy(() => import('./pages/reserva/BookingFlow'));
const ConfirmationPage = lazy(() => import('./pages/reserva/ConfirmationPage'));

// Zona de cliente y resto de páginas públicas
const ClientBookingLauncher = lazy(() => import('./components/client/ClientBookingLauncher'));
const ConfirmServicePage = lazy(() => import('./pages/public/ConfirmServicePage'));
const BookingIncidentPage = lazy(() => import('./pages/BookingIncidentPage'));
const BookingsList = lazy(() => import('./components/client/BookingsList'));
const ClientReviews = lazy(() => import('./components/client/ClientReviews'));
const ChatList = lazy(() => import('./components/chat/ChatList'));
const MyAccount = lazy(() => import('./components/account/MyAccount'));
const GardenerPublicProfile = lazy(() => import('./components/public/GardenerPublicProfile'));
const MarbellaLandingPage = lazy(() => import('./pages/public/MarbellaLandingPage'));
const CostaDelSolLandingPage = lazy(() => import('./pages/public/CostaDelSolLandingPage'));
const GardenersLandingPage = lazy(() => import('./pages/public/GardenersLandingPage'));

/** Placeholder mientras llega el trozo de código de la zona. */
const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-[60vh]">
    <div className="text-center">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600 mx-auto"></div>
      <p className="mt-4 text-sm text-gray-500">Cargando…</p>
    </div>
  </div>
);

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
    // Tipo de cuenta: fuente única `profiles.role` (F0 de GarSer Empresas). Sustituye a las
    // deducciones desde user_metadata y localStorage.signup_role, que controla el usuario.
    const { role: accountRole, loading: accountLoading } = useAccount();
    const isGardenerAccount = accountRole === 'gardener';
    const location = useLocation();
    const navigate = useNavigate();
    const isAuthPage = location.pathname === '/auth' || location.pathname === '/confirmar-servicio';
    const isBookingPage = location.pathname.startsWith('/reserva') || location.pathname.startsWith('/reservar');
    // Páginas de alta (jardinero o empresa): sin menú inferior, como /apply.
    const isApplyPage = location.pathname === '/apply' || location.pathname === '/empresa/solicitud' || location.pathname === '/empresa/estado';
    const isAdminPage = location.pathname.startsWith('/admin');
    const isMarketingPage =
      location.pathname === '/' ||
      location.pathname === '/marbella' ||
      location.pathname === '/costa-del-sol' ||
      location.pathname === '/para-jardineros';
  
  const [applicationStatus, setApplicationStatus] = useState<null | 'pending' | 'active' | 'denied'>(null);
  const [denialReason, setDenialReason] = useState<string>('');
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    // Si está cargando auth o el tipo de cuenta, esperamos
    if (authLoading || accountLoading) return;

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
        const { data: gp } = await supabase
            .from('gardener_profiles')
            .select('user_id')
            .eq('user_id', user.id)
            .maybeSingle();
        const gardenerProfile = gp as { user_id?: string | null } | null;
            
        if (gardenerProfile?.user_id) {
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
        const latestApplication = app as { status?: string | null; review_comment?: string | null } | null;

        if (appError) console.error('Error fetching application:', appError);

        setDenialReason(latestApplication?.review_comment || '');

        // Si no hay solicitud pero la cuenta es de jardinero -> Draft/Null
        if (!latestApplication && isGardenerAccount) {
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
        const ui = toUiStatus(latestApplication?.status);
        
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
  }, [user?.id, authLoading, accountLoading, isGardenerAccount]);

  // Strict Redirect Logic
  useEffect(() => {
    if (authLoading || accountLoading || !statusLoaded || !user) return;

    // Los administradores no deben ser forzados a seguir los flujos de jardinero (como /apply o /status)
    if (accountRole === 'admin') return;

    if (!isGardenerAccount) return;

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

  }, [authLoading, accountLoading, accountRole, isGardenerAccount, statusLoaded, user, applicationStatus, location.pathname, navigate]);

  if (authLoading || (user && (accountLoading || !statusLoaded))) {
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
      <ScrollToTop />
      {/* En el funnel de reserva la navbar de marketing sobra: duplica cabecera (el funnel
          ya tiene Volver/Salir) y roba ~130px de la primera pantalla en móvil */}
      {!isAuthPage && !isAdminPage && !isMarketingPage && !isBookingPage && <Navbar applicationStatus={applicationStatus} />}
      
      {isAdminPage ? (
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/admin" element={<AdminProtectedRoute><AdminLayout /></AdminProtectedRoute>}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="incidents" element={<IncidentsManagement />} />
              <Route path="services" element={<ServicesManagement />} />
              <Route path="phytosanitary" element={<PhytosanitaryManagement />} />
              <Route path="users" element={<UserManagement />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="applications" element={<Navigate to="/admin/users" replace />} />
              <Route path="licenses" element={<Navigate to="/admin/phytosanitary" replace />} />
            </Route>
          </Routes>
        </Suspense>
      ) : (
        <main
          className={
            isBookingPage || isMarketingPage || isAuthPage
              ? 'w-full pb-16 sm:pb-0'
              : 'mx-auto max-w-full px-3 pb-16 sm:max-w-7xl sm:px-6 sm:pb-0 lg:px-8'
          }
        >
          <Suspense fallback={<RouteFallback />}>
          <Routes>
        <Route
          path="/"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <ErrorBoundary fallbackTitle="Error al cargar la portada" fallbackMessage="Recarga la pagina para volver a intentarlo.">
                <PublicHomePage />
              </ErrorBoundary>
            )
          }
        />
        <Route
          path="/marbella"
          element={
            <ErrorBoundary fallbackTitle="Error al cargar Marbella" fallbackMessage="Recarga la pagina para volver a intentarlo.">
              <MarbellaLandingPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/costa-del-sol"
          element={
            <ErrorBoundary fallbackTitle="Error al cargar Costa del Sol" fallbackMessage="Recarga la pagina para volver a intentarlo.">
              <CostaDelSolLandingPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/para-jardineros"
          element={
            <ErrorBoundary fallbackTitle="Error al cargar la pagina profesional" fallbackMessage="Recarga la pagina para volver a intentarlo.">
              <GardenersLandingPage />
            </ErrorBoundary>
          }
        />
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              {(() => {
                if (accountRole === 'admin') {
                  return <Navigate to="/admin/dashboard" replace />;
                }

                // Cuenta de empresa: su alta y su panel viven en /empresa (F3.2).
                if (accountRole === 'company') {
                  return <Navigate to="/empresa" replace />;
                }

                const gardenerIntent = isGardenerAccount || (applicationStatus === 'pending' || applicationStatus === 'active' || applicationStatus === 'denied');
                
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
                const skipBookingResumeRedirect =
                  Boolean((location.state as { skipBookingResumeRedirect?: boolean } | null)?.skipBookingResumeRedirect);
                if (!skipBookingResumeRedirect && hasWizardResume({ userId: user?.id, allowAnonFallback: true })) {
                  return <Navigate to="/reservar" replace />;
                }
                return (
                  <ErrorBoundary fallbackTitle="Algo ha fallado en el panel" fallbackMessage="Estamos trabajando para solucionarlo. Puedes reintentar o volver atrás.">
                    <ClientBookingLauncher />
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
              <LegacyCheckoutRedirect />
            </ErrorBoundary>
          } 
        />
        <Route 
          path="/reservar/checkout" 
          element={
            <ErrorBoundary fallbackTitle="Error en el checkout" fallbackMessage="Si el problema persiste, vuelve a la reserva y reintenta.">
              <LegacyCheckoutRedirect />
            </ErrorBoundary>
          } 
        />
        {/* Ruta /service/:serviceId retirada (paso 11). Solo se llegaba a ella desde
            ServiceCatalog, que ya estaba huérfano, y la pantalla mostraba un
            "4.8 (127 reseñas)" escrito a mano: prueba social inventada, con las reseñas
            reales viviendo en otro sitio. Un enlace de más y se publicaba. */}
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
              <LegacyBookingRedirect />
            </ErrorBoundary>
          } 
        />
        {/* Las valoraciones del cliente. El profesional tiene las suyas en su panel, así que
            esta ruta es solo para clientes. */}
        <Route
          path="/valoraciones"
          element={
            <ProtectedRoute>
              <ClientReviews />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/bookings" 
          element={
            <ProtectedRoute>
              {/* Lista distinta según el tipo de cuenta (profiles.role) */}
              {(() => {
                if (accountRole === 'admin') {
                  return <Navigate to="/admin/dashboard" replace />;
                }
                if (isGardenerAccount) {
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
        {/* Rutas /debug-maps y /debug-roles retiradas (paso 10).
            Estaban gateadas por DEV+localhost, pero con un bypass por variable de entorno
            (VITE_ENABLE_DEBUG_ROUTES): una variable mal puesta en Vercel las reabría en
            producción, y RoleDebug podía CREAR perfiles en la base de datos desde el
            navegador. Además, al importarse de forma estática, su código viajaba en el
            bundle de todos los clientes aunque la ruta nunca fuera accesible. */}
        <Route
          path="/role-monitor" 
          element={
            <AdminRoute allowInDevelopment={true}>
              <RoleMonitor />
            </AdminRoute>
          } 
        />
        <Route path="/empresa" element={<ProtectedRoute><CompanyHomePage /></ProtectedRoute>} />
        <Route path="/empresa/solicitud" element={<ProtectedRoute><CompanyApplicationPage /></ProtectedRoute>} />
        <Route path="/empresa/estado" element={<ProtectedRoute><CompanyStatusPage /></ProtectedRoute>} />
        <Route 
          path="/apply" 
          element={
            <ProtectedRoute>
              <GardenerApplicationWizard />
            </ProtectedRoute>
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
        {/* Aquí había una segunda <Route path="/">: inalcanzable, porque React Router se queda
            con la primera coincidencia y la raíz ya está declarada arriba (línea ~243).
            Además contradecía a aquella: esta mandaba siempre a /dashboard, mientras que la
            que sí manda distingue entre visitante y usuario con sesión. */}
        <Route path="/auth" element={<AuthForm />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {/* Publica a proposito: es el enlace de un clic del correo de confirmacion, y tiene
            que funcionar aunque el cliente no tenga sesion abierta en el movil. */}
        <Route path="/confirmar-servicio" element={<ConfirmServicePage />} />
        <Route
          path="/incidencias/:bookingId"
          element={
            <ProtectedRoute>
              <BookingIncidentPage />
            </ProtectedRoute>
          }
        />
        {/* Comodín: cualquier URL que no coincida con nada. Sin esto, una dirección mal
            escrita dejaba la pantalla en blanco, sin explicación ni salida. */}
        <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
        </main>
      )}
      {!isAuthPage && !isBookingPage && !isApplyPage && !isAdminPage && !isMarketingPage && user && <BottomNav />}
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
