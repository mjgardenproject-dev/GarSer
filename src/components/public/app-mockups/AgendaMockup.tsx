import React from 'react';

import MockupFrame from './MockupFrame';

/** Estados de una hora en la rejilla «Horario» del jardinero (mismos colores que AvailabilityManager). */
type Slot = 'free' | 'booked' | 'pending' | 'off';

const DAYS = [
  { letter: 'L', date: '13' },
  { letter: 'M', date: '14' },
  { letter: 'X', date: '15' },
  { letter: 'J', date: '16' },
  { letter: 'V', date: '17' },
  { letter: 'S', date: '18' },
  { letter: 'D', date: '19' },
];

// Filas = horas (9h a 12h); columnas = días de la semana. Datos de ejemplo.
const WEEK: { hour: number; slots: Slot[] }[] = [
  { hour: 9, slots: ['free', 'booked', 'free', 'free', 'booked', 'pending', 'off'] },
  { hour: 10, slots: ['free', 'booked', 'free', 'booked', 'booked', 'pending', 'off'] },
  { hour: 11, slots: ['booked', 'free', 'free', 'booked', 'free', 'free', 'off'] },
  { hour: 12, slots: ['booked', 'free', 'off', 'free', 'free', 'free', 'off'] },
];

const SLOT_CLASS: Record<Slot, string> = {
  free: 'border-green-400 bg-green-100 text-green-900',
  booked: 'border-green-700 bg-emerald-700 text-white',
  pending: 'border-amber-400 bg-amber-100 text-amber-900',
  off: 'border-gray-300 bg-gray-50 text-gray-400',
};

/** Semana del jardinero: horas libres, reservadas y solicitadas (imita la vista móvil de AvailabilityManager). */
const AgendaMockup: React.FC = () => (
  <MockupFrame
    screenTitle="Horario"
    label="Captura de ejemplo de la app: el horario semanal del jardinero, con horas disponibles, horas reservadas y solicitudes pendientes."
  >
    <p className="text-center text-xs font-semibold text-gray-900">13 oct - 19 oct</p>

    <div className="mt-2 grid grid-cols-7 gap-1">
      {DAYS.map((day) => (
        <div key={day.letter} className="rounded-md bg-white py-1 text-center">
          <p className="text-[11px] font-bold leading-tight text-gray-900">{day.letter}</p>
          <p className="text-[10px] font-semibold leading-tight text-gray-500">{day.date}</p>
        </div>
      ))}
      {WEEK.map((row) =>
        row.slots.map((slot, index) => (
          <span
            key={`${row.hour}-${index}`}
            className={`flex h-7 items-center justify-center rounded-md border-2 text-[10px] font-bold ${SLOT_CLASS[slot]}`}
          >
            {row.hour}h
          </span>
        )),
      )}
    </div>

    <div className="mt-2.5 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[10px] text-gray-600">
      <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-green-400 bg-green-100" />Disponible</span>
      <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-700" />Reservado</span>
      <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-amber-400 bg-amber-100" />Solicitada</span>
    </div>
  </MockupFrame>
);

export default AgendaMockup;
