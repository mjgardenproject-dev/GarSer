import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAccount } from '../../contexts/AccountContext';
import { Home, Calendar, MessageCircle, User as UserIcon, Briefcase, CalendarClock } from 'lucide-react';
import { useUnreadChats } from '../../hooks/useUnreadChats';

const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Antes leía `useAuth().profile`, que no existe: el jardinero nunca veía «Panel».
  const { role } = useAccount();
  const unreadChats = useUnreadChats();

  const isGardener = role === 'gardener';
  // GarSer Empresas (F6.2, lo aprendido en el hito): el empleado no tiene reservas de cliente ni
  // chats con clientes; su barra lleva a su trabajo, su horario y su cuenta.
  const items = role === 'employee'
    ? [
        { path: '/mi-trabajo', label: 'Mi trabajo', icon: Briefcase },
        { path: '/mi-trabajo/horario', label: 'Horario', icon: CalendarClock },
        { path: '/account', label: 'Cuenta', icon: UserIcon },
      ]
    : [
        { path: '/dashboard', label: isGardener ? 'Panel' : 'Inicio', icon: isGardener ? Briefcase : Home },
        { path: '/bookings', label: 'Reservas', icon: Calendar },
        { path: '/chat', label: 'Chat', icon: MessageCircle, badge: unreadChats },
      ];

  return (
    <nav className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="max-w-full sm:max-w-7xl mx-auto">
        <div className="grid grid-cols-3 gap-1 h-16">
          {items.map((item) => {
            const Icon = item.icon as any;
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`flex flex-col items-center justify-center text-xs transition-colors ${
                  isActive ? 'text-green-700 bg-green-50 font-semibold' : 'text-gray-600 hover:text-green-600'
                }`}
                aria-label={item.badge ? `${item.label} (${item.badge} sin leer)` : item.label}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive ? 'true' : 'false'}
              >
                <span className="relative">
                  <Icon className="w-5 h-5 mb-1" />
                  {!!item.badge && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 bg-emerald-700 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;