import { useEffect, useState } from 'react';
import {
  AppSettings,
  DEFAULT_APP_SETTINGS,
  fetchAppSettings,
} from '../config/appSettings';

// Hook de lectura para consumidores públicos (footer, landing pages).
// Devuelve los defaults de inmediato y los reemplaza cuando llega la fila de BD,
// de modo que el render nunca se bloquea ni queda en blanco si la consulta falla.
export function useAppSettings(): { settings: AppSettings; loading: boolean } {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    fetchAppSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return { settings, loading };
}
