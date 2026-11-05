import { useLayoutEffect, type RefObject } from 'react';

// Barras fijas apiladas (2026-11-05). La web tiene una barra general arriba (Navbar) y, debajo,
// la de cada pantalla (AppHeader, o el progreso del alta). Las dos eran `sticky top-0 z-40` y, al
// hacer scroll, una se montaba encima de la otra y tapaba el contenido (fallos 3 y 5 del móvil).
//
// Cada barra publica su ALTO REAL en una variable CSS del <html>; la de debajo se pega justo
// después (`top: var(--app-navbar-h)`) y el scroll de anclas y del foco reserva ese hueco
// (`scroll-padding-top`, src/index.css). Así no hay alturas puestas a mano que se descuadren con
// el notch, con la fuente del sistema o si cambia el alto de la barra.
//
//  --app-navbar-h    alto de la barra general (Navbar). Sin Navbar vale 0 (valor por defecto).
//  --app-header-pad  margen del notch que ya pone el Navbar: con Navbar debajo no se repite.
//  --app-sticky-sub-h  alto de la barra de pantalla (AppHeader / progreso del alta).

export const NAVBAR_HEIGHT_VAR = '--app-navbar-h';
export const HEADER_PAD_VAR = '--app-header-pad';
export const SUB_HEIGHT_VAR = '--app-sticky-sub-h';

/**
 * Publica el alto del elemento en `variable` mientras esté montado y lo retira al desmontarse.
 * `alsoSet` fija otras variables a la vez (el Navbar quita así el margen del notch del AppHeader).
 */
export function usePublishStickyHeight(
  ref: RefObject<HTMLElement>,
  variable: string,
  alsoSet: Record<string, string> = {},
): void {
  const extras = JSON.stringify(alsoSet);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const root = document.documentElement;
    const extraEntries = Object.entries(JSON.parse(extras) as Record<string, string>);

    const publish = () => root.style.setProperty(variable, `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    extraEntries.forEach(([name, value]) => root.style.setProperty(name, value));

    // ResizeObserver cubre cambios de contenido; `resize` cubre girar el móvil donde no exista.
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    window.addEventListener('resize', publish);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', publish);
      root.style.removeProperty(variable);
      extraEntries.forEach(([name]) => root.style.removeProperty(name));
    };
  }, [ref, variable, extras]);
}
