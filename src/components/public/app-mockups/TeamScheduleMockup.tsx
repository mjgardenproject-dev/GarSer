import React from 'react';

import MockupFrame from './MockupFrame';

// Horas de la franja diaria, de 7:00 a 19:00 (como CompanyAgenda).
const DAY_HOURS = Array.from({ length: 13 }, (_, i) => 7 + i);

type Member = {
  name: string;
  summary: string;
  free: number[];
  job: { hours: number[]; label: string; service: string; pending?: boolean };
};

// Datos de ejemplo.
const MEMBERS: Member[] = [
  {
    name: 'Ana',
    summary: '3 h de trabajo',
    free: [8, 12, 13, 14, 15],
    job: { hours: [9, 10, 11], label: '09:00–12:00', service: 'Poda de setos' },
  },
  {
    name: 'Luis',
    summary: '2 h de trabajo',
    free: [8, 9, 10, 11, 12, 13, 14],
    job: { hours: [16, 17], label: '16:00–18:00', service: 'Corte de césped', pending: true },
  },
];

/** Agenda del equipo en vista «Día», una franja por persona (imita DayView de CompanyAgenda). */
const TeamScheduleMockup: React.FC = () => (
  <MockupFrame
    screenTitle="Agenda del equipo"
    label="Captura de ejemplo de la agenda de una empresa: el día de dos empleados, Ana con una poda de setos de 9:00 a 12:00 y Luis con un corte de césped por aceptar de 16:00 a 18:00."
  >
    <p className="text-xs font-semibold text-gray-900">Jueves 16 de octubre</p>

    <div className="mt-2 space-y-2">
      {MEMBERS.map((member) => (
        <div key={member.name} className="rounded-xl border border-gray-200 bg-white p-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-semibold text-gray-900">{member.name}</p>
            <p className="text-[10px] text-gray-500">{member.summary}</p>
          </div>
          <div className="mt-1.5 grid grid-cols-[repeat(13,minmax(0,1fr))] gap-0.5">
            {DAY_HOURS.map((hour) => {
              const cls = member.job.hours.includes(hour)
                ? member.job.pending ? 'bg-amber-400' : 'bg-emerald-700'
                : member.free.includes(hour) ? 'border border-emerald-300 bg-emerald-50' : 'bg-gray-100';
              return <span key={hour} className={`h-5 rounded-sm ${cls}`} />;
            })}
          </div>
          <p className="mt-1.5 flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] text-gray-700">
            <span className="min-w-0 truncate">
              <span className="font-semibold text-gray-900">{member.job.label}</span> · {member.job.service}
            </span>
            {member.job.pending && <span className="shrink-0 font-semibold text-amber-700">Por aceptar</span>}
          </p>
        </div>
      ))}
    </div>
  </MockupFrame>
);

export default TeamScheduleMockup;
