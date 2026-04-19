import React from 'react';
import LicenseVerificationAdmin from '../../components/admin/LicenseVerificationAdmin';

const PhytosanitaryManagement: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* We reuse the existing component but wrap it in the new layout structure */}
        <LicenseVerificationAdmin />
      </div>
    </div>
  );
};

export default PhytosanitaryManagement;