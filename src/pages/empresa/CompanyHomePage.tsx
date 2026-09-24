import React from 'react';
import { Navigate } from 'react-router-dom';
import { Building2, Loader2 } from 'lucide-react';
import AppHeader from '../../components/common/AppHeader';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';

// Entrada del panel de empresa (/empresa). Decide adónde va cada cuenta según su alta; el
// contenido del panel (perfil, equipo, servicios) llega en F3.3.

const CompanyHomePage: React.FC = () => {
  const { loading, stage } = useCompanyOnboarding();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" />
      </div>
    );
  }
  if (stage === 'not_company') return <Navigate to="/dashboard" replace />;
  if (stage === 'none' || stage === 'draft') return <Navigate to="/empresa/solicitud" replace />;
  if (stage === 'submitted' || stage === 'rejected') return <Navigate to="/empresa/estado" replace />;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Tu empresa" />
      <main className="mx-auto w-full px-4 py-8 sm:max-w-xl">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center">
          <Building2 className="mx-auto h-10 w-10 text-emerald-700" />
          <h1 className="mt-3 text-lg font-bold text-gray-900">Tu empresa está dada de alta en GarSer</h1>
          <p className="mt-1 text-sm text-gray-600">Aquí gestionarás tu equipo y tus servicios.</p>
        </div>
      </main>
    </div>
  );
};

export default CompanyHomePage;
