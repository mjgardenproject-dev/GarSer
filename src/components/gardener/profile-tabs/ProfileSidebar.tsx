import React from 'react';
import { User, MapPin, Briefcase } from 'lucide-react';

interface ProfileSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: 'personal', label: 'Información Personal', shortLabel: 'Personal', icon: User },
  { id: 'coverage', label: 'Cobertura y Zonas', shortLabel: 'Cobertura', icon: MapPin },
  { id: 'services', label: 'Servicios', shortLabel: 'Servicios', icon: Briefcase },
];

const ProfileSidebar: React.FC<ProfileSidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <>
      {/* Móvil: control segmentado horizontal, para no apilar 3 botones verticales
          encima del contenido (fallo 5/6 de la auditoría UX 2026-09-14). */}
      <div className="flex gap-1 rounded-xl bg-gray-100 p-1 md:hidden" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-label={tab.label}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-2 text-xs font-semibold transition-colors ${
                isActive ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'
              }`}
            >
              <Icon className={`h-5 w-5 ${isActive ? 'text-green-600' : 'text-gray-400'}`} />
              {tab.shortLabel}
            </button>
          );
        })}
      </div>

      {/* Escritorio/tablet: lista vertical con etiqueta completa (sin cambios de diseño) */}
      <div className="hidden flex-col space-y-2 md:flex" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors text-left ${
                isActive
                  ? 'bg-green-50 text-green-700 font-semibold border border-green-200'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border border-transparent'
              }`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-green-600' : 'text-gray-400'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default ProfileSidebar;
