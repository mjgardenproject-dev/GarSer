// R-03: las listas de reservas solo se cargaban al abrir la pantalla. Con la web instalada como
// app (display: standalone) no hay botón de recargar del navegador, así que al volver a la app
// se veía el estado viejo (una reserva ya aceptada seguía «pendiente»). Esto vuelve a pedir los
// datos al volver a la pestaña o a la app, sin repetir si hace menos de `minIntervalMs` o si ya
// hay una carga en curso.

import { useEffect, useRef } from 'react';

export function useRefreshOnReturn(
  refresh: () => unknown,
  { enabled = true, minIntervalMs = 30_000 }: { enabled?: boolean; minIntervalMs?: number } = {},
) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastRun = useRef(Date.now());
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      if (document.visibilityState !== 'visible') return;
      if (inFlight.current || Date.now() - lastRun.current < minIntervalMs) return;
      inFlight.current = true;
      lastRun.current = Date.now();
      try {
        await refreshRef.current();
      } finally {
        inFlight.current = false;
      }
    };
    const onVisibility = () => { void run(); };
    // `pageshow` con `persisted`: la página vuelve de la caché del navegador (atrás/adelante).
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) void run(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [enabled, minIntervalMs]);
}
