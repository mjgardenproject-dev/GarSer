import React from 'react';
import { UserRound } from 'lucide-react';
import type { BookingWorker } from '../../hooks/useBookingWorkers';

// «Quién va» en una reserva de empresa (GarSer Empresas F4). En modo «yo elijo quién va» la
// persona es una propuesta de GarSer que el dueño confirmará o cambiará (pantalla en F5).

const BookingWorkerLine: React.FC<{ worker?: BookingWorker }> = ({ worker }) => {
  if (!worker) return null;
  const who = worker.isMe ? 'tú' : worker.name || 'alguien de tu equipo';
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
