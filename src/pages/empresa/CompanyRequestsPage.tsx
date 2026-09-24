import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import BookingRequestsManager from '../../components/gardener/BookingRequestsManager';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';

// Solicitudes de reserva de la empresa (/empresa/solicitudes, GarSer Empresas F4): la misma
// pantalla con la que un autónomo acepta, rechaza o propone otro precio. La empresa es un
// proveedor más (F2): las reservas son suyas.

const CompanyRequestsPage: React.FC = () => {
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

  return <BookingRequestsManager onBack={() => navigate('/empresa')} />;
};

export default CompanyRequestsPage;
