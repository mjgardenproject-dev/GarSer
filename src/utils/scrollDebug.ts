// Diagnóstico de scroll, SOLO si se pide (2026-11-09).
//
// Para qué: en el móvil del administrador, al recargar la web la pantalla se movía sola (≈ 60 px) y volvía a
// subir al bajarla. En Safari, en el navegador interno de Gmail y emulando «tirar para recargar» no se
// reproduce, así que hace falta ver qué pasa EN ESE móvil: quién mueve el scroll y cuándo.
//
// Cómo se usa: abrir `garser.es/?scrolldebug=1` (queda activado en ese navegador), recargar como siempre y
// hacer una captura de la franja negra de abajo. `?scrolldebug=0` lo apaga. Sin la marca no se instala nada.
//
// Qué apunta (sin datos personales): cada llamada de la propia web a scrollTo / scroll / scrollBy /
// scrollIntoView / focus con quién la llamó, cada cambio del scroll, y los cambios de tamaño de la ventana y
// de la zona visible (las barras del navegador al aparecer o esconderse). El historial sobrevive a la recarga.

const FLAG_KEY = 'garser.scrolldebug';
const LOG_KEY = 'garser.scrolldebug.log';
const MAX_LINES = 80;
const SHOWN_LINES = 16;
const OVERLAY_ID = 'garser-scroll-debug';

/** ¿Hay que activar el diagnóstico? `?scrolldebug=1` lo enciende y lo recuerda; `?scrolldebug=0` lo apaga. */
export function scrollDebugRequested(search: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): boolean {
  const asked = new URLSearchParams(search).get('scrolldebug');
  try {
    if (asked === '1') storage.setItem(FLAG_KEY, '1');
    if (asked === '0') {
      storage.removeItem(FLAG_KEY);
      storage.removeItem(LOG_KEY);
      return false;
    }
    return storage.getItem(FLAG_KEY) === '1';
  } catch {
    return asked === '1';
  }
}

/** Añade una línea al historial y lo recorta a las últimas MAX_LINES. */
export function appendLogLine(lines: string[], line: string, max = MAX_LINES): string[] {
  const next = [...lines, line];
  return next.length > max ? next.slice(next.length - max) : next;
}

const shortStack = (): string => {
  try {
    return (new Error().stack || '')
      .split('\n')
      .slice(3, 6)
      .map((l) => l.trim().replace(/https?:\/\/[^/\s]+/g, '').replace(/^at\s+/, '').slice(0, 70))
      .join(' < ');
  } catch {
    return '';
  }
};

/** Instala el registro y la franja negra con las últimas líneas. Devuelve cómo deshacerlo (para las pruebas). */
export function installScrollDebug(win: Window & typeof globalThis = window): () => void {
  const doc = win.document;
  const t0 = win.performance.now();
  let lines: string[] = [];
  try {
    lines = JSON.parse(win.sessionStorage.getItem(LOG_KEY) || '[]') as string[];
  } catch {
    lines = [];
  }

  const stamp = () => `${Math.round(win.performance.now() - t0)}ms`;
  const y = () => Math.round(win.scrollY);
  const nav = (win.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? '?';

  let overlay: HTMLDivElement | null = null;
  const render = () => {
    if (!overlay) return;
    const body = overlay.querySelector('pre');
    if (body) body.textContent = `y=${y()} inner=${win.innerWidth}x${win.innerHeight}\n${lines.slice(-SHOWN_LINES).join('\n')}`;
  };
  const log = (message: string) => {
    lines = appendLogLine(lines, `${stamp()} ${message}`);
    try { win.sessionStorage.setItem(LOG_KEY, JSON.stringify(lines)); } catch { /* sin espacio: se sigue sin guardar */ }
    render();
  };

  log(`── carga (${nav}) y=${y()} restauración=${win.history.scrollRestoration ?? '-'}`);

  const restore: Array<() => void> = [];
  const wrap = <T extends object>(target: T, name: string, label: (self: unknown, args: unknown[]) => string) => {
    const original = (target as Record<string, unknown>)[name];
    if (typeof original !== 'function') return;
    (target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
      log(`${label(this, args)} ${shortStack()}`);
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
    restore.push(() => { (target as Record<string, unknown>)[name] = original; });
  };
  const describe = (el: unknown) => {
    const e = el as Element | undefined;
    return e && 'tagName' in e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}` : String(el);
  };
  for (const name of ['scrollTo', 'scroll', 'scrollBy']) {
    wrap(win, name, (_s, args) => `${name}(${args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(',')}) y=${y()}`);
  }
  wrap(win.Element.prototype, 'scrollIntoView', (self) => `scrollIntoView ${describe(self)} y=${y()}`);
  wrap(win.HTMLElement.prototype, 'focus', (self) => `focus ${describe(self)} y=${y()}`);

  let lastY = y();
  const onScroll = () => {
    if (y() !== lastY) { log(`scroll y=${lastY}→${y()}`); lastY = y(); }
  };
  const onResize = () => log(`resize inner=${win.innerWidth}x${win.innerHeight}`);
  const vv = win.visualViewport;
  const onVv = () => vv && log(`visualViewport h=${Math.round(vv.height)} top=${Math.round(vv.offsetTop)} pageTop=${Math.round(vv.pageTop)}`);
  const onPageShow = (e: Event) => log(`pageshow persisted=${(e as PageTransitionEvent).persisted}`);
  const onVisibility = () => log(`visibility=${doc.visibilityState}`);
  const onLoad = () => log(`load y=${y()}`);
  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onResize);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('load', onLoad);
  doc.addEventListener('visibilitychange', onVisibility);
  vv?.addEventListener('resize', onVv);
  vv?.addEventListener('scroll', onVv);

  const mount = () => {
    if (doc.getElementById(OVERLAY_ID)) return;
    overlay = doc.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('style', 'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(0,0,0,.88);color:#7CFC00;font:10px/1.25 ui-monospace,Menlo,monospace;padding:6px 8px;max-height:40vh;overflow:hidden;pointer-events:none');
    const pre = doc.createElement('pre');
    pre.setAttribute('style', 'margin:0;white-space:pre-wrap;word-break:break-all');
    overlay.appendChild(pre);
    doc.documentElement.appendChild(overlay);
    render();
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
  const tick = win.setInterval(render, 500);

  return () => {
    restore.forEach((fn) => fn());
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('resize', onResize);
    win.removeEventListener('pageshow', onPageShow);
    win.removeEventListener('load', onLoad);
    doc.removeEventListener('visibilitychange', onVisibility);
    vv?.removeEventListener('resize', onVv);
    vv?.removeEventListener('scroll', onVv);
    win.clearInterval(tick);
    overlay?.remove();
  };
}

/** Punto de entrada de `main.tsx`: no hace nada salvo que se haya pedido con `?scrolldebug=1`. */
export function enableScrollDebugIfRequested(): void {
  try {
    if (scrollDebugRequested(window.location.search, window.localStorage)) installScrollDebug();
  } catch {
    // Un diagnóstico nunca debe impedir que la web arranque.
  }
}
