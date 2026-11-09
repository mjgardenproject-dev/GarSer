import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AppHeader from '../../components/common/AppHeader';
import GardenerReviews from '../../components/gardener/GardenerReviews';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';

// Reseñas del profesional con equipo (/empresa/resenas, D31). Las reseñas cuelgan de la misma cuenta
// (`reviews.gardener_id`) antes y después de pasar a equipo, así que son las mismas que veía como
// autónomo: aquí solo se vuelven a poder leer y responder desde el panel de equipo (antes, una empresa
// no tenía ninguna entrada a ellas y la barra le enseñaba las «Valoraciones» de cliente).

const CompanyReviewsPage: React.FC = () => {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Reseñas" onBack={() => navigate('/empresa?tab=company')} backLabel="Volver" />
      <main className="mx-auto w-full px-4 py-4 sm:max-w-xl">
        <GardenerReviews />
      </main>
    </div>
  );
};

export default CompanyReviewsPage;
