import React, { useCallback, useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useRefreshOnReturn } from '../../hooks/useRefreshOnReturn';

// Fase E (PR-02, R-20): suspender a un profesional o a una empresa corta las reservas nuevas, pero
// antes no lo veía en ningún sitio: solo notaba que no le llegaba nada. Este aviso sale en su panel
// mientras `gardener_profiles.suspended_at` esté puesto (lo puede leer de su propia ficha).
export const SUSPENDED_TITLE = 'Tu cuenta está suspendida';
export const SUSPENDED_TEXT =
  'No recibes reservas nuevas. Tus reservas ya citadas siguen su curso: hazlas, cóbralas y valóralas como siempre. Si crees que es un error, responde al correo que te hemos enviado.';

export const SuspendedNoticeView: React.FC = () => (
  <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
    <p className="flex items-center gap-2 font-semibold">
      <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" /> {SUSPENDED_TITLE}
    </p>
    <p className="mt-1 text-sm break-words">{SUSPENDED_TEXT}</p>
  </div>
);

const SuspendedProviderNotice: React.FC<{ className?: string }> = ({ className }) => {
  const { user } = useAuth();
  const [suspended, setSuspended] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase.from('gardener_profiles').select('suspended_at').eq('user_id', user.id).maybeSingle();
    setSuspended(Boolean((data as { suspended_at?: string | null } | null)?.suspended_at));
  }, [user?.id]);

  useEffect(() => { void load(); }, [load]);
  useRefreshOnReturn(load);

  return suspended ? <div className={className}><SuspendedNoticeView /></div> : null;
};

export default SuspendedProviderNotice;
