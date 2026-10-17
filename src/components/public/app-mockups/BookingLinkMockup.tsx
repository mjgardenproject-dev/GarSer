import React from 'react';
import { Copy, Link as LinkIcon } from 'lucide-react';

import MockupFrame from './MockupFrame';

/** «Enlace de reserva directo» de Mi cuenta (imita MyAccount) y el mensaje con el que se comparte. */
const BookingLinkMockup: React.FC = () => (
  <MockupFrame
    screenTitle="Mi cuenta"
    label="Captura de ejemplo de la app: la tarjeta «Enlace de reserva directo» de Mi cuenta, con el enlace garser.es/reservar y el botón Copiar, y un mensaje que lo comparte con un cliente."
  >
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <LinkIcon className="h-4 w-4 text-green-600" />
        Enlace de reserva directo
      </p>
      <div className="mt-2 flex gap-2">
        <span className="min-w-0 flex-1 truncate rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-xs text-gray-800">
          garser.es/reservar/3f2a9c1e-7b40-4d1a
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white">
          <Copy className="h-3.5 w-3.5" />
          Copiar
        </span>
      </div>
    </div>

    <div className="mt-3 flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-100 px-3 py-2 text-xs leading-5 text-gray-800">
        ¡Hola! Para reservar conmigo, entra aquí:{' '}
        <span className="font-medium text-emerald-800 underline">garser.es/reservar/3f2a…</span>
      </div>
    </div>
  </MockupFrame>
);

export default BookingLinkMockup;
