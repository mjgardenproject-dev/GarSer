import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bell, BellOff, Loader2 } from 'lucide-react';
import { disablePush, enablePush, getPushState, type PushState } from '../../utils/pushNotifications';

// Prueba real · F7 (R-08, D25): los avisos que llegan por correo, también como notificación en
// este dispositivo. El navegador exige que se activen tras un toque del usuario.

const COPY: Record<PushState, string> = {
  enabled: 'Activadas en este dispositivo: te avisamos aquí de lo mismo que por correo (solicitudes, cambios, trabajos asignados…).',
  disabled: 'Recibe en este dispositivo los mismos avisos que por correo, al momento.',
  denied: 'Las has bloqueado para esta web. Para activarlas, permite las notificaciones en los ajustes del navegador y vuelve aquí.',
  unsupported: 'Este navegador no permite notificaciones. Prueba con Chrome, Edge, Firefox o Safari actualizados.',
  'ios-needs-install': 'En iPhone, primero añade GarSer a la pantalla de inicio: en Safari, botón Compartir → «Añadir a pantalla de inicio». Luego abre GarSer desde ese icono y actívalas aquí.',
};

const PushNotificationsCard: React.FC = () => {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getPushState().then((s) => { if (alive) setState(s); }).catch(() => { if (alive) setState('unsupported'); });
    return () => { alive = false; };
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const next = await enablePush();
      setState(next);
      if (next === 'enabled') toast.success('Notificaciones activadas en este dispositivo');
      else if (next === 'denied') toast.error('Has bloqueado las notificaciones para esta web.');
    } catch (error) {
      toast.error((error as { message?: string })?.message || 'No se han podido activar las notificaciones.');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await disablePush();
      setState('disabled');
      toast.success('Ya no recibirás notificaciones en este dispositivo');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 sm:p-6 shadow-sm">
      <div className="flex items-center mb-2">
        <Bell className="w-5 h-5 text-green-600 mr-2" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-gray-900">Notificaciones en el móvil</h2>
      </div>
      {state === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" aria-label="Cargando" />
      ) : (
        <>
          <p className="text-sm text-gray-700">{COPY[state]}</p>
          {state === 'disabled' && (
            <button type="button" onClick={() => void enable()} disabled={busy}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Activar notificaciones
            </button>
          )}
          {state === 'enabled' && (
            <button type="button" onClick={() => void disable()} disabled={busy}
              className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 disabled:opacity-60">
              <BellOff className="h-4 w-4" /> Desactivar en este dispositivo
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default PushNotificationsCard;
