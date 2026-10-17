import React from 'react';
import { Calendar, Check, Clock, MapPin, User, X } from 'lucide-react';

import MockupFrame from './MockupFrame';

/** Solicitud nueva tal como la ve el jardinero (imita BookingRequestsManager + GardenerBookingAmount). */
const BookingRequestMockup: React.FC = () => (
  <MockupFrame
    screenTitle="Solicitudes"
    label="Captura de ejemplo de la app: solicitud nueva de corte de césped para el sábado 18 de octubre, de 9:00 a 11:00. Cobrarás 48 €, íntegro para ti, con los botones Rechazar y Aceptar."
  >
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100">
            <Calendar className="h-5 w-5 text-blue-600" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900">Corte de césped</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
              <User className="h-3.5 w-3.5" />
              Laura G.
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Cobrarás</p>
          <p className="whitespace-nowrap text-xl font-bold text-green-600">48,00 €</p>
          <p className="text-[10px] font-medium text-gray-500">Íntegro para ti</p>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-gray-600">
        <p className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5" />
          sábado, 18 de octubre
        </p>
        <p className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          09:00 - 11:00 (2h)
        </p>
        <p className="flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5" />
          120 m² · con retirada de restos
        </p>
      </div>

      <p className="mt-2 text-[11px] font-medium text-orange-600">Recién recibida</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <span className="flex h-9 items-center justify-center gap-1 rounded-lg bg-red-600 text-xs font-semibold text-white">
          <X className="h-3.5 w-3.5" />
          Rechazar
        </span>
        <span className="flex h-9 items-center justify-center gap-1 rounded-lg bg-emerald-700 text-xs font-semibold text-white">
          <Check className="h-3.5 w-3.5" />
          Aceptar
        </span>
      </div>
    </div>
  </MockupFrame>
);

export default BookingRequestMockup;
