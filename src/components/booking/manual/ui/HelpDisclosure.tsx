import React from 'react';
import { ChevronRight } from 'lucide-react';

interface Props {
  summary?: string;
  children: React.ReactNode;
}

/**
 * Ayuda plegada (progressive disclosure): cerrada por defecto para no alargar la pantalla de
 * quien ya sabe la respuesta. Solo método de medida, sin comparaciones (D-03).
 */
export const HelpDisclosure: React.FC<Props> = ({ summary = '¿Cómo lo mido?', children }) => (
  <details className="group mt-3">
    <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center gap-1 rounded-lg text-sm font-semibold text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [&::-webkit-details-marker]:hidden">
      <ChevronRight className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden />
      {summary}
    </summary>
    <div className="mt-1 text-sm leading-6 text-gray-600">{children}</div>
  </details>
);
