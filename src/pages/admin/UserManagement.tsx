import React from 'react';
import ApplicationsAdmin from '../../components/admin/ApplicationsAdmin';
import RoleMonitor from '../../components/admin/RoleMonitor';

const UserManagement: React.FC = () => {
  return (
    <div className="space-y-8">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-2">Solicitudes de Jardineros</h2>
        <ApplicationsAdmin />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-4 border-b pb-2">Monitor de Roles</h2>
        <RoleMonitor />
      </div>
    </div>
  );
};

export default UserManagement;