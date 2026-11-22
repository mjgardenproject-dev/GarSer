import { useEffect, useState } from 'react';

export interface VisualViewportBox {
  height: number;
  offsetTop: number;
}

/**
 * Lo que el cliente VE de la página: en iOS el teclado no encoge la altura de la página (`100vh`/`dvh`
 * siguen iguales) sino el «visor» (`visualViewport`). Una hoja a pantalla completa con su botón abajo
 * quedaba con el botón TAPADO por el teclado (QA-135). Con esta caja la hoja se ajusta a lo visible.
 * Sin soporte devuelve null (la hoja usa su altura de siempre).
 */
export function useVisualViewportBox(): VisualViewportBox | null {
  const read = (): VisualViewportBox | null => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    return vv ? { height: Math.round(vv.height), offsetTop: Math.round(vv.offsetTop) } : null;
  };
  const [box, setBox] = useState<VisualViewportBox | null>(read);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const update = () => {
      const next = read();
      setBox((prev) => (prev && next && prev.height === next.height && prev.offsetTop === next.offsetTop ? prev : next));
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return box;
}
