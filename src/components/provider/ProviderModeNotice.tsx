import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Users } from 'lucide-react';
import BottomSheet from '../common/BottomSheet';
import { useAuth } from '../../contexts/AuthContext';
import { useProviderMode } from '../../hooks/useProviderMode';
import { modeTransition, readLastSeenMode, writeLastSeenMode, type ModeTransition } from '../../lib/providerModeNotice';

// Aviso de la transición individual ⇄ equipo (D39). Sale UNA vez por cambio, en cualquier pantalla, en cuanto
// la app detecta que el modo es otro (el compañero aceptó con el titular mirando, o se dio de baja al último).
// Nunca recarga la sesión: el modo ya está leído y las rutas se adaptan solas.
//
// El único dato que guarda el navegador es el último modo visto, y solo para decidir si hay aviso.

const COPY: Record<ModeTransition, { title: string; intro: string; changes: string[]; stays: string[]; cta: string }> = {
  to_team: {
    title: 'Ya tienes equipo',
    intro: 'Tu compañero ha aceptado la invitación. Tu cuenta pasa a ser la de un equipo.',
    changes: ['Agenda por persona y reparto de los trabajos.', 'Cada persona tiene su horario y sus servicios.'],
    stays: ['Tus servicios y precios', 'Tu enlace de reserva y tu perfil público', 'Tus reseñas y tus reservas'],
    cta: 'Ver mi equipo',
  },
  to_individual: {
    title: 'Vuelves al modo individual',
    intro: 'Ya no queda nadie más en tu equipo. Tu panel es el de siempre.',
    changes: ['Los trabajos los haces tú, sin reparto.'],
    stays: ['Tus servicios y precios', 'Tu enlace de reserva y tu perfil público', 'Tus reseñas y tus reservas'],
    cta: 'Entendido',
  },
};

const ProviderModeNotice: React.FC = () => {
  const { user } = useAuth();
  const { loading, mode, isApprovedProfessional } = useProviderMode();
  const navigate = useNavigate();
  const [transition, setTransition] = useState<ModeTransition | null>(null);
  // Qué modo se «vio» ya para esta cuenta en esta sesión: evita volver a avisar en cada pintado.
  const seen = useRef<{ userId: string; mode: string } | null>(null);

  useEffect(() => {
    if (loading || !user?.id || !isApprovedProfessional || !mode) return;
    if (seen.current?.userId === user.id && seen.current.mode === mode) return;
    seen.current = { userId: user.id, mode };
    const next = modeTransition(readLastSeenMode(user.id), mode);
    // Se apunta ya el modo visto: si la persona cierra la app sin tocar nada, el aviso no vuelve a salir.
    writeLastSeenMode(user.id, mode);
    if (next) setTransition(next);
  }, [loading, user?.id, isApprovedProfessional, mode]);

  if (!transition) return null;
  const copy = COPY[transition];
  const close = () => setTransition(null);

  return (
    <BottomSheet open title={copy.title} description={copy.intro} onClose={close}>
      <div className="space-y-4">
        <section aria-label="Qué cambia">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500">
            <Users className="h-4 w-4" aria-hidden="true" /> Qué cambia
          </h3>
          <ul className="mt-1.5 space-y-1 text-sm text-gray-800">
            {copy.changes.map((line) => <li key={line}>· {line}</li>)}
          </ul>
        </section>
        <section aria-label="Qué sigue igual">
          <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-gray-500">
            <Check className="h-4 w-4" aria-hidden="true" /> Qué sigue igual
          </h3>
          <ul className="mt-1.5 space-y-1 text-sm text-gray-800">
            {copy.stays.map((line) => <li key={line}>· {line}</li>)}
          </ul>
        </section>
        <button
          type="button"
          onClick={() => {
            close();
            // «Ver mi equipo» lleva al panel de equipo; «Entendido» se queda donde estaba.
            if (transition === 'to_team') navigate('/empresa');
          }}
          className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation]"
        >
          {copy.cta}
        </button>
      </div>
    </BottomSheet>
  );
};

export default ProviderModeNotice;
