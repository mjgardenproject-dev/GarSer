import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AvailabilityManager from '../../components/gardener/AvailabilityManager';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';

// Horario del dueño que trabaja (/empresa/horario, GarSer Empresas F5.1). Sus horas ocupadas son
// las de su agenda, no las de todos los trabajos de la empresa. La antelación mínima que ve aquí
// es la de la empresa (es su misma cuenta).

const CompanySchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const { loading, stage } = useCompanyOnboarding();
  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" />
      </div>
    );
  }
  if (stage !== 'approved') return <Navigate to="/empresa" replace />;
  return <AvailabilityManager onBack={() => navigate('/empresa')} busyFrom="me" />;
};

export default CompanySchedulePage;
