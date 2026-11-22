import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type OwnLicenseStatus = 'pending' | 'approved' | 'rejected' | 'expired' | null;

/**
 * Estado del carnet fitosanitario propio, leído al entrar en «Mi perfil». Antes solo lo conocía la pestaña
 * «Personal» (al montar su subida de carnet): quien abría «Servicios» primero veía el herbicida bloqueado
 * por «licencia requerida» con el carnet aprobado (QA-050). Devuelve también el setter para que «Personal»
 * lo actualice al enviar o cambiar el carnet.
 */
export function useOwnPhytoLicenseStatus(enabled: boolean): [OwnLicenseStatus, (status: OwnLicenseStatus) => void] {
  const [status, setStatus] = useState<OwnLicenseStatus>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('my_phyto_license');
        if (!cancelled && !error && data) setStatus(((data as { status?: OwnLicenseStatus }).status ?? null) as OwnLicenseStatus);
      } catch {
        // sin dato: queda como estaba
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return [status, setStatus];
}
