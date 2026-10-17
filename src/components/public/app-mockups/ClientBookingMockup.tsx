import React from 'react';
import { ChevronLeft } from 'lucide-react';

import MockupFrame from './MockupFrame';

const DAYS = [
  { letter: 'L', date: '13', disabled: true },
  { letter: 'M', date: '14', disabled: false },
  { letter: 'X', date: '15', disabled: true },
  { letter: 'J', date: '16', disabled: false },
  { letter: 'V', date: '17', disabled: false },
  { letter: 'S', date: '18', disabled: false, selected: true },
  { letter: 'D', date: '19', disabled: true },
];

const HOURS = [
  { label: '09:00', selected: true },
  { label: '11:00', selected: false },
  { label: '16:00', selected: false },
];

/** El cliente, en el móvil, eligiendo día y hora con su jardinero (imita el paso 4 de ProvidersPage). */
const ClientBookingMockup: React.FC = () => (
  <MockupFrame
    screenTitle="Reserva del cliente"
    label="Captura de ejemplo del móvil de un cliente reservando: paso 4 de 5, con su jardinero ya elegido, el precio, el día y las horas libres, y el botón Confirmar profesional."
  >
    <div className="flex items-center gap-2">
      <ChevronLeft className="h-4 w-4 text-gray-500" />
      <p className="text-sm font-semibold text-gray-900">Corte de césped</p>
    </div>
    <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-600">
      <span>Paso 4 de 5</span>
      <span className="h-1 flex-1 rounded-full bg-gray-200">
        <span className="block h-1 w-4/5 rounded-full bg-green-600" />
      </span>
    </div>

    <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border-2 border-green-600 bg-green-50 p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
          M
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">Miguel R.</p>
          <p className="text-[10px] text-gray-500">Tu jardinero</p>
        </div>
      </div>
      <p className="shrink-0 text-base font-semibold text-gray-900">48,00 €</p>
    </div>

    <div className="mt-3 grid grid-cols-7 gap-1 text-center">
      {DAYS.map((day) => (
        <span
          key={day.date}
          className={`flex flex-col items-center rounded-full border py-1 text-[10px] font-semibold ${
            day.selected
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : day.disabled
                ? 'border-gray-200 text-gray-400 opacity-40'
                : 'border-gray-300 bg-white text-gray-800'
          }`}
        >
          {day.letter}
          <span className="text-[10px] leading-tight">{day.date}</span>
        </span>
      ))}
    </div>

    <div className="mt-2.5 flex gap-1.5">
      {HOURS.map((hour) => (
        <span
          key={hour.label}
          className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${
            hour.selected ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white text-gray-800'
          }`}
        >
          {hour.label}
        </span>
      ))}
    </div>

    <span className="mt-3 block rounded-xl bg-emerald-700 py-2.5 text-center text-sm font-semibold text-white">
      Confirmar profesional
    </span>
  </MockupFrame>
);

export default ClientBookingMockup;
