import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import AvailabilityManager from '../../components/gardener/AvailabilityManager';
import { useCompanyTeam } from '../../hooks/useCompanyTeam';

// Horario de un empleado, lo pone el dueño (/empresa/equipo/:memberId/horario · D22, 2026-09-28).
// La MISMA pantalla de horario de siempre (ajustes puntuales y horario fijo), sobre el empleado:
// lee y guarda por las RPC del dueño, que comprueban en el servidor que es un empleado activo de
// SU empresa. Las horas con trabajo salen bloqueadas y el servidor no las deja reabrir (A-32).

const CompanyMemberSchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const { memberId } = useParams<{ memberId: string }>();
  const { data, loading, error } = useCompanyTeam();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" />
      </div>
    );
  }
  if (error || !data) return <Navigate to="/empresa" replace />;

  const member = data.members.find((m) => m.member_id === memberId && m.role === 'employee' && m.status === 'active');
  if (!member) return <Navigate to="/empresa" replace />;

  const name = member.full_name || member.email || 'tu empleado';
  return (
    <AvailabilityManager
      onBack={() => navigate('/empresa')}
      member={{ memberId: member.member_id, userId: member.user_id, name }}
      hideMinNotice
    />
  );
};

export default CompanyMemberSchedulePage;
