import React from 'react';
import { Info } from 'lucide-react';

import type { BookingRateNotice as BookingRateNoticeData } from '../../utils/bookingRateNotice';

/**
 * Explica por qué esta reserva lleva la tarifa que lleva cuando el cliente podría esperar otra
 * (ver describeBookingRateNotice). Sustituye al aviso de «enlace antiguo», que solo cubría un caso.
 */
const BookingRateNotice: React.FC<{ notice: BookingRateNoticeData | null; className?: string }> = ({ notice, className }) => {
  if (!notice) return null;
  return (
    <div
      role="status"
      data-notice={notice.kind}
      className={`flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 ${className ?? ''}`}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>{notice.text}</p>
    </div>
  );
};

export default BookingRateNotice;
