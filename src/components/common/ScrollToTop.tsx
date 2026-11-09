import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { anchorIdFromHash } from '../../utils/anchorIdFromHash';

// Cuánto se espera a que aparezca la sección del ancla. Las páginas se cargan en diferido
// (React.lazy + Suspense), así que al llegar con #ancla la sección puede tardar en existir.
const ANCHOR_WAIT_MS = 5000;

/** Lleva la vista a la sección con ese id; si todavía no existe, espera a que se pinte. Devuelve la
 * función que cancela la espera. */
function scrollToAnchorWhenReady(id: string): () => void {
  const scrollIfPresent = (): boolean => {
    const el = document.getElementById(id);
    if (!el) return false;
    el.scrollIntoView({ block: 'start' });
    return true;
  };
  if (scrollIfPresent()) return () => {};

  const observer = new MutationObserver(() => {
    if (scrollIfPresent()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const timeout = window.setTimeout(() => observer.disconnect(), ANCHOR_WAIT_MS);
  return () => {
    observer.disconnect();
    window.clearTimeout(timeout);
  };
}

/**
 * React Router no resetea el scroll al navegar entre rutas. Sin esto, si la página
 * anterior estaba scrolleada, la nueva aparece en la misma posición.
 *
 * Solo actúa cuando la ruta CAMBIA y solo si hay algo que subir (`scrollY` ≠ 0). Al cargar o recargar la
 * web NO toca el scroll: un documento recién cargado ya empieza arriba (la restauración del navegador está
 * desactivada, ver scrollRestoration.ts) y una llamada a `scrollTo` en pleno arranque, justo cuando el
 * navegador del móvil está recolocando sus barras, puede dejar la pantalla desplazada (2026-11-09).
 *
 * Si la dirección trae un ancla (`/para-jardineros#empresas`), va a esa sección en vez de a lo alto:
 * antes se iba siempre arriba y los anuncios que apuntaban a una sección aterrizaban en el principio.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    const previous = lastPathname.current;
    lastPathname.current = pathname;

    if (previous !== null && previous !== pathname && window.scrollY !== 0) window.scrollTo(0, 0);
    const id = anchorIdFromHash(hash);
    if (id) return scrollToAnchorWhenReady(id);
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
