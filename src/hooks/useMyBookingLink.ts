import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { normalizeProviderLinkCode } from '../shared/commissionRules';

/**
 * El enlace de reserva del profesional que ha iniciado sesión: su identificador y su CLAVE.
 *
 * La clave la crea y la guarda la base de datos (`my_booking_link`, solo para quien tiene ficha de
 * profesional) y es lo que hace que una reserva cuente como «cliente del profesional». Esta capa solo
 * la pide y comprueba que viene bien formada: si no, es un error, nunca un enlace «a medias».
 */

export type MyBookingLinkState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; providerId: string; code: string };

function readLink(data: unknown): MyBookingLinkState {
  const row = (data && typeof data === 'object' ? data : {}) as { providerId?: unknown; code?: unknown };
  const code = normalizeProviderLinkCode(row.code);
  const providerId = typeof row.providerId === 'string' ? row.providerId : '';
  return code && providerId ? { status: 'ready', providerId, code } : { status: 'error' };
}

export function useMyBookingLink(enabled: boolean = true) {
  const [state, setState] = useState<MyBookingLinkState>({ status: 'loading' });
  const [rotating, setRotating] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const { data, error } = await supabase.rpc('my_booking_link');
      if (!aliveRef.current) return;
      setState(error ? { status: 'error' } : readLink(data));
    } catch {
      if (aliveRef.current) setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  /** Cambia la clave: los enlaces y QR anteriores dejan de eximir. true si quedó cambiada. */
  const rotate = useCallback(async (): Promise<boolean> => {
    setRotating(true);
    try {
      const { data, error } = await supabase.rpc('rotate_my_booking_link');
      const next = error ? ({ status: 'error' } as const) : readLink(data);
      if (aliveRef.current && next.status === 'ready') setState(next);
      return next.status === 'ready';
    } catch {
      return false;
    } finally {
      if (aliveRef.current) setRotating(false);
    }
  }, []);

  return { state, reload: load, rotate, rotating };
}
