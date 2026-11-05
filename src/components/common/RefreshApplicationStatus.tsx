import React from 'react';
import toast from 'react-hot-toast';
import RefreshButton from './RefreshButton';
import { useRefreshOnReturn } from '../../hooks/useRefreshOnReturn';

/**
 * «Actualizar estado» de una solicitud en revisión (jardinero o empresa), 2026-11-05.
 *
 * Antes, si el administrador aceptaba la solicitud, la persona no se enteraba hasta cerrar sesión y
 * volver a entrar: el estado se leía una sola vez. Ahora:
 *  · un botón visible que vuelve a preguntar y dice qué ha pasado;
 *  · la misma comprobación, en silencio, al volver a la app desde segundo plano (la web instalada
 *    no tiene botón de recargar), como mucho cada 10 s.
 * Si la solicitud pasa a «aceptada», la propia pantalla (o App.tsx) lleva al panel; aquí solo se avisa.
 */
export type ApplicationCheck = 'approved' | 'pending' | 'rejected';

interface Props {
  /** Pregunta el estado actual. Debe lanzar si no se pudo comprobar (red). */
  check: () => Promise<ApplicationCheck>;
  className?: string;
}

export const REVIEW_STILL_PENDING = 'Sigue en revisión. Te avisaremos por correo en cuanto esté lista.';
export const REVIEW_APPROVED = '¡Solicitud aceptada! Entrando en tu panel…';
export const REVIEW_REJECTED = 'Tu solicitud no se ha aceptado. Mira el motivo en esta pantalla.';
export const REVIEW_CHECK_FAILED = 'No se ha podido comprobar. Revisa tu conexión e inténtalo de nuevo.';

const RefreshApplicationStatus: React.FC<Props> = ({ check, className = '' }) => {
  const refreshNow = async () => {
    try {
      const result = await check();
      if (result === 'approved') toast.success(REVIEW_APPROVED, { id: 'application-status' });
      else if (result === 'rejected') toast(REVIEW_REJECTED, { id: 'application-status', icon: 'ℹ️' });
      else toast(REVIEW_STILL_PENDING, { id: 'application-status', icon: '🕓' });
    } catch {
      toast.error(REVIEW_CHECK_FAILED, { id: 'application-status' });
    }
  };

  // Al volver a la app: en silencio. Solo habla si cambió algo (aceptada o rechazada).
  useRefreshOnReturn(async () => {
    try {
      const result = await check();
      if (result === 'approved') toast.success(REVIEW_APPROVED, { id: 'application-status' });
      else if (result === 'rejected') toast(REVIEW_REJECTED, { id: 'application-status', icon: 'ℹ️' });
    } catch {
      // Sin red al volver: no se molesta; el botón sigue ahí.
    }
  }, { minIntervalMs: 10_000 });

  return (
    <RefreshButton
      onRefresh={refreshNow}
      label="Actualizar estado"
      alwaysShowLabel
      className={`w-full min-h-12 justify-center text-base font-semibold ${className}`}
    />
  );
};

export default RefreshApplicationStatus;
