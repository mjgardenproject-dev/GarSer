import React from 'react';
import { UserRound } from 'lucide-react';
import type { BookingWorker } from '../../hooks/useBookingWorkers';

// «Quién va» en una reserva de empresa (GarSer Empresas F4). En modo «yo elijo quién va» la
// persona es una propuesta de GarSer que el dueño confirmará o cambiará (pantalla en F5).

const BookingWorkerLine: React.FC<{ worker?: BookingWorker }> = ({ worker }) => {
  if (!worker) return null;
  const label = (p: { isMe: boolean; name: string | null }) => (p.isMe ? 'tú' : p.name || 'alguien de tu equipo');
  const range = (hours: number[]) => `${String(hours[0]).padStart(2, '0')}–${String(hours[hours.length - 1] + 1).padStart(2, '0')} h`;
  // F6 (D10): trabajo repartido entre varias personas.
  if (worker.people.length > 1) {
    return (
      <div className="mt-2 flex items-start gap-1.5 text-sm">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
        <span className="text-gray-700">
          {worker.pending ? 'Propuesta para ir: ' : 'Van: '}
          {worker.people.map((p, i) => (
            <React.Fragment key={p.workerId}>
              {i > 0 && (i === worker.people.length - 1 ? ' y ' : ', ')}
              <span className="font-semibold text-gray-900">{label(p)}</span> ({range(p.hours)})
            </React.Fragment>
          ))}
        </span>
      </div>
    );
  }
  const who = label(worker);
  return (
    <div className="mt-2 flex items-center gap-1.5 text-sm">
      <UserRound className="h-4 w-4 shrink-0 text-emerald-700" />
      {worker.pending ? (
        <span className="text-gray-700">
          Propuesta para ir: <span className="font-semibold text-gray-900">{who}</span>
        </span>
      ) : (
        <span className="text-gray-700">
          Va: <span className="font-semibold text-gray-900">{who}</span>
        </span>
      )}
    </div>
  );
};

export default BookingWorkerLine;
