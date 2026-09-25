import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import ProfileSettings from '../../components/gardener/ProfileSettings';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';

// Servicios, precios y zona de la empresa (/empresa/configuracion, GarSer Empresas F3.3). Es la
// MISMA pantalla que usa un autónomo: la empresa es un proveedor más (F2) y sus precios viven en
// las mismas tablas y los calcula el mismo motor. Adelantado de F4 para que el dueño pueda
// ofrecer servicios y repartirlos entre su equipo desde el primer día.

const CompanyConfigPage: React.FC = () => {
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

  return <ProfileSettings onBack={() => navigate('/empresa')} />;
};

export default CompanyConfigPage;
