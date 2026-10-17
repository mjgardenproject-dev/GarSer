import { useEffect, useState } from 'react';
import {
  getKnownProviderLinkProfile,
  loadProviderLinkProfile,
  type ProviderLinkProfile,
} from '../utils/providerLinkProfile';

export type ProviderLinkProfileStatus = 'idle' | 'loading' | 'ready' | 'error';

interface State {
  gardenerId: string;
  profile: ProviderLinkProfile | null;
  status: ProviderLinkProfileStatus;
}

const resolveSync = (gardenerId: string): State => {
  if (!gardenerId) return { gardenerId, profile: null, status: 'idle' };
  const known = getKnownProviderLinkProfile(gardenerId);
  return known === undefined
    ? { gardenerId, profile: null, status: 'loading' }
    : { gardenerId, profile: known, status: 'ready' };
};

/**
 * Perfil del profesional al que está ligada la reserva (`restrictedGardenerId`). Sin enlace,
 * `idle`. Con `error` las pantallas siguen como si no lo supieran (enseñan todo y el servidor
 * decide), nunca bloquean la reserva por un dato que no ha llegado.
 */
export function useProviderLinkProfile(gardenerId?: string | null) {
  const id = gardenerId || '';
  const [state, setState] = useState<State>(() => resolveSync(id));

  useEffect(() => {
    const initial = resolveSync(id);
    setState(initial);
    if (initial.status !== 'loading') return undefined;

    let cancelled = false;
    loadProviderLinkProfile(id).then(
      (profile) => {
        if (!cancelled) setState({ gardenerId: id, profile, status: 'ready' });
      },
      () => {
        if (!cancelled) setState({ gardenerId: id, profile: null, status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Si el id acaba de cambiar, el estado guardado es del anterior hasta que corra el efecto.
  const current = state.gardenerId === id ? state : resolveSync(id);
  return { profile: current.profile, status: current.status };
}
