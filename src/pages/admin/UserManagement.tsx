import React from 'react';
import ApplicationsAdmin from '../../components/admin/ApplicationsAdmin';
import RoleMonitor from '../../components/admin/RoleMonitor';
import ReviewModeration from '../../components/admin/ReviewModeration';

const UserManagement: React.FC = () => {
  return (
    <div className="space-y-8">
      <section aria-labelledby="applications-heading">
        <h2 id="applications-heading" className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
          Solicitudes de Jardineros
        </h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <ApplicationsAdmin />
        </div>
      </section>

      <section aria-labelledby="reviews-heading">
        <h2 id="reviews-heading" className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
          Reseñas
        </h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <ReviewModeration />
        </div>
      </section>

      <section aria-labelledby="roles-heading">
        <h2 id="roles-heading" className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b">
          Monitor de Roles
        </h2>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <RoleMonitor />
        </div>
      </section>
    </div>
  );
};

export default UserManagement;