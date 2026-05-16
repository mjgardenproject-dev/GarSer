import React from 'react';
import { User, MapPin, Briefcase } from 'lucide-react';

interface ProfileSidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: 'personal', label: 'Información Personal', icon: User },
  { id: 'coverage', label: 'Cobertura y Zonas', icon: MapPin },
  { id: 'services', label: 'Servicios', icon: Briefcase },
];

const ProfileSidebar: React.FC<ProfileSidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <div className="flex flex-col space-y-2">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id || (activeTab === 'monolith' && tab.id === 'personal');
        return (
          <button
            key={tab.id}
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
  );
};

export default ProfileSidebar;
