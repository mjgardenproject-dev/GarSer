import React from 'react';
import { BellRing } from 'lucide-react';

// Aviso del cuestionario «Activa tu cuenta» cuando hay solicitudes de reserva esperando respuesta (QA-062).
// El cuestionario ocupa toda la pantalla y no enseña el menú: sin esto, la única pista era la insignia del Chat.

interface Props {
  count: number;
  onOpen: () => void;
}

const PendingRequestsNotice: React.FC<Props> = ({ count, onOpen }) => {
  if (count <= 0) return null;
  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <BellRing className="h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-sm text-amber-900">
        <span className="font-semibold">
          {count === 1 ? 'Tienes 1 solicitud de reserva sin responder.' : `Tienes ${count} solicitudes de reserva sin responder.`}
        </span>{' '}
        Si no la respondes a tiempo, caduca.
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex min-h-11 shrink-0 items-center rounded-xl bg-amber-700 px-3 text-sm font-bold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 [touch-action:manipulation]"
      >
        {count === 1 ? 'Verla' : 'Verlas'}
      </button>
    </div>
  );
};

export default PendingRequestsNotice;
