import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Leaf, LogOut, User, Calendar, MessageCircle, Menu, Shield, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface NavbarProps {
  applicationStatus?: 'pending' | 'active' | 'denied' | null;
}

const Navbar: React.FC<NavbarProps> = ({ applicationStatus: propStatus }) => {
  const { user, signOut } = useAuth();
  const [logoError, setLogoError] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Use prop if available, otherwise default to null (or we could keep local state if prop is undefined)
  // Since App always passes it, we can rely on prop.
  const applicationStatus = propStatus;

  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    try {
      await signOut();
      // Redirigir explícitamente a /auth para evitar que / redirija a /dashboard
      navigate('/auth');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

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
  const isAdmin = adminEmails.includes((user?.email || '').trim().toLowerCase());
  
  const showRoleBadge = isAdmin || applicationStatus === 'pending' || applicationStatus === 'active' || applicationStatus === 'denied';
  const roleBadgeLabel = isAdmin
    ? 'Admin'
    : applicationStatus === 'pending'
      ? 'Jardinero (pendiente)'
      : applicationStatus === 'active'
        ? 'Jardinero'
        : applicationStatus === 'denied'
          ? 'Jardinero (no aceptado)'
          : '';
          
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        if (!user?.id) return;
        const { data } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        setUserRole(data?.role || null);
        console.log('🔎 Navbar admin check', {
          email: (user?.email || '').trim().toLowerCase(),
          isAdmin,
          role: data?.role,
          adminEmails
        });
      } catch {}
    };
    checkAdmin();
  }, [user?.id]);

  const isApplyPage = location.pathname === '/apply';
  const isStatusPage = location.pathname === '/status';
  
  // Logic to hide nav:
  // 1. If user is gardener and NOT active -> Hide
  // 2. If on apply page and not admin -> Hide (legacy, but consistent)
  // 3. If on status page -> Hide
  const isGardener = userRole === 'gardener';
  const isGardenerPendingOrDraft = isGardener && applicationStatus !== 'active';
  
  const shouldHideNav = !isAdmin && (
    (isGardener && isGardenerPendingOrDraft) || 
    isApplyPage || 
    isStatusPage
  );

  const handleLogoClick = () => {
    if (shouldHideNav) return;
    navigate(user ? '/dashboard' : '/');
  };

  const navItems = user && !shouldHideNav ? [
    { path: '/dashboard', label: 'Dashboard', icon: User },
    { path: '/bookings', label: 'Reservas', icon: Calendar },
    { path: '/chat', label: 'Chat', icon: MessageCircle },
    { path: '/account', label: 'Mi Cuenta', icon: Settings },
    ...(isAdmin ? [{ path: '/admin/applications', label: 'Solicitudes', icon: Shield }] as any[] : [])
  ] : [];

  return (
    <nav className="bg-white shadow-lg border-b border-gray-200 relative">
      <div className="max-w-full sm:max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <button
              onClick={handleLogoClick}
              className={`flex-shrink-0 flex items-center focus:outline-none ${shouldHideNav ? 'cursor-default' : ''}`}
              aria-label="Ir al dashboard"
            >
              {/* Logo GarSer.es con fallback a texto */}
              {logoError ? (
                <span className="ml-2 text-xl font-bold text-gray-900">
                  GarSer
                  <span className="text-green-600">.es</span>
                </span>
              ) : (
                <img
                  src="/garser-logo.svg"
                  alt="GarSer.es — Garden Service"
                  className="h-8 w-auto"
                  onError={() => setLogoError(true)}
                />
              )}
            </button>
          </div>

          {/* Navegación desktop */}
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-4">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-green-100 text-green-700'
                        : 'text-gray-600 hover:text-green-600 hover:bg-green-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 mr-2" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Acciones derecha */}
          <div className="flex items-center space-x-3">
            <div className="hidden sm:block text-sm text-gray-600">
              <span className="font-medium">{user?.email}</span>
              {showRoleBadge && (
                <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                  {roleBadgeLabel}
                </span>
              )}
            </div>
            {user ? (
              <button
                onClick={handleSignOut}
                className="flex items-center px-2 md:px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
              >
                <LogOut className="w-4 h-4 mr-2" />
                <span className="hidden md:inline">Salir</span>
              </button>
            ) : (
              <button
                onClick={() => navigate('/auth')}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white py-2 px-4 text-sm rounded-xl font-bold shadow-lg shadow-green-600/20 transform transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                aria-label="Iniciar sesión"
              >
                Iniciar sesión
              </button>
            )}
            {/* Botón menú móvil */}
            {user && (
              <button
                className="md:hidden p-2 rounded-md text-gray-700 hover:bg-gray-100"
                aria-label="Abrir menú"
                onClick={() => setIsMobileMenuOpen(v => !v)}
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Menú móvil desplegable */}
        {isMobileMenuOpen && (
          <div className="md:hidden absolute left-0 right-0 top-16 bg-white border-t border-gray-200 shadow-md z-40">
            <div className="px-4 py-3 space-y-2">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = location.pathname === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => { setIsMobileMenuOpen(false); navigate(item.path); }}
                    className={`w-full flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive ? 'bg-green-100 text-green-700' : 'text-gray-700 hover:text-green-700 hover:bg-green-50'
                    }`}
                  >
                    <Icon className="w-4 h-4 mr-2" />
                    {item.label}
                  </button>
                );
              })}
              <div className="mt-2 text-xs text-gray-500">
                <span className="font-medium">{user?.email}</span>
                {showRoleBadge && (
                  <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 rounded-full">
                    {roleBadgeLabel}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
