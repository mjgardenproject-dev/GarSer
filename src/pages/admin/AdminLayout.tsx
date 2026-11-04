import React, { useEffect, useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Leaf, 
  Users, 
  Briefcase, 
  Settings, 
  LogOut,
  ShieldAlert,
  AlertTriangle,
  UserCircle,
  UserCheck,
  Percent,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { parseAdminPendingCounts, pendingApplications, type AdminPendingCounts } from '../../components/admin/adminPendingCounts';

const AdminLayout: React.FC = () => {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [pending, setPending] = useState<AdminPendingCounts | null>(null);
  const [fallbackIncidents, setFallbackIncidents] = useState(0);

  // Sin estos contadores las secciones son invisibles hasta que a alguien se le ocurre mirar: son
  // altas de profesionales, carnets e incidencias (dinero de un cliente) esperando al administrador.
  // Se piden al entrar, al moverse por el panel (tras revisar algo el número baja) y al volver a la
  // pestaña. El correo y la notificación al móvil avisan sin necesidad de tener el panel abierto.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const { data, error } = await supabase.rpc('admin_pending_review_counts');
      const parsed = error ? null : parseAdminPendingCounts(data);
      if (!alive) return;
      if (parsed) {
        setPending(parsed);
        return;
      }
      // La función aún no está en la base (la web se despliega antes que la migración) o falló:
      // al menos las incidencias, como antes.
      const { count } = await supabase
        .from('booking_incidents')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'in_review']);
      if (alive) setFallbackIncidents(count || 0);
    };
    void load();
    const onVisible = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pathname]);

  const openIncidents = pending ? pending.incidents : fallbackIncidents;

  // Mismo cierre que el resto de la web: solo este dispositivo (R-06) y limpieza del almacenamiento.
  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      toast.error('Error al cerrar sesión');
    }
  };

  const navItems = [
    { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/admin/incidents', icon: AlertTriangle, label: 'Incidencias', badge: openIncidents },
    // Quién sale a los clientes y qué le falta a cada uno (completar la cuenta profesional).
    { to: '/admin/providers', icon: UserCheck, label: 'Profesionales' },
    { to: '/admin/services', icon: Briefcase, label: 'Servicios' },
    { to: '/admin/phytosanitary', icon: Leaf, label: 'Certificados Fito.', badge: pending?.licenses ?? 0 },
    // Solicitudes de alta (jardineros y empresas) pendientes de aprobar.
    { to: '/admin/users', icon: Users, label: 'Usuarios', badge: pending ? pendingApplications(pending) : 0 },
    // Lo que cobra GarSer en cada tipo de reserva (antes un interruptor dentro de Configuración).
    { to: '/admin/commissions', icon: Percent, label: 'Comisiones' },
    { to: '/admin/settings', icon: Settings, label: 'Configuración' },
    // Pruebas en garser.es (2026-10-12): el panel no llevaba a «Mi cuenta» (foto, contraseña,
    // «Cerrar todas»); solo se llegaba escribiendo /account.
    { to: '/account', icon: UserCircle, label: 'Mi cuenta' },
  ];

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col md:flex-row">
      {/* Sidebar Desktop & Mobile Topbar */}
      <aside className="w-full md:w-64 bg-gray-900 text-white flex flex-col md:fixed md:h-full z-20 shadow-xl">
        <div className="p-5 flex items-center justify-between md:justify-start border-b border-gray-800">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-8 h-8 text-green-400" />
            <h1 className="text-xl font-bold tracking-tight">Admin Panel</h1>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto hidden md:block">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                  isActive
                    ? 'bg-emerald-700 text-white shadow-md'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <item.icon className="w-5 h-5" />
              <span className="font-medium">{item.label}</span>
              {!!item.badge && (
                <span className="ml-auto min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-bold rounded-full inline-flex items-center justify-center">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Mobile Nav Horizontal */}
        <nav className="flex md:hidden overflow-x-auto px-4 py-3 gap-2 border-b border-gray-800">
           {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-emerald-700 text-white shadow-md'
                    : 'bg-gray-800 text-gray-300'
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              <span className="text-sm font-medium">{item.label}</span>
              {!!item.badge && (
                <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full inline-flex items-center justify-center">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </NavLink>
          ))}
          {/* R-14: en el móvil el botón de salir solo existía en la barra lateral, que se oculta. */}
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-lg whitespace-nowrap bg-gray-800 text-red-300"
          >
            <LogOut className="w-4 h-4" />
            <span className="text-sm font-medium">Salir</span>
          </button>
        </nav>

        <div className="p-4 border-t border-gray-800 hidden md:block">
          <div className="mb-4 px-2">
            <p className="text-sm font-medium text-gray-300">Administrador</p>
            <p className="text-xs text-gray-500 truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2 w-full text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <LogOut className="w-5 h-5" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 md:ml-64 bg-gray-50 min-h-screen">
        <div className="p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
