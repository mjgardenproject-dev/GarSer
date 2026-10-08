import { useCallback, useEffect, useState } from 'react';
import { getKnownServiceName, loadServiceName } from '../utils/serviceNameCatalog';

export type ServiceNameStatus = 'loading' | 'ready' | 'error';

interface ServiceNameState {
  serviceId: string;
  name: string;
  status: ServiceNameStatus;
}

const resolveSync = (serviceId: string): ServiceNameState => {
  // Sin servicio no hay nada que esperar: la página se pinta como siempre (genérica).
  if (!serviceId) return { serviceId, name: '', status: 'ready' };
  const known = getKnownServiceName(serviceId);
  return known ? { serviceId, name: known, status: 'ready' } : { serviceId, name: '', status: 'loading' };
};

/**
 * Nombre del servicio para pintar su pantalla. Si ya se conoce (lo dejó «Servicios»), está listo
 * desde el primer render; si no, `loading` hasta que llegue, o `error` con `retry`.
 * Una respuesta que llega tarde, de un servicio que ya no es el activo, se descarta.
 */
export function useServiceName(serviceId: string) {
  const [state, setState] = useState<ServiceNameState>(() => resolveSync(serviceId));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const initial = resolveSync(serviceId);
    setState(initial);
    if (initial.status === 'ready') return undefined;

    let cancelled = false;
    loadServiceName(serviceId).then(
      (name) => {
        if (!cancelled) setState({ serviceId, name, status: 'ready' });
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error('No se pudo cargar el nombre del servicio', error);
        setState({ serviceId, name: '', status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [serviceId, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  // Si el id acaba de cambiar, el estado guardado es del anterior hasta que corra el efecto.
  const current = state.serviceId === serviceId ? state : resolveSync(serviceId);
  return { name: current.name, status: current.status, retry };
}
