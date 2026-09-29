import React from 'react';
import { Link } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import type { TeamMember } from '../../hooks/useCompanyTeam';

// R-04 (prueba real): cuando un jardinero acepta la invitación, la empresa tiene que configurarlo
// (horario fijo y al menos un servicio) para que GarSer le asigne trabajos. Hasta entonces, un
// aviso por persona. Se calcula cada vez desde el servidor (company_team_overview.is_configured):
// desaparece solo en cuanto tiene las dos cosas.

export function membersToSetUp(members: TeamMember[]): TeamMember[] {
  return members.filter((m) => m.role === 'employee' && m.status === 'active' && m.is_configured === false);
}

export function missingSetup(member: TeamMember): string[] {
  const missing: string[] = [];
  if (!member.has_recurring_schedule) missing.push('horario fijo');
  if (member.services.length === 0) missing.push('servicios');
  return missing;
}

const MemberSetupNotices: React.FC<{ members: TeamMember[]; onConfigureServices: (memberId: string) => void }> = ({
  members,
  onConfigureServices,
}) => {
  const pending = membersToSetUp(members);
  if (pending.length === 0) return null;
  return (
    <div className="space-y-2" aria-label="Personas del equipo por configurar">
      {pending.map((m) => {
        const name = m.full_name || m.email || 'Un jardinero';
        const missing = missingSetup(m);
        const needsSchedule = !m.has_recurring_schedule;
        // Sin nombre aún (acaba de crear la cuenta), el botón no repite el correo entero.
        const label = m.full_name ? `Configurar a ${m.full_name.split(' ')[0]}` : 'Configurar';
        return (
          <section key={m.member_id} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <div className="flex items-start gap-3">
              <UserPlus className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="break-words">
                  <span className="font-semibold">{name}</span> ha aceptado tu solicitud de unirse a tu equipo. Configura su perfil para que pueda realizar servicios dentro de tu empresa.
                </p>
                <p className="mt-1 text-xs font-semibold text-amber-800">Le falta: {missing.join(' · ')}</p>
                {needsSchedule ? (
                  <Link
                    to={`/empresa/equipo/${m.member_id}/horario`}
                    className="mt-3 inline-flex min-h-11 max-w-full items-center break-words rounded-xl bg-emerald-700 px-4 py-2 text-left font-bold text-white hover:bg-emerald-800"
                  >
                    {label}
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => onConfigureServices(m.member_id)}
                    className="mt-3 inline-flex min-h-11 max-w-full items-center break-words rounded-xl bg-emerald-700 px-4 py-2 text-left font-bold text-white hover:bg-emerald-800"
                  >
                    {label}
                  </button>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
};

export default MemberSetupNotices;
