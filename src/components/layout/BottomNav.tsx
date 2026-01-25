import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Home, Calendar, MessageCircle, User as UserIcon, Briefcase } from 'lucide-react';

const BottomNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();

  const isGardener = profile?.role === 'gardener';
  const items = [
    { path: '/dashboard', label: isGardener ? 'Panel' : 'Inicio', icon: isGardener ? Briefcase : Home },
    { path: '/bookings', label: 'Reservas', icon: Calendar },
    { path: '/chat', label: 'Chat', icon: MessageCircle },
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
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive ? 'true' : 'false'}
              >
                <Icon className="w-5 h-5 mb-1" />
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