import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Leaf, LogOut, User, Calendar, MessageCircle, Menu, Shield, Settings } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

const Navbar = () => {
  const { user, profile, signOut } = useAuth();
  const [logoError, setLogoError] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  
  // Calcular rol efectivo sin depender del perfil para no bloquear la UI y considerar estado de solicitud
  const fallbackRole = (user as any)?.user_metadata?.role === 'gardener' ? 'gardener' : 'client';
  const effectiveRole = profile?.role || fallbackRole;
  const [applicationStatus, setApplicationStatus] = useState<null | 'draft' | 'submitted' | 'approved' | 'rejected'>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        if (!user?.id) return;
        const { data } = await supabase
          .from('gardener_applications')
          .select('status')
          .eq('user_id', user.id)
          .order('submitted_at', { ascending: false })
          .limit(1);
        const st = data && data.length > 0 ? (data[0].status as any) : null;
        setApplicationStatus(st);
      } catch {}
    };
    fetchStatus();
  }, [user?.id]);
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

  const adminEmails = import.meta.env.VITE_ADMIN_EMAILS?.split(',') || [
    'admin@jardineria.com',
    'developer@jardineria.com',
    'mjgardenproject@gmail.com'
  ];
  const isAdmin = (profile?.role === 'admin') || adminEmails.includes(user?.email || '');

  const navItems = [
    { path: '/dashboard', label: 'Dashboard', icon: User },
    { path: '/bookings', label: 'Reservas', icon: Calendar },
    { path: '/chat', label: 'Chat', icon: MessageCircle },
    { path: '/account', label: 'Mi Cuenta', icon: Settings },
    ...(isAdmin ? [{ path: '/admin/applications', label: 'Solicitudes', icon: Shield }] as any[] : [])
  ];

  return (
    <nav className="bg-white shadow-lg border-b border-gray-200 relative">
      <div className="max-w-full sm:max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex-shrink-0 flex items-center focus:outline-none"
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
              <span className="font-medium">{profile?.full_name || user?.email}</span>
              <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs">
                {isAdmin ? 'Admin' : (
                  applicationStatus === 'submitted' ? 'Jardinero (pendiente)' : (
                    (effectiveRole === 'gardener' || applicationStatus === 'approved') ? 'Jardinero' : 'Cliente'
                  )
                )}
              </span>
            </div>
            <button
              onClick={handleSignOut}
              className="flex items-center px-2 md:px-3 py-2 text-sm font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
            >
              <LogOut className="w-4 h-4 mr-2" />
              <span className="hidden md:inline">Salir</span>
            </button>
            {/* Botón menú móvil */}
            <button
              className="md:hidden p-2 rounded-md text-gray-700 hover:bg-gray-100"
              aria-label="Abrir menú"
              onClick={() => setIsMobileMenuOpen(v => !v)}
            >
              <Menu className="w-5 h-5" />
            </button>
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
                <span className="font-medium">{profile?.full_name || user?.email}</span>
                <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 rounded-full">{isAdmin ? 'Admin' : (applicationStatus === 'submitted' ? 'Jardinero (pendiente)' : ((effectiveRole === 'gardener' || applicationStatus === 'approved') ? 'Jardinero' : 'Cliente'))}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};

export default Navbar;